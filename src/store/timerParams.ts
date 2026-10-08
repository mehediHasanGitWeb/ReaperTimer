// Per-task timer parameters (mode + duration), derived from the task's own
// fields. Parsing them is regex work, so the result is cached on the task
// under a symbol key -- symbol keys are skipped by JSON.stringify, so nothing
// extra ever lands in data.json -- and thrown away together with the task
// object when its chunk is evicted.

import { getTimerMode, getTimerDurationSeconds } from '../utils/timer';
import { TP } from '../types';
import type { Task, TimerParams } from '../types';

export { TP };
export type { TimerParams };

export const timerParams = (t: Task): TimerParams => {
	let p = t[TP];
	if (!p) {
		const mode = getTimerMode(t);
		p = { mode, dur: getTimerDurationSeconds(t, mode) };
		t[TP] = p;
	}
	return p;
};

export const invalidateTimerParams = (t: Task | null | undefined): void => {
	if (t && typeof t === 'object') delete t[TP];
};

/**
 * Lower bound (seconds) of the shortest timer among the pending tasks, or
 * null when none of them has a timer. Clock-time expiries have no fixed
 * duration, so they count as 0 ("check right away").
 */
export const computeMinDur = (tasks: readonly (Task | null | undefined)[]): number | null => {
	let min: number | null = null;
	for (let i = 0; i < tasks.length; i++) {
		const t = tasks[i];
		if (t == null || t.completed || t.isCompleted) continue;
		const p = timerParams(t);
		if (p.mode === 'none') continue;
		const d = p.dur == null ? 0 : p.dur;
		if (min === null || d < min) min = d;
	}
	return min;
};
