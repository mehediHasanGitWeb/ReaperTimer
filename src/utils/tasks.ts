// Task lookup helpers. Lookups go through the chunked task store; nothing here
// scans or copies the whole task list any more.

import { store } from '../store/taskStore';
import type { Task } from '../types';

/** The live task object with this id (resident chunks first, then -- only if needed -- cold ones). */
export const findTaskById = (_data: unknown, taskId: string | null | undefined): Task | null => {
	if (taskId == null) return null;
	return store.findById(taskId, true);
};
