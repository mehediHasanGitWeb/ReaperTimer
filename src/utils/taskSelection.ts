// Shared click-to-select behaviour for task elements in the timeline (slide 1)
// and the incomplete/complete task cards (slide 2).
// Ported from main.js (lines ~406-491); task lookups and completion changes now
// go through the chunked task store instead of scanning arrays.

import { state, PLACE_ID, safeSaveData } from '../state';
import type { ControlarHost, Task } from '../types';
import { store } from '../store/taskStore';

// `place` is typed loosely (not just `symbol`) and `instance` is optional
// because one call site in the original main.js (the completed-category
// header in slide two) passes the string "::A::" instead of a real PLACE_ID
// symbol and omits `instance` entirely -- neither branch below ends up
// matching, so it's a harmless no-op listener in both the original and here.

/** Make `task` the global (selected) task; keeps the old/new one resident in memory. */
export const setGlobalTask = (task: Task): void => {
	state.fileData.data = state.fileData.data || {};
	const prev = state.fileData.data.globalTasks;
	if (prev && prev !== task) store.unpin(prev);
	state.fileData.data.globalTasks = task;
	store.pin(task);
};

export const attachTaskSelectionListener = (taskEl: HTMLElement, taskId: string, place: symbol | string, instance?: ControlarHost) => {
	taskEl.addEventListener('click', (_e) => {
		if (place === PLACE_ID.SILDE_ONE_TIME_LINE) {
			// Store the live task object (not a copy) so the global task stays
			// in sync with the timeline and keeps its selected highlight.
			const globalTask = store.findById(taskId);

			const currentGlobalId = state.fileData?.data?.globalTasks?.id;

			if (globalTask && currentGlobalId !== taskId) {
				setGlobalTask(globalTask);

				if (instance && instance.plugin && typeof instance.plugin.saveData === 'function') {
					void safeSaveData(instance.plugin, state.fileData);
				}

				if (instance && typeof instance.refreshSlideOne === 'function') {
					instance.refreshSlideOne();
				}
			}
		}

		if (place === PLACE_ID.SILDE_TWO_NOT_COMPLPET_TASKS || place === PLACE_ID.SILDE_TWO_COMPLPET_TASKS) {
			// Find the checkbox inside the task element
			const checkbox = taskEl.querySelector<HTMLInputElement>('.task-card-checkbox');
			if (checkbox) {
				// Ensure we don't attach duplicate change listeners
				if (!checkbox.dataset.listenerAttached) {
					checkbox.dataset.listenerAttached = 'true';

					checkbox.addEventListener('change', (evt) => { void (async () => {
						const isChecked = (evt.target as HTMLInputElement).checked;
						const task = store.findById(taskId);
						if (task) {
							// Finishing a task also takes it out of "DONE till" and moves it
							// to the front of its list (top of the completed section).
							store.setCompleted(task, isChecked, isChecked);
						}

						// Persist (debounced) if instance and plugin are available
						if (instance && instance.plugin && typeof instance.plugin.saveData === 'function') {
							await safeSaveData(instance.plugin, null);
						}

						// Re-render so the task moves to the completed section when checked
						if (instance && typeof instance.refreshSlideTwo === 'function') {
							instance.refreshSlideTwo();
						}
						if (instance && typeof instance.refreshSlideOne === 'function') {
							instance.refreshSlideOne();
						}
					})(); });
				}
			}
		}
	});
};
