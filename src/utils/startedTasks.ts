// Which tasks are currently in the "DONE till" menu -- started from their
// incomplete card's Start button and not finished/stopped yet.
//
// Deliberately in-memory only ("temporary"): nothing is written to
// data.json, so a task's own record never changes just because Start was
// pressed, and after a plugin reload every started task is back in the
// normal incomplete list. A task leaves this set when it is completed
// (taskSelection.ts's Done checkbox) or stopped (the card's Stop button).

import type { Task } from '../types';

const startedIds = new Set<string>();

type TaskId = string | number | null | undefined;

export const isTaskStarted = (id: TaskId): boolean => id != null && startedIds.has(String(id));

export const startTask = (id: TaskId): void => {
	if (id != null) startedIds.add(String(id));
};

export const stopTask = (id: TaskId): void => {
	if (id != null) startedIds.delete(String(id));
};

/** Incomplete and not started -- belongs in the normal incomplete list. */
export const isPendingTask = (task: Task | null | undefined): boolean => !!task && task.completed === false && !isTaskStarted(task.id);

/** Started and not completed yet -- belongs in the "DONE till" menu. */
export const isDoneTillTask = (task: Task | null | undefined): boolean => !!task && !task.completed && isTaskStarted(task.id);

/** Cheap check so hot paths can skip per-task started lookups when nothing is started (the common case). */
export const hasStartedTasks = (): boolean => startedIds.size > 0;
