// Timer engine: drives the per-task countdowns (gap cycles, expiry timers)
// without ever looking at every task each second.
//
// Before: every second, for EVERY incomplete task, the timeline code built a
// timer entry object, checked it, and rebuilt a DOM row. At scale that is the
// single biggest cost.
//
// Now: a task's timer is *derived* from the task itself (its own gap / expiry
// fields plus when it started) -- no per-task entry objects. Each chunk of tasks
// remembers the earliest moment any of its timers can fire (`nextDue`), so a
// tick only has to look at chunks whose time has come. Work per tick is bounded
// by a time budget; if a huge number of timers fire at once (e.g. millions of
// tasks sharing one 5-minute gap) the backlog is worked off over several ticks
// instead of freezing the UI.
//
// Semantics are the ones the timeline always had:
//   * expiry-only task      -> completed when it expires
//   * gap cycle             -> completed, and an identical fresh copy is inserted
//                              right after it, every `gap` minutes
//   * gap cycle + deadline  -> same, but after the deadline it just completes
//   * the global task (status bar / clock) keeps its own, user-adjustable
//     entry in `overrides` (presets, pause) and is handled first.

import { store, isDone } from './taskStore';
import type { Chunk } from './taskStore';
import type { Task, TimerEntry } from '../types';
import { timerParams } from './timerParams';
import type { TimerParams } from './timerParams';
import { getExpiredMinutes } from '../utils/timer';
import { stopTask } from '../utils/startedTasks';

export type { TimerEntry };

export interface TickResult {
	/** tasks that completed/regenerated this tick */
	fired: number;
	/** more chunks are due than the time budget allowed -- call again soon */
	backlog: boolean;
}

export class TimerEngine {
	/** when "tasks that existed at startup" started counting */
	base = Date.now();
	/** random id of this session; tags `_t0` so a stale start time from an older session is ignored */
	readonly sid = Math.random().toString(36).slice(2, 10);
	/** user-adjustable entries (the global task); this is the plugin's shared `taskTimers` object */
	overrides: Record<string, TimerEntry> = {};
	/** current global task (live object) or null */
	getGlobal: () => Task | null = () => null;
	/** called when the global task expired and was replaced by its regenerated copy */
	onGlobalReplaced: (oldTask: Task, newTask: Task | null) => void = () => { /* set by main */ };
	private seq = 0;
	private mutated = false;

	setOverrides(o: Record<string, TimerEntry>): void {
		this.overrides = o;
	}

	restart(): void {
		this.base = Date.now();
		store.timerBase = this.base;
	}

	// ---------------------------------------------------------------- derive

	startOf(t: Task): number {
		return t._s === this.sid && typeof t._t0 === 'number' ? t._t0 : this.base;
	}

	private clockDeadline(t: Task, t0: number): number {
		const e = getExpiredMinutes(t);
		if (e && e.type === 'clock') {
			const d = new Date(t0);
			return new Date(d.getFullYear(), d.getMonth(), d.getDate(), e.hour, e.minute).getTime();
		}
		return Infinity;
	}

	/** Persistent "stop cycling at" time for gap-cycle-until-deadline tasks (set on first sight, kept in the task). */
	private ensureDeadline(t: Task, t0: number): number {
		if (!t.timerDeadline) {
			const e = getExpiredMinutes(t);
			if (e && e.type === 'clock') {
				const d = new Date(t0);
				t.timerDeadline = new Date(d.getFullYear(), d.getMonth(), d.getDate(), e.hour, e.minute).getTime();
				this.mutated = true;
			} else if (e) {
				t.timerDeadline = t0 + e.minutes * 60000;
				this.mutated = true;
			} else {
				return Infinity;
			}
		}
		return t.timerDeadline;
	}

	/** Epoch ms at which the task's timer fires (Infinity = never). */
	expiryOf(t: Task, p: TimerParams = timerParams(t)): number {
		if (p.mode === 'none') return Infinity;
		const t0 = this.startOf(t);
		if (p.mode === 'expiredTimer') {
			return p.dur != null ? t0 + p.dur * 1000 : this.clockDeadline(t, t0);
		}
		if (p.dur == null) return Infinity;
		const gapEnd = t0 + p.dur * 1000;
		if (p.mode === 'gapCycleUntilDeadline') return Math.min(gapEnd, this.ensureDeadline(t, t0));
		return gapEnd;
	}

	/** Timer entry for a task: the user-adjustable override if there is one, otherwise derived from the task. */
	entryOf(t: Task): TimerEntry {
		const ov = this.overrides[t.id];
		if (ov) return ov;
		const p = timerParams(t);
		const entry: TimerEntry = { startedAt: this.startOf(t), durationSeconds: p.dur, mode: p.mode };
		if (p.mode === 'expiredTimer' && p.dur == null) {
			const dl = this.clockDeadline(t, entry.startedAt);
			if (dl !== Infinity) entry.deadline = dl;
		}
		return entry;
	}

	/** Make sure the task has its own stored entry (needed before pausing / presets / status-bar use). */
	materialize(t: Task): TimerEntry {
		let e = this.overrides[t.id];
		if (!e) {
			e = { ...this.entryOf(t) };
			this.overrides[t.id] = e;
		}
		return e;
	}

	remainingSeconds(entry: TimerEntry | undefined | null, now = Date.now()): number | null {
		if (!entry) return null;
		if (entry.paused) return entry.pausedRemaining != null ? entry.pausedRemaining : 0;
		if (entry.deadline != null) return (entry.deadline - now) / 1000;
		if (entry.durationSeconds != null && entry.durationSeconds > 0) {
			return entry.durationSeconds - (now - entry.startedAt) / 1000;
		}
		return null;
	}

	fillPercent(entry: TimerEntry | undefined | null, now = Date.now()): number {
		if (!entry) return 0;
		const remaining = this.remainingSeconds(entry, now);
		if (remaining == null) return 0;
		let totalMs: number;
		if (entry.paused) {
			totalMs = entry.pausedTotalMs || 0;
		} else if (entry.deadline != null) {
			totalMs = entry.deadline - entry.startedAt;
		} else if (entry.durationSeconds != null && entry.durationSeconds > 0) {
			totalMs = entry.durationSeconds * 1000;
		} else {
			return 0;
		}
		if (totalMs <= 0) return 0;
		return Math.max(0, Math.min(100, 100 * (1 - remaining / (totalMs / 1000))));
	}

	// -------------------------------------------------------------- expiry

	/** Start a freshly created task's timer now (instead of at app startup). */
	stampNew(t: Task, now = Date.now()): void {
		t._t0 = now;
		t._s = this.sid;
	}

	private newId(now: number): string {
		return `${now}-${(this.seq++) % 1_000_000_000}`;
	}

	private regenerate(t: Task, now: number): Task {
		const nt = { ...t };
		nt.id = this.newId(now);
		nt.completed = false;
		nt._t0 = now;
		nt._s = this.sid;
		return nt;
	}

	/**
	 * Fire a task whose timer ran out. Marks it completed and returns its
	 * regenerated copy (or null when it just completes).
	 */
	private fire(t: Task, mode: string, now: number): Task | null {
		t.completed = true;
		if (t.id != null) stopTask(t.id);
		if (mode === 'expiredTimer') return null;
		if (mode === 'gapCycleUntilDeadline' && t.timerDeadline && now >= t.timerDeadline) return null;
		return this.regenerate(t, now);
	}

	/** Expiry of the global task, using its (possibly user-adjusted) entry. Returns number of tasks fired. */
	private processGlobal(now: number): number {
		const g = this.getGlobal();
		if (!g || isDone(g)) return 0;
		const entry = this.overrides[g.id] ?? this.entryOf(g);
		if (entry.mode === 'none') return 0;
		const mode = entry.mode;
		const t0 = this.startOf(g);
		let deadlinePassed = false;
		if (mode === 'gapCycleUntilDeadline') {
			const dl = this.ensureDeadline(g, t0);
			deadlinePassed = dl !== Infinity && now >= dl;
		}
		const remaining = this.remainingSeconds(entry, now);
		if (!(deadlinePassed || (remaining != null && remaining <= 0))) return 0;
		const loc = store.locate(g);
		const nt = this.fire(g, mode, now);
		delete this.overrides[g.id];
		if (loc) {
			if (nt) store.insertAfter(loc.chunk, loc.index, nt);
			store.recount(loc.chunk);
		}
		this.onGlobalReplaced(g, nt);
		return 1;
	}

	/** Scan one chunk: fire everything that is due, compute when it needs looking at next. */
	scanChunk(chunk: Chunk, now: number): number {
		const tasks = store.tasksOf(chunk);
		const g = this.getGlobal();
		this.mutated = false;
		let next = Infinity;
		let due = false;
		for (let i = 0; i < tasks.length; i++) {
			const t = tasks[i];
			if (t == null || isDone(t) || t === g) continue;
			const p = timerParams(t);
			if (p.mode === 'none') continue;
			const ex = this.expiryOf(t, p);
			if (ex <= now) { due = true; break; }
			if (ex < next) next = ex;
		}
		if (!due) {
			if (this.mutated) store.markDirtyChunk(chunk);
			chunk.nextDue = next;
			return 0;
		}
		const out: Task[] = [];
		let fired = 0;
		next = Infinity;
		for (let i = 0; i < tasks.length; i++) {
			const t = tasks[i];
			out.push(t!);
			if (t == null || isDone(t) || t === g) continue;
			const p = timerParams(t);
			if (p.mode === 'none') continue;
			const ex = this.expiryOf(t, p);
			if (ex <= now) {
				const nt = this.fire(t, p.mode, now);
				fired++;
				if (nt) {
					out.push(nt);
					const ex2 = this.expiryOf(nt, timerParams(nt));
					if (ex2 < next) next = ex2;
				}
			} else if (ex < next) {
				next = ex;
			}
		}
		chunk.tasks = out;
		store.recount(chunk);
		chunk.nextDue = next;
		return fired;
	}

	/**
	 * One engine step. `budgetMs` bounds the time spent scanning chunks.
	 * Returns how many tasks fired and whether due chunks are left over.
	 */
	tick(now = Date.now(), budgetMs = 8): TickResult {
		let fired = this.processGlobal(now);
		const due: Chunk[] = [];
		for (const g of store.groups) {
			for (const c of g.chunks) if (c.nextDue <= now) due.push(c);
		}
		let backlog = false;
		if (due.length) {
			// resident chunks first (cheap, and they hold what is on screen), then oldest due first
			due.sort((a, b) => (a.tasks ? 0 : 1) - (b.tasks ? 0 : 1) || a.nextDue - b.nextDue);
			const start = performance.now();
			for (let i = 0; i < due.length; i++) {
				if (i > 0 && performance.now() - start > budgetMs) { backlog = true; break; }
				const c = due[i]!;
				// a chunk that was dropped from its group (emptied) must not be revived
				if (c.removed) continue;
				fired += this.scanChunk(c, now);
			}
		}
		this.pruneOverrides();
		return { fired, backlog };
	}

	/** Keep only the global task's entry (anything else is derived on demand). */
	private pruneOverrides(): void {
		const g = this.getGlobal();
		const keep = g ? String(g.id) : null;
		for (const id of Object.keys(this.overrides)) {
			if (id !== keep) delete this.overrides[id];
		}
	}
}

export const engine = new TimerEngine();
