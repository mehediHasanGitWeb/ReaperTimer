// "sliderOneClockGlobalClock": the live clock + selected-task countdown pipe.
// Ported verbatim from main.js's `slideOneClock` (lines ~494-567).

import { state } from '../../../../../state';
import type { ControlarHost } from '../../../../../types';
import { formatCountdown, getTaskCategoryColor } from '../../../../../utils/timer';
import { engine } from '../../../../../store/timerEngine';

export const slideOneClock = (parentContainer: HTMLElement, instance: ControlarHost) => {
	const clockEl = parentContainer.createDiv({ cls: 'slide-one-clock-part-global-colck' });
	// font / padding / radius / red background / border come from styles.css

	const clockDisplay = clockEl.createDiv({ cls: 'slide-one-clock-part-global-colck-clock' });
	const timerDisplay = clockEl.createDiv({ cls: 'slide-one-clock-part-global-colck-timer' });
	const pipeWrap = timerDisplay.createDiv({ cls: 'slide-one-time-line-task-pipe-wrap' });
	const pipeEl = pipeWrap.createDiv({ cls: 'slide-one-time-line-task-pipe' });
	const fillEl = pipeEl.createDiv({ cls: 'slide-one-time-line-task-pipe-fill' });
	const timerText = pipeWrap.createDiv({ cls: 'slide-one-time-line-task-timer' });

	const updateClock = () => {
		const now = new Date();
		clockDisplay.setText(now.toLocaleTimeString());
	};

	const updateTimer = () => {
		const globalTask = state.fileData?.data?.globalTasks;
		if (!globalTask || globalTask.completed) {
			// .is-empty: zero width, transparent (styles.css)
			fillEl.addClass('is-empty');
			timerText.setText('–');
			return;
		}
		// The user-adjusted entry (pause / preset) if there is one, else the task's own derived timer.
		const entry = engine.entryOf(globalTask);
		let remaining = null;
		let totalMs = 0;
		if (entry.paused) {
			remaining = entry.pausedRemaining != null ? entry.pausedRemaining : 0;
			totalMs = entry.pausedTotalMs || 0;
		} else if (entry.deadline != null) {
			remaining = (entry.deadline - Date.now()) / 1000;
			totalMs = entry.deadline - entry.startedAt;
		} else if (entry.durationSeconds != null && entry.durationSeconds > 0) {
			remaining = entry.durationSeconds - (Date.now() - entry.startedAt) / 1000;
			totalMs = entry.durationSeconds * 1000;
		}
		const totalSeconds = totalMs / 1000;
		const fill = totalSeconds > 0 && remaining != null
			? Math.max(0, Math.min(100, 100 * (1 - remaining / totalSeconds)))
			: 0;
		fillEl.removeClass('is-empty');
		fillEl.style.width = fill + '%';
		fillEl.style.backgroundColor = getTaskCategoryColor(globalTask, globalTask.categoryName || globalTask.category || 'Uncategorized');
		timerText.setText(remaining != null ? formatCountdown(remaining) : '–');
	};

	updateClock();
	updateTimer();
	if (instance.clockInterval) {
		window.clearInterval(instance.clockInterval);
	}
	instance.clockInterval = window.setInterval(() => {
		updateClock();
		updateTimer();
	}, 1000);
};
