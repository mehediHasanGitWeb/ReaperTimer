// "sliderOneTimeline": the live incomplete-task countdown timeline (with the
// range filter input) shown on slide 1, and reused in the sidebar view.
//
// Scale notes: the rows are a VirtualList (only the ~dozen rows on screen
// exist in the DOM), the per-second tick updates just those rows in place, and
// the countdown values come from the timer engine (derived from each task's own
// fields, nothing is stored per task). Expiry/regeneration is no longer done
// here -- the timer engine does it for ALL tasks in the background (main.ts)
// and tells the store, which refreshes this list.

import { state, PLACE_ID } from '../../../../state';
import type { ControlarHost } from '../../../../types';
import { formatCountdown, getTaskCategoryColor } from '../../../../utils/timer';
import { attachTaskSelectionListener } from '../../../../utils/taskSelection';
import { store, isDone } from '../../../../store/taskStore';
import type { Group, Chunk, Task } from '../../../../store/taskStore';
import { engine } from '../../../../store/timerEngine';
import { timerParams } from '../../../../store/timerParams';
import { VirtualList } from '../../../../ui/VirtualList';
import { GroupedTaskRows, ArrayTaskRows } from '../../../../ui/taskRows';
import type { ArrayRow } from '../../../../ui/taskRows';
import { visibleGroups, filterKey } from '../../../../utils/filterGroups';

const PIPE_SPLASH_DROP_COUNT = 6;
const PIPE_SPLASH_DROP_COUNT_SMALL = 2;

// Small burst of droplets (+ an expanding ring for a "big" splash) fired
// once the liquid fill's width transition actually reaches its target —
// the "impact" a real liquid makes when it arrives. `big` scales it up for
// a task that just appeared or was regenerated after expiring; every
// smaller, routine countdown tick still gets a light 2-droplet flick
// instead of nothing, so the pipe reads as continuously live liquid the
// way the reference clip does, rather than something that only splashes
// on rare, big events.
const spawnPipeSplash = (anchor: HTMLElement, x: number, y: number, color: string, big: boolean) => {
	const splash = anchor.createDiv({ cls: 'slide-one-time-line-task-pipe-splash' });
	splash.style.left = `${x}px`;
	splash.style.top = `${y}px`;

	if (big) {
		const ring = splash.createDiv({ cls: 'slide-one-time-line-task-pipe-splash-ring' });
		ring.style.borderColor = color;
	}

	const dropCount = big ? PIPE_SPLASH_DROP_COUNT : PIPE_SPLASH_DROP_COUNT_SMALL;
	for (let i = 0; i < dropCount; i++) {
		// Fan the droplets mostly upward/outward — like liquid meeting the
		// tube wall as it arrives — rather than a perfectly even burst.
		const angleDeg = -90 + (Math.random() - 0.5) * 160;
		const angleRad = (angleDeg * Math.PI) / 180;
		const distance = (big ? 9 + Math.random() * 9 : 4 + Math.random() * 4);
		const dx = Math.cos(angleRad) * distance;
		const dy = Math.sin(angleRad) * distance;

		const drop = splash.createDiv({ cls: 'slide-one-time-line-task-pipe-splash-drop' });
		drop.style.backgroundColor = color;
		drop.style.setProperty('--dx', `${dx.toFixed(1)}px`);
		drop.style.setProperty('--dy', `${dy.toFixed(1)}px`);
		drop.style.animationDelay = `${Math.floor(Math.random() * 50)}ms`;
	}

	// Cleanup — each splash is a short-lived, self-contained burst of new
	// nodes layered on top of the (now persistent, never-rebuilt) pipe row,
	// so removing it after its animation finishes doesn't touch — and can't
	// flicker — anything else on the row.
	window.setTimeout(() => splash.remove(), 450);
};

// Per-task DOM refs kept alive across renderTimeLine() ticks. Reusing these
// (instead of tearing the row down and rebuilding it every second, which is
// what caused the pipe to visibly flicker — every continuously-running CSS
// animation on it, plus the width transition, restarted from scratch each
// tick) is what lets the shimmer/edge-blob animations run smoothly and the
// fill only move the small amount one real second of countdown accounts for.
interface PipeRowRefs {
	taskEl: HTMLElement;
	pipeWrap: HTMLElement;
	pipeEl: HTMLElement;
	fillEl: HTMLElement;
	timerEl: HTMLElement;
	taskText: HTMLElement;
	categoryText: HTMLElement;
	fillColor: string;
	lastPercent: number;
}

// A jump at least this big gets the full ring + 6-droplet splash — a task
// that just appeared or was regenerated after expiring. Anything smaller
// (the routine per-second countdown tick) still gets the small 2-droplet
// version from spawnPipeSplash's `big: false` path, rather than no splash
// at all — that's what "not splashing" was: only ever firing on rare big
// jumps meant it basically never fired in normal use.
const SPLASH_JUMP_THRESHOLD = 8;

const updateRowFill = (row: PipeRowRefs, targetPercent: number) => {
	const delta = targetPercent - row.lastPercent;
	row.lastPercent = targetPercent;
	if (delta > 0.05) {
		const big = delta > SPLASH_JUMP_THRESHOLD;
		const onArrived = (ev: TransitionEvent) => {
			if (ev.propertyName !== 'width') return;
			row.fillEl.removeEventListener('transitionend', onArrived);
			const splashX = row.pipeEl.offsetLeft + row.fillEl.offsetWidth;
			const splashY = row.pipeEl.offsetTop + row.pipeEl.offsetHeight / 2;
			spawnPipeSplash(row.pipeWrap, splashX, splashY, row.fillColor, big);
		};
		row.fillEl.addEventListener('transitionend', onArrived);
	} else if (Math.abs(delta) < 0.05) {
		return;
	}
	row.fillEl.style.width = `${targetPercent}%`;
};


interface RowInfo {
	refs: PipeRowRefs;
	task: Task;
	catName: string;
	cls: string;
}

/** Max rows the "finishing within N seconds" filter keeps. */
const MAX_RANGE_ROWS = 5000;
/** Time one tick may spend scanning for range matches. */
const RANGE_SCAN_BUDGET_MS = 10;

/**
 * "Finishing within N seconds" filter. Scans the visible groups chunk by chunk,
 * skipping whole chunks that cannot hold a match (from the chunk's next-due time
 * or its persisted shortest-timer hint), and resumes where it stopped on the
 * next tick when a time slice runs out -- so the UI never blocks on a huge list.
 */
class RangeScanner {
	private groups: Group[] = [];
	private gi = 0;
	private ci = 0;
	private limit = 0;
	private range = 0;
	private globalChunk: Chunk | null = null;
	found: ArrayRow[] = [];
	complete = true;

	begin(groups: Group[], rangeSeconds: number) {
		this.groups = groups;
		this.gi = 0;
		this.ci = 0;
		this.range = rangeSeconds;
		this.limit = Date.now() + rangeSeconds * 1000;
		this.found = [];
		this.complete = false;
		const g = state.fileData?.data?.globalTasks;
		const loc = g ? store.locate(g) : null;
		this.globalChunk = loc ? loc.chunk : null;
	}

	private canSkip(c: Chunk): boolean {
		if (c.n - c.done <= 0) return true;
		if (c === this.globalChunk) return false;
		if (c.nextDue > 0) return c.nextDue > this.limit;
		// no schedule yet: a cold chunk's persisted hint is enough to rule it out
		if (!c.tasks) {
			if (c.minDur == null) return true;
			return engine.base + c.minDur * 1000 > this.limit;
		}
		return false;
	}

	/** Continue scanning; returns true when the whole list has been covered. */
	step(budgetMs: number): boolean {
		const start = performance.now();
		const now = Date.now();
		while (this.gi < this.groups.length) {
			const g = this.groups[this.gi]!;
			while (this.ci < g.chunks.length) {
				if (performance.now() - start > budgetMs) return false;
				const c = g.chunks[this.ci++]!;
				if (this.canSkip(c)) continue;
				const tasks = store.tasksOf(c);
				for (let i = 0; i < tasks.length; i++) {
					const t = tasks[i];
					if (t == null || isDone(t)) continue;
					if (timerParams(t).mode === 'none') continue;
					const rem = engine.remainingSeconds(engine.entryOf(t), now);
					if (rem != null && rem > 0 && rem <= this.range) {
						this.found.push({ task: t, groupName: g.name });
						if (this.found.length >= MAX_RANGE_ROWS) { this.complete = true; return true; }
					}
				}
			}
			this.gi++;
			this.ci = 0;
		}
		this.complete = true;
		return true;
	}
}

const sameRows = (a: ArrayRow[], b: ArrayRow[]): boolean => {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i]!.task !== b[i]!.task) return false;
	return true;
};

export const slideOneTimeLine = (parentContainer: HTMLElement, instance: ControlarHost) => {
	const timeline = parentContainer.createDiv({ cls: 'slide-one-time-line' }).createDiv({ cls: 'slide-one-time-line-task-scroll-bar' });

	const taskList = timeline.createDiv({ cls: 'slide-one-time-line-task-list' });
	let noTasksEl: HTMLElement | null = null;

	if (!instance.taskTimers) {
		instance.taskTimers = {};
	}

	let rangeFilter: number | null = null;
	const rows = new Map<HTMLElement, RowInfo>();

	const rowClass = (task: Task) => {
		const globalId = state.fileData?.data?.globalTasks?.id;
		return task.id === globalId ? 'slide-one-time-line-task-global-task' : 'slide-one-time-line-task';
	};

	const describe = (task: Task) => `${task.description || task.title || 'Task'}`;

	const renderRow = (task: Task, catName: string, parent: HTMLElement): HTMLElement => {
		const entry = engine.entryOf(task);
		const now = Date.now();
		const remaining = engine.remainingSeconds(entry, now);
		const taskCls = rowClass(task);
		const fillColor = String(getTaskCategoryColor(task, catName));
		const targetFillPercent = engine.fillPercent(entry, now);
		const timerText = remaining != null ? formatCountdown(Math.max(0, remaining)) : 'no timer';
		// The task's own name is the primary label; the category is conveyed by
		// the pipe's fill color, a small line under the name, and the tooltip.
		const taskTextValue = describe(task);

		// The fill starts at width: 0 via the base CSS rule and is set to its real
		// target a couple of frames later, so the CSS width transition has
		// something to animate from and the liquid visibly pours in on arrival.
		const taskEl = parent.createDiv({ cls: taskCls });
		const pipeWrap = taskEl.createDiv({ cls: 'slide-one-time-line-task-pipe-wrap' });
		const pipeEl = pipeWrap.createDiv({ cls: 'slide-one-time-line-task-pipe' });
		const fillEl = pipeEl.createDiv({ cls: 'slide-one-time-line-task-pipe-fill' });
		fillEl.style.backgroundColor = fillColor;
		fillEl.createDiv({ cls: 'slide-one-time-line-task-pipe-fill-reflection' });
		const timerEl = pipeWrap.createDiv({ cls: 'slide-one-time-line-task-timer' });
		timerEl.setText(timerText);
		const taskText = taskEl.createDiv({ cls: 'slide-one-time-line-task-text' });
		taskText.setText(taskTextValue);
		taskText.title = `${catName ? '[' + catName + '] ' : ''}${taskTextValue}`;
		const categoryText = taskEl.createDiv({ cls: 'slide-one-time-line-task-category' });
		categoryText.setText(catName || '');

		attachTaskSelectionListener(taskEl, task.id, PLACE_ID.SILDE_ONE_TIME_LINE, instance);

		const refs: PipeRowRefs = { taskEl, pipeWrap, pipeEl, fillEl, timerEl, taskText, categoryText, fillColor, lastPercent: 0 };
		rows.set(taskEl, { refs, task, catName, cls: taskCls });

		window.requestAnimationFrame(() => {
			window.requestAnimationFrame(() => {
				if (taskEl.isConnected) updateRowFill(refs, targetFillPercent);
			});
		});
		return taskEl;
	};

	const release = (el: HTMLElement) => { rows.delete(el); };

	const groupedRows = new GroupedTaskRows(['incomplete'], renderRow, release);
	const arrayRows = new ArrayTaskRows(renderRow, release);
	groupedRows.rebuild([]);
	let active: GroupedTaskRows | ArrayTaskRows = groupedRows;

	const list = new VirtualList(timeline, taskList, active, {
		gap: 8,
		defaultHeights: [64],
		overscanPx: 400,
		windowClass: 'vl-window-timeline',
	});

	// In-place update of the rows on screen: countdown text, fill, highlight class.
	const updateRows = () => {
		const now = Date.now();
		rows.forEach((info) => {
			const { refs, task, catName } = info;
			const entry = engine.entryOf(task);
			const remaining = engine.remainingSeconds(entry, now);
			const cls = rowClass(task);
			if (cls !== info.cls) { info.cls = cls; refs.taskEl.className = cls; }
			const fillColor = String(getTaskCategoryColor(task, catName));
			if (refs.fillColor !== fillColor) {
				refs.fillColor = fillColor;
				refs.fillEl.style.backgroundColor = fillColor;
			}
			const timerText = remaining != null ? formatCountdown(Math.max(0, remaining)) : 'no timer';
			if (refs.timerEl.textContent !== timerText) refs.timerEl.setText(timerText);
			const name = describe(task);
			if (refs.taskText.textContent !== name) {
				refs.taskText.setText(name);
				refs.taskText.title = `${catName ? '[' + catName + '] ' : ''}${name}`;
			}
			updateRowFill(refs, engine.fillPercent(entry, now));
		});
	};

	const scanner = new RangeScanner();
	let lastVersion = -1;
	let lastKey = '';
	let lastRange: number | null = null;
	let scanning = false;

	const showEmptyMessage = (show: boolean) => {
		if (show && !noTasksEl) {
			noTasksEl = taskList.createDiv({ text: 'No incomplete tasks available.' });
			taskList.insertBefore(noTasksEl, list.host);
		} else if (!show && noTasksEl) {
			noTasksEl.remove();
			noTasksEl = null;
		}
	};

	const useSource = (src: GroupedTaskRows | ArrayTaskRows) => {
		if (src !== active) {
			active = src;
			list.setSource(src);
		} else {
			list.refresh();
		}
	};

	const renderTimeLine = () => {
		const filter = instance?.slideTwoFilter;
		const key = filterKey(filter);
		const groups = visibleGroups(filter);
		const structural = store.version !== lastVersion || key !== lastKey || rangeFilter !== lastRange;
		lastVersion = store.version;
		lastKey = key;
		lastRange = rangeFilter;

		let anyIncomplete = false;
		for (const g of groups) if (g.count('incomplete') > 0) { anyIncomplete = true; break; }
		showEmptyMessage(!anyIncomplete);

		if (rangeFilter == null) {
			scanning = false;
			if (structural || active !== groupedRows) {
				groupedRows.rebuild(groups);
				useSource(groupedRows);
			} else {
				updateRows();
			}
			return;
		}

		// "Finishing within N seconds": (re)start a scan when something changed or the last
		// one finished (time moved on), otherwise keep going where it stopped.
		if (structural || !scanning) {
			scanner.begin(groups, rangeFilter);
			scanning = true;
		}
		const done = scanner.step(RANGE_SCAN_BUDGET_MS);
		if (done) scanning = false;
		const found = scanner.found;
		if (active !== arrayRows || !sameRows(found, arrayRows.rows)) {
			arrayRows.rows = found.slice();
			useSource(arrayRows);
		} else {
			updateRows();
		}
	};

	renderTimeLine();

	// Metal handle bar (mirrors the "17 . rangeLabel" mockup, itself built
	// from the endTimeLine magnifier's own handle metal + grip-teeth
	// material): a grip-teeth block on the left, a decorative tick that
	// reads the typed seconds value across a 0-120s span, the number
	// input doing the real filtering, and a small attachment loop on the
	// right end.
	const timeLineRange = timeline.createDiv({ cls: 'slide-one-time-line-range' });
	timeLineRange.createDiv({ cls: 'slide-one-time-line-range-grip' });
	const rangeTick = timeLineRange.createDiv({ cls: 'slide-one-time-line-range-tick' });
	// (The original also passed `min`/`step` here, but those aren't DomElementInfo
	// fields and never became attributes, so they were dropped.)
	const rangeScrollInput = timeLineRange.createEl('input', {
		type: 'number',
		placeholder: 'seconds',
		cls: 'slide-one-time-line-range-scroll',
		attr: { id: 'slide-one-time-line-range-scroll-input' },
	});
	timeLineRange.createDiv({ cls: 'slide-one-time-line-range-loop' });

	// Decorative readout only (mirrors the mockup's `pctFor`) -- clamps the
	// typed value to 0-120s and maps it across the bar; the real filtering
	// is `rangeFilter`.
	const updateRangeTick = () => {
		const raw = Number(rangeScrollInput.value);
		const clamped = (!Number.isFinite(raw) || raw <= 0) ? 0 : Math.max(0, Math.min(120, raw));
		const frac = clamped / 120;
		rangeTick.style.left = `calc(36px + ${frac} * (100% - 50px))`;
	};
	updateRangeTick();

	rangeScrollInput.addEventListener('input', () => {
		const val = Number(rangeScrollInput.value);
		rangeFilter = (Number.isFinite(val) && val > 0) ? val : null;
		renderTimeLine();
		updateRangeTick();
	});

	instance.refreshSlideOne = () => {
		renderTimeLine();
		if (instance && typeof instance.refreshEndTimeLine === 'function') {
			instance.refreshEndTimeLine();
		}
	};

	// Row gap follows the theme (kept fixed unless CSS says otherwise).
	const syncGap = () => {
		const g = parseFloat(getComputedStyle(taskList).rowGap);
		if (isFinite(g)) list.setGap(g);
	};
	syncGap();

	if (instance.timelineInterval) {
		window.clearInterval(instance.timelineInterval);
	}
	instance.timelineInterval = window.setInterval(() => {
		if (!timeline.isConnected) {
			if (instance.timelineInterval) { window.clearInterval(instance.timelineInterval); instance.timelineInterval = null; }
			list.destroy();
			return;
		}
		if (instance && typeof instance.refreshSlideOne === 'function') {
			instance.refreshSlideOne();
		}
	}, 1000);
};
