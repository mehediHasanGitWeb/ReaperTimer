// TaskStore: the single owner of every task in memory.
//
// Why this exists
// ---------------
// The plugin used to keep tasks as plain arrays hanging off
// `state.fileData` (`category[i].Tasks` + `notCategoriseTasks`) and every
// component re-walked / re-copied all of them on every refresh (every second
// for the timelines). That is O(N) work per tick and O(N) DOM nodes, which
// is what made the UI crawl once there were a lot of tasks.
//
// The store keeps the same tasks, in the same order, but:
//   * splits each group's list into CHUNKS (<= CHUNK_MAX tasks each) with
//     per-chunk counters (n / done / started) so counts, "i-th pending task"
//     lookups and totals cost O(#chunks), not O(#tasks);
//   * lets chunks be COLD (not in memory, only counters) when the data is
//     stored sharded on disk -- a chunk is read back synchronously the moment
//     something actually needs one of its tasks, and clean chunks are evicted
//     again once more than HOT_TASK_BUDGET tasks are in memory;
//   * tracks which chunks changed (dirty) so persistence only rewrites those.
//
// Groups are: index 0 = "Uncategorized", then one per category object, in the
// order of the category list -- the same order every view used before.

import { isTaskStarted, startTask, stopTask, hasStartedTasks } from '../utils/startedTasks';
import { invalidateTimerParams } from './timerParams';

import type { CategoryEntry, Category, DataSection, PluginData, Task, TaskHolder, TaskListKey } from '../types';

export type { Task };

/** Preferred chunk size when an existing flat list is split up. */
export const CHUNK_TARGET = 5_000;
/** A chunk that grows past this is split in two. */
export const CHUNK_MAX = 10_000;
/** Max tasks kept in memory (clean chunks beyond this are evicted). */
export const HOT_TASK_BUDGET = 200_000;

export type Kind = 'pending' | 'started' | 'completed' | 'incomplete' | 'all';

/** Reads one cold chunk back from wherever it is persisted (synchronously). */
export interface ChunkStorage {
	read(file: string): Task[];
}

export const isDone = (t: Task | null | undefined): boolean => t != null && typeof t === 'object' && !!(t.completed || t.isCompleted);

export class Chunk {
	tasks: Task[] | null;
	/** task count (exact while hot, last-persisted value while cold) */
	n: number;
	/** completed count (same rule as n) */
	done: number;
	/** how many of this chunk's tasks are in the in-memory "DONE till" set */
	started = 0;
	/** file the current content was last written to; null = never written */
	file: string | null;
	/** content differs from `file` (needs rewriting) */
	dirty: boolean;
	/** lower bound (seconds) of the shortest timer among pending tasks; null = no timers (persisted hint) */
	minDur: number | null = null;
	/** timer engine scheduling: epoch ms when this chunk next needs a scan (0 = scan asap) */
	nextDue = 0;
	lastUse = 0;
	/** bumped on every change, so a save that was in flight can tell whether the chunk changed meanwhile */
	rev = 0;
	/** taken out of its group (emptied / group dropped) */
	removed = false;
	constructor(public group: Group, tasks: Task[] | null, n: number, done: number, file: string | null, dirty: boolean) {
		this.tasks = tasks;
		this.n = n;
		this.done = done;
		this.file = file;
		this.dirty = dirty;
	}
}

interface PrefixCache {
	rev: number;
	pref: Float64Array;
}

export class Group {
	chunks: Chunk[] = [];
	/** bumped whenever any chunk counter / the chunk list changes */
	rev = 0;
	private prefCache: Partial<Record<Kind, PrefixCache>> = {};
	constructor(
		public index: number,
		/** the category object this group stands for (null for Uncategorized) */
		public catObj: CategoryEntry | null,
		/** which property of catObj / the uncategorized holder holds the task array */
		public prop: TaskListKey,
		/** for Uncategorized: object that owns the array */
		public holder: TaskHolder | null,
	) {}

	get name(): string {
		if (this.index === 0) return 'Uncategorized';
		const c = this.catObj;
		if (typeof c === 'string') return c;
		return (c && (c.Name || c.categoryName)) || 'Category';
	}

	get color(): string | undefined {
		const c = this.catObj;
		return c && typeof c === 'object' ? c.color : undefined;
	}

	invalidate() {
		this.rev++;
	}

	/** cumulative counts per chunk for `kind`: pref[i] = #matching tasks in chunks [0, i) */
	prefix(kind: Kind): Float64Array {
		const cached = this.prefCache[kind];
		if (cached && cached.rev === this.rev && cached.pref.length === this.chunks.length + 1) return cached.pref;
		const pref = new Float64Array(this.chunks.length + 1);
		for (let i = 0; i < this.chunks.length; i++) {
			pref[i + 1] = pref[i]! + countOf(this.chunks[i]!, kind);
		}
		this.prefCache[kind] = { rev: this.rev, pref };
		return pref;
	}

	count(kind: Kind): number {
		const pref = this.prefix(kind);
		return pref[pref.length - 1]!;
	}
}

export const countOf = (c: Chunk, kind: Kind): number => {
	switch (kind) {
		case 'all': return c.n;
		case 'completed': return c.done;
		case 'incomplete': return c.n - c.done;
		case 'started': return c.started;
		case 'pending': return c.n - c.done - c.started;
	}
};

const matches = (t: Task | undefined, kind: Kind, anyStarted: boolean): boolean => {
	switch (kind) {
		case 'all': return true;
		case 'completed': return isDone(t);
		case 'incomplete': return t != null && !isDone(t);
		case 'started': return anyStarted && t != null && !isDone(t) && isTaskStarted(t.id);
		case 'pending': return t != null && !isDone(t) && !(anyStarted && isTaskStarted(t.id));
	}
};

export interface Location {
	chunk: Chunk;
	index: number;
}

type Listener = () => void;

export class TaskStore {
	groups: Group[] = [];
	/** bumped on every change that can alter what a list shows */
	version = 0;
	storage: ChunkStorage | null = null;
	/** tasks currently resident in memory */
	hotTasks = 0;
	hotBudget = HOT_TASK_BUDGET;
	chunkMax = CHUNK_MAX;
	chunkTarget = CHUNK_TARGET;
	/** chunk files that were replaced/emptied and can be deleted after the next successful save */
	garbageFiles: string[] = [];
	/** group list / chunk membership changed since the last save (manifest must be rewritten) */
	structureDirty = false;
	private useClock = 0;
	/** epoch ms the timer engine counts "tasks present at startup" from (cold chunks get their first due time from it) */
	timerBase = Date.now();
	private listeners = new Set<Listener>();
	/** persistence hook: something became dirty */
	onDirty: (() => void) | null = null;
	/** persistence hook: memory pressure (everything resident is dirty) */
	onPressure: (() => void) | null = null;
	/** tasks (by identity) that must stay resident, e.g. the global task */
	private pins = new Set<Task>();
	root: PluginData = {};
	private uncatHolder: TaskHolder | null = null;
	private uncatProp: TaskListKey = 'notCategoriseTasks';
	private placeholders = new WeakSet<object>();
	private totalsCache: { key: number; value: Totals } | null = null;

	constructor() {
		this.groups = [new Group(0, null, 'notCategoriseTasks', null)];
	}

	// ---------------------------------------------------------------- change

	subscribe(cb: Listener): () => void {
		this.listeners.add(cb);
		return () => this.listeners.delete(cb);
	}

	/** Signal that task data changed (UI lists re-read; persistence is told separately via markDirty). */
	touch(): void {
		this.version++;
		for (const l of Array.from(this.listeners)) {
			try { l(); } catch (e) { console.error('TaskStore listener failed', e); }
		}
	}

	// -------------------------------------------------------------- structure

	/** category list the rest of the plugin reads: nested `data.category` wins over top-level `category`. */
	categoryList(): CategoryEntry[] {
		const r = this.root || {};
		return (r.data && r.data.category) || r.category || [];
	}

	private resolveUncatSlot(root: PluginData): { holder: TaskHolder; prop: TaskListKey } {
		const nested = root.data;
		for (const prop of ['notCategoriseTasks', 'notCategoriseTasksInComplete'] as const) {
			if (nested && Array.isArray(nested[prop])) return { holder: nested, prop };
			if (Array.isArray(root[prop])) return { holder: root, prop };
		}
		return { holder: nested || root, prop: 'notCategoriseTasks' };
	}

	private makePlaceholder(): Task[] {
		const p: Task[] = [];
		this.placeholders.add(p);
		return p;
	}

	/** True when `arr` is one of the empty stand-ins we leave in the root object where a task array used to be. */
	isPlaceholder(arr: unknown): boolean {
		return typeof arr === 'object' && arr !== null && this.placeholders.has(arr);
	}

	/**
	 * Take ownership of the task arrays inside `root` (the object loaded from
	 * data.json). Task arrays are moved into chunks and replaced in `root` by
	 * empty placeholders; everything else in `root` stays exactly as it was.
	 */
	adopt(root: PluginData): void {
		this.root = root;
		this.groups = [];
		this.hotTasks = 0;
		this.garbageFiles = [];
		const slot = this.resolveUncatSlot(root);
		this.uncatHolder = slot.holder;
		this.uncatProp = slot.prop;
		const uncat = new Group(0, null, slot.prop, slot.holder);
		this.groups.push(uncat);
		this.fillGroupFromArray(uncat, slot.holder[slot.prop]);
		slot.holder[slot.prop] = this.makePlaceholder();

		const cats = this.categoryList();
		cats.forEach((cat, i) => {
			const g = new Group(i + 1, cat, 'Tasks', null);
			this.groups.push(g);
			if (cat && typeof cat === 'object') {
				const prop: TaskListKey = Array.isArray(cat.Tasks) ? 'Tasks' : (Array.isArray(cat.tasks) ? 'tasks' : 'Tasks');
				g.prop = prop;
				this.fillGroupFromArray(g, cat[prop]);
				cat[prop] = this.makePlaceholder();
			}
		});
		this.structureDirty = true;
		this.version++;
	}

	/** Split a flat array into chunks of ~chunkTarget (the array itself becomes the chunk when it already fits). */
	private fillGroupFromArray(g: Group, arr: Task[] | undefined | null): void {
		g.chunks = [];
		if (Array.isArray(arr) && arr.length > 0 && !this.isPlaceholder(arr)) {
			const size = this.chunkTarget;
			if (arr.length <= this.chunkMax) {
				this.addHotChunk(g, arr, null, true);
			} else {
				for (let i = 0; i < arr.length; i += size) {
					this.addHotChunk(g, arr.slice(i, i + size), null, true);
				}
			}
		}
		g.invalidate();
	}

	private addHotChunk(g: Group, tasks: Task[], file: string | null, dirty: boolean): Chunk {
		let done = 0;
		for (let i = 0; i < tasks.length; i++) if (isDone(tasks[i])) done++;
		const c = new Chunk(g, tasks, tasks.length, done, file, dirty);
		c.lastUse = ++this.useClock;
		g.chunks.push(c);
		this.hotTasks += tasks.length;
		if (hasStartedTasks()) c.started = this.countStarted(tasks);
		return c;
	}

	/** Used by persistence to register a cold chunk described by the manifest. */
	addColdChunk(g: Group, file: string, n: number, done: number, minDur: number | null): Chunk {
		const c = new Chunk(g, null, n, done, file, false);
		c.minDur = minDur;
		// first scan no earlier than the shortest timer in the chunk could possibly fire (null = no timers at all)
		c.nextDue = minDur == null ? Infinity : this.timerBase + minDur * 1000;
		g.chunks.push(c);
		g.invalidate();
		return c;
	}

	/** Used by persistence to register an already-loaded chunk (e.g. when everything is read at startup). */
	addLoadedChunk(g: Group, tasks: Task[], file: string, minDur: number | null): Chunk {
		const c = this.addHotChunk(g, tasks, file, false);
		c.minDur = minDur;
		g.invalidate();
		return c;
	}

	private countStarted(tasks: Task[]): number {
		let s = 0;
		for (let i = 0; i < tasks.length; i++) {
			const t = tasks[i];
			if (t != null && !isDone(t) && isTaskStarted(t.id)) s++;
		}
		return s;
	}

	/**
	 * Re-sync the group list with the root's category list. Called before
	 * reads so categories created anywhere (form, imports) show up. Existing
	 * groups are matched by category-object identity so chunks are never lost.
	 */
	syncStructure(): void {
		const cats = this.categoryList();
		let same = this.groups.length === cats.length + 1;
		if (same) {
			for (let i = 0; i < cats.length; i++) {
				if (this.groups[i + 1]!.catObj !== cats[i]) { same = false; break; }
			}
		}
		if (same) return;
		const old = new Map<CategoryEntry | null, Group>();
		for (let i = 1; i < this.groups.length; i++) old.set(this.groups[i]!.catObj, this.groups[i]!);
		const next: Group[] = [this.groups[0]!];
		const dropped: Group[] = [];
		cats.forEach((cat, i) => {
			let g = old.get(cat);
			if (g) {
				old.delete(cat);
				g.index = i + 1;
			} else {
				g = new Group(i + 1, cat, 'Tasks', null);
				if (cat && typeof cat === 'object') {
					const prop: TaskListKey = Array.isArray(cat.Tasks) ? 'Tasks' : (Array.isArray(cat.tasks) ? 'tasks' : 'Tasks');
					g.prop = prop;
					const arr = cat[prop];
					if (Array.isArray(arr) && !this.isPlaceholder(arr)) this.fillGroupFromArray(g, arr);
					cat[prop] = this.makePlaceholder();
				}
			}
			next.push(g);
		});
		old.forEach((g) => dropped.push(g));
		for (const g of dropped) this.discardGroup(g);
		this.groups = next;
		this.structureDirty = true;
		this.version++;
		this.onDirty?.();
	}

	private discardGroup(g: Group): void {
		for (const c of g.chunks) {
			c.removed = true;
			if (c.tasks) this.hotTasks -= c.tasks.length;
			if (c.file) this.garbageFiles.push(c.file);
		}
		g.chunks = [];
	}

	/** Find (or create) the group for a category name. 'Uncategorized' -> group 0. */
	groupByName(name: string): Group | null {
		this.syncStructure();
		if (name === 'Uncategorized') return this.groups[0]!;
		for (let i = 1; i < this.groups.length; i++) {
			if (this.groups[i]!.name === name) return this.groups[i]!;
		}
		return null;
	}

	/** Create a category (same placement rules the add-task form always used). */
	createCategory(name: string, color: string): Group {
		const root = this.root;
		const target = root.data ? root.data : root;
		target.category = target.category || [];
		const catObj: Category = { Name: name, color, Tasks: this.makePlaceholder() };
		target.category.push(catObj);
		this.syncStructure();
		const g = this.groups.find((x) => x.catObj === catObj);
		if (!g) throw new Error('createCategory: group not registered');
		return g;
	}

	// ------------------------------------------------------------------ access

	/** The tasks of a chunk, reading it back from storage first if it is cold. */
	tasksOf(chunk: Chunk): Task[] {
		chunk.lastUse = ++this.useClock;
		if (chunk.tasks) return chunk.tasks;
		if (!this.storage || !chunk.file) {
			chunk.tasks = [];
			return chunk.tasks;
		}
		const tasks = this.storage.read(chunk.file);
		chunk.tasks = tasks;
		let done = 0;
		for (let i = 0; i < tasks.length; i++) if (isDone(tasks[i])) done++;
		const changed = chunk.n !== tasks.length || chunk.done !== done;
		chunk.n = tasks.length;
		chunk.done = done;
		chunk.started = hasStartedTasks() ? this.countStarted(tasks) : 0;
		this.hotTasks += tasks.length;
		if (changed) chunk.group.invalidate();
		this.evictIfNeeded(chunk);
		return tasks;
	}

	/** Keep a task (by identity) resident, e.g. the global task. */
	pin(task: Task | null | undefined): void {
		if (task && typeof task === 'object') this.pins.add(task);
	}

	unpin(task: Task | null | undefined): void {
		if (task) this.pins.delete(task);
	}

	private evictable(c: Chunk): boolean {
		if (!c.tasks || c.dirty || c.started > 0 || !c.file || !this.storage) return false;
		if (this.pins.size) {
			for (const t of this.pins) if (c.tasks.indexOf(t) !== -1) return false;
		}
		return true;
	}

	/** Drop least-recently-used clean chunks until under the memory budget. */
	evictIfNeeded(keep?: Chunk): void {
		if (this.hotTasks <= this.hotBudget || !this.storage) return;
		const hot: Chunk[] = [];
		for (const g of this.groups) for (const c of g.chunks) if (c.tasks && c !== keep) hot.push(c);
		hot.sort((a, b) => a.lastUse - b.lastUse);
		for (const c of hot) {
			if (this.hotTasks <= this.hotBudget) break;
			if (!this.evictable(c)) continue;
			this.hotTasks -= c.tasks!.length;
			c.tasks = null;
		}
		if (this.hotTasks > this.hotBudget * 1.5) this.onPressure?.();
	}

	/** Number of tasks of `kind` in `group`. */
	count(group: Group, kind: Kind): number {
		return group.count(kind);
	}

	/** The `count` tasks of `kind` starting at the `from`-th one of that kind in `group` (in list order). */
	range(group: Group, kind: Kind, from: number, count: number): Task[] {
		const out: Task[] = [];
		if (count <= 0) return out;
		const pref = group.prefix(kind);
		const total = pref[pref.length - 1]!;
		if (from < 0) from = 0;
		if (from >= total) return out;
		// binary search for the chunk holding the from-th match
		let lo = 0;
		let hi = group.chunks.length - 1;
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1;
			if (pref[mid]! <= from) lo = mid; else hi = mid - 1;
		}
		let skip = from - pref[lo]!;
		const anyStarted = hasStartedTasks();
		for (let ci = lo; ci < group.chunks.length && out.length < count; ci++) {
			const chunk = group.chunks[ci]!;
			if (countOf(chunk, kind) === 0) continue;
			const tasks = this.tasksOf(chunk);
			if (kind === 'all') {
				const end = Math.min(tasks.length, skip + (count - out.length));
				for (let i = skip; i < end; i++) out.push(tasks[i]!);
				skip = 0;
				continue;
			}
			for (let i = 0; i < tasks.length && out.length < count; i++) {
				const t = tasks[i];
				if (!matches(t, kind, anyStarted)) continue;
				if (skip > 0) { skip--; continue; }
				out.push(t!);
			}
			skip = 0;
		}
		return out;
	}

	/** Visit every task (hydrates cold chunks one by one -- only for rare, explicit full scans). */
	forEachTask(cb: (task: Task, group: Group, chunk: Chunk) => void): void {
		for (const g of this.groups) {
			for (const c of g.chunks) {
				const tasks = this.tasksOf(c);
				for (let i = 0; i < tasks.length; i++) cb(tasks[i]!, g, c);
			}
		}
	}

	totals(): Totals {
		let key = this.version * 1_000_003 + this.groups.length;
		for (const g of this.groups) key += g.rev;
		if (this.totalsCache && this.totalsCache.key === key) return this.totalsCache.value;
		let total = 0;
		let completed = 0;
		let started = 0;
		for (const g of this.groups) {
			for (const c of g.chunks) {
				total += c.n;
				completed += c.done;
				started += c.started;
			}
		}
		const value: Totals = { total, completed, incomplete: total - completed, started, pending: total - completed - started, groups: this.groups.length };
		this.totalsCache = { key, value };
		return value;
	}

	// ----------------------------------------------------------------- locate

	/** Where `task` lives. Identity first (resident chunks, most recently used first), then by id. */
	locate(task: Task | null | undefined): Location | null {
		if (task == null) return null;
		const hot: Chunk[] = [];
		for (const g of this.groups) for (const c of g.chunks) if (c.tasks) hot.push(c);
		hot.sort((a, b) => b.lastUse - a.lastUse);
		for (const c of hot) {
			const i = c.tasks!.indexOf(task);
			if (i !== -1) return { chunk: c, index: i };
		}
		if (task.id != null) {
			for (const c of hot) {
				const arr = c.tasks!;
				for (let i = 0; i < arr.length; i++) {
					const t = arr[i];
					if (t && t.id === task.id) return { chunk: c, index: i };
				}
			}
		}
		return null;
	}

	/**
	 * Find a task by id. Resident chunks first; when `scanCold` is set, cold
	 * chunks are read one by one (can be slow -- use sparingly, optionally
	 * limited to one group).
	 */
	findById(id: unknown, scanCold = false, onlyGroup?: Group): Task | null {
		if (id == null) return null;
		for (const g of this.groups) {
			if (onlyGroup && g !== onlyGroup) continue;
			for (const c of g.chunks) {
				if (!c.tasks) continue;
				const arr = c.tasks;
				for (let i = 0; i < arr.length; i++) {
					const t = arr[i];
					if (t && t.id === id) return t;
				}
			}
		}
		if (!scanCold) return null;
		for (const g of this.groups) {
			if (onlyGroup && g !== onlyGroup) continue;
			for (const c of g.chunks) {
				if (c.tasks) continue;
				const arr = this.tasksOf(c);
				for (let i = 0; i < arr.length; i++) {
					const t = arr[i];
					if (t && t.id === id) return t;
				}
			}
		}
		return null;
	}

	// --------------------------------------------------------------- mutation

	private bump(chunk: Chunk): void {
		chunk.dirty = true;
		chunk.rev++;
		chunk.nextDue = 0;
		chunk.group.invalidate();
		this.onDirty?.();
	}

	/** Mark a chunk (already known) as changed. */
	markDirtyChunk(chunk: Chunk): void {
		this.bump(chunk);
	}

	/** Mark the chunk holding `task` as changed after an in-place edit of one of its fields. */
	markDirty(task: Task, hint?: Chunk): void {
		invalidateTimerParams(task);
		const loc = hint && hint.tasks && hint.tasks.indexOf(task) !== -1 ? { chunk: hint, index: 0 } : this.locate(task);
		if (loc) this.bump(loc.chunk);
	}

	/** Insert at the very front of a group's list (what the add-task form always did with unshift). */
	addToFront(group: Group, task: Task): void {
		this.syncStructure();
		let first = group.chunks[0];
		if (!first) {
			first = this.addHotChunk(group, [], null, true);
			this.structureDirty = true;
		}
		const tasks = this.tasksOf(first);
		tasks.unshift(task);
		this.afterInsert(first, task);
		this.touch();
	}

	/** Insert right after position `index` of `chunk` (timer regeneration). */
	insertAfter(chunk: Chunk, index: number, task: Task): void {
		const tasks = this.tasksOf(chunk);
		tasks.splice(index + 1, 0, task);
		this.afterInsert(chunk, task);
	}

	/** Append at the end of a group's list. */
	addToEnd(group: Group, task: Task): void {
		this.syncStructure();
		let last = group.chunks[group.chunks.length - 1];
		if (!last) {
			last = this.addHotChunk(group, [], null, true);
			this.structureDirty = true;
		}
		this.tasksOf(last).push(task);
		this.afterInsert(last, task);
		this.touch();
	}

	private afterInsert(chunk: Chunk, task: Task): void {
		chunk.n++;
		if (isDone(task)) chunk.done++;
		else if (hasStartedTasks() && isTaskStarted(task.id)) chunk.started++;
		this.hotTasks++;
		this.bump(chunk);
		if (chunk.n > this.chunkMax) this.split(chunk);
	}

	private split(chunk: Chunk): void {
		const tasks = this.tasksOf(chunk);
		const g = chunk.group;
		const at = chunk.n >> 1;
		const tail = tasks.splice(at);
		let done = 0;
		for (let i = 0; i < tail.length; i++) if (isDone(tail[i])) done++;
		const started = hasStartedTasks() ? this.countStarted(tail) : 0;
		const fresh = new Chunk(g, tail, tail.length, done, null, true);
		fresh.started = started;
		fresh.lastUse = ++this.useClock;
		chunk.n = tasks.length;
		chunk.done -= done;
		chunk.started -= started;
		chunk.dirty = true;
		chunk.nextDue = 0;
		const pos = g.chunks.indexOf(chunk);
		g.chunks.splice(pos + 1, 0, fresh);
		this.structureDirty = true;
		g.invalidate();
	}

	/** Remove `task` from its list. Returns false if it can't be found. */
	removeTask(task: Task): boolean {
		const loc = this.locate(task);
		if (!loc) return false;
		this.removeAt(loc);
		this.touch();
		return true;
	}

	private removeAt(loc: Location): Task | undefined {
		const { chunk, index } = loc;
		const tasks = this.tasksOf(chunk);
		const [t] = tasks.splice(index, 1);
		chunk.n--;
		this.hotTasks--;
		if (isDone(t)) chunk.done--;
		else if (hasStartedTasks() && t != null && isTaskStarted(t.id)) chunk.started--;
		this.bump(chunk);
		const g = chunk.group;
		if (chunk.n === 0 && g.chunks.length > 1) {
			g.chunks.splice(g.chunks.indexOf(chunk), 1);
			chunk.removed = true;
			if (chunk.file) this.garbageFiles.push(chunk.file);
			this.structureDirty = true;
			g.invalidate();
		}
		return t;
	}

	/**
	 * Set a task's completed flag, keeping counters right. When `toFront`
	 * is set and the task was just completed it is moved to the front of its
	 * group (so it tops the completed list, as before).
	 */
	setCompleted(task: Task, completed: boolean, toFront = false): boolean {
		const loc = this.locate(task);
		if (!loc) return false;
		const wasDone = isDone(task);
		const wasStarted = !wasDone && hasStartedTasks() && task.id != null && isTaskStarted(task.id);
		const g = loc.chunk.group;
		if (completed && toFront) {
			// removeAt() needs the task's old state (still in the started set) to fix the counters.
			this.removeAt(loc);
			if (task.id != null) stopTask(task.id);
			task.completed = true;
			const first = g.chunks[0] ?? this.addHotChunk(g, [], null, true);
			this.tasksOf(first).unshift(task);
			this.afterInsert(first, task);
		} else {
			task.completed = completed;
			const isNow = isDone(task);
			if (wasDone !== isNow) loc.chunk.done += isNow ? 1 : -1;
			if (completed && task.id != null) {
				// finished -- leaves the DONE-till set, and its started count goes with it
				if (wasStarted && loc.chunk.started > 0) loc.chunk.started--;
				stopTask(task.id);
			}
			this.bump(loc.chunk);
		}
		this.touch();
		return true;
	}

	/** Put a task into / take it out of the in-memory "DONE till" set. */
	setStarted(task: Task, on: boolean): void {
		if (task == null || task.id == null) return;
		const was = isTaskStarted(task.id);
		if (was === on) return;
		const loc = this.locate(task);
		if (on) startTask(task.id); else stopTask(task.id);
		if (loc && !isDone(task)) {
			loc.chunk.started += on ? 1 : -1;
			if (loc.chunk.started < 0) loc.chunk.started = 0;
			loc.chunk.group.invalidate();
		}
		this.touch();
	}

	/** After a bulk change made directly on chunk arrays (timer batches): recount and flag dirty. */
	recount(chunk: Chunk): void {
		const tasks = this.tasksOf(chunk);
		let done = 0;
		for (let i = 0; i < tasks.length; i++) if (isDone(tasks[i])) done++;
		this.hotTasks += tasks.length - chunk.n;
		chunk.n = tasks.length;
		chunk.done = done;
		chunk.started = hasStartedTasks() ? this.countStarted(tasks) : 0;
		this.bump(chunk);
		if (chunk.n > this.chunkMax) this.split(chunk);
	}

	// ----------------------------------------------------------- serialization

	/** Placeholder swap-in for JSON output: a shallow clone of the root with real (legacy) or empty (sharded) task arrays. */
	cloneForWrite(taskArray: (g: Group) => Task[]): PluginData {
		const root = this.root;
		const out: PluginData = { ...root };
		if (root.data && typeof root.data === 'object') out.data = { ...root.data };
		const holderOut = this.uncatHolder === root.data ? out.data : out;
		if (holderOut) holderOut[this.uncatProp] = taskArray(this.groups[0]!);
		const rebuildList = (listOwner: DataSection | undefined, ownerOut: DataSection | undefined) => {
			const list = listOwner && listOwner.category;
			if (!Array.isArray(list) || !ownerOut) return;
			if (list !== this.categoryList()) return;
			ownerOut.category = list.map((cat, i): CategoryEntry => {
				const g = this.groups[i + 1];
				if (!g || g.catObj !== cat || cat == null || typeof cat !== 'object') return cat;
				const copy: Category = { ...cat };
				copy[g.prop] = taskArray(g);
				return copy;
			});
		};
		rebuildList(root.data, out.data);
		rebuildList(root, out);
		return out;
	}

	/** All tasks of a group as one flat array (resident data only -- single-file mode). */
	flatten(g: Group): Task[] {
		if (g.chunks.length === 1) return this.tasksOf(g.chunks[0]!);
		const out: Task[] = [];
		for (const c of g.chunks) {
			const t = this.tasksOf(c);
			for (let i = 0; i < t.length; i++) out.push(t[i]!);
		}
		return out;
	}

	/** Chunks whose content differs from what is on disk. */
	dirtyChunks(): Chunk[] {
		const out: Chunk[] = [];
		for (const g of this.groups) for (const c of g.chunks) if (c.dirty) out.push(c);
		return out;
	}
}

export interface Totals {
	total: number;
	completed: number;
	incomplete: number;
	started: number;
	pending: number;
	groups: number;
}

/** App-wide store instance. */
export const store = new TaskStore();
