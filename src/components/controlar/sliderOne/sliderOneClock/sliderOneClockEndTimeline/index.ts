// "sliderOneClockEndTimeline": the scrollable end-of-day dot timeline.
// Ported from main.js's `slideOneEndTimeLine` (lines ~865-1054),
// since simplified on request: the magnifier glass overlay and its
// drag/scroll handle were both removed. What's left is a plain list --
// each task is a Google-Timeline-style "stop" with its own dot on the
// route line, a title/time header row, a status line, and a category
// badge -- plus the expand/collapse control bar above it.

import type { ControlarHost } from '../../../../../types';
import { getTaskCategoryColor } from '../../../../../utils/timer';
import { store, isDone } from '../../../../../store/taskStore';
import type { Task } from '../../../../../store/taskStore';
import { VirtualList } from '../../../../../ui/VirtualList';
import { GroupedTaskRows } from '../../../../../ui/taskRows';

type EndTimeLineEntry = { task: Task; catName: string; completed: boolean };

// task.time is a raw 24-hour "HH:MM" string straight from the <input
// type="time"> picker (e.g. "14:30") -- was being shown as-is, unlike the
// mockup's `.etlg-stop-time` / `.etlg-stop-linetime`, which both use a
// 12-hour clock. Splitting the conversion out since both spots below need
// the same hour math, just with/without the AM/PM suffix and a date.
const to12Hour = (time: string): { hour: number; minute: string; period: 'AM' | 'PM' } | null => {
	const [hStr, mStr] = time.split(':');
	const h = Number(hStr);
	if (!Number.isFinite(h) || !mStr) return null;
	const period: 'AM' | 'PM' = h >= 12 ? 'PM' : 'AM';
	const hour = h % 12 === 0 ? 12 : h % 12;
	return { hour, minute: mStr, period };
};

// Mirrors the mockup's `.etlg-stop-time` -- "8:40 PM", not the raw
// 24-hour "14:40" the time picker actually stores.
const formatClockTime = (time: string): string => {
	const parsed = to12Hour(time);
	return parsed ? `${parsed.hour}:${parsed.minute} ${parsed.period}` : time;
};

// Tasks don't carry their own date field -- the creation timestamp baked
// into `task.id` (`Date.now().toString()`, see form/index.ts) stands in
// for it everywhere a date is needed, falling back to today if that's
// ever missing or not a real timestamp. Pulled out on its own since the
// magnifier's date-jump input (below) needs the same lookup, not just the
// display formatting.
const taskCreatedDate = (task: Task): Date => {
	const createdMs = Number(task?.id);
	return Number.isFinite(createdMs) ? new Date(createdMs) : new Date();
};

// Mirrors the mockup's `.etlg-stop-linetime` -- a full date paired with the
// time ("2/24/26, 8:40"), not just the bare time.
const formatLineTimestamp = (task: Task, time: string): string => {
	const created = taskCreatedDate(task);
	const dateStr = `${created.getMonth() + 1}/${created.getDate()}/${String(created.getFullYear()).slice(-2)}`;
	const parsed = to12Hour(time);
	const timeStr = parsed ? `${parsed.hour}:${parsed.minute}` : time;
	return `${dateStr}, ${timeStr}`;
};

// Date-jump limits: up to this many tasks are all checked; beyond it, a sample is checked.
const EXACT_JUMP_LIMIT = 5000;
const JUMP_SAMPLES = 48;
const JUMP_REFINE = 300;

// One stop of the route: dot on the line, linetime in the gutter, title/time header,
// status line and category badge -- mirrors the "16 - endTimeLineGlass" mockup's
// `.etlg-stop` layout.
const renderStopRow = (parent: HTMLElement, task: Task, catName: string, completed: boolean): HTMLElement => {
	const desc = typeof task === 'string' ? task : (task?.description || task?.Name || 'Unnamed Task');
	const badgeColor = getTaskCategoryColor(task, catName);

	const taskRow = parent.createDiv({ cls: 'slide-one-clock-part-end-time-line-task-row' });

	// Dot marker, colored per row with the same `badgeColor` the badge below uses
	// (`border-color: currentColor` in CSS).
	const dotEl = taskRow.createDiv({
		cls: completed
			? 'slide-one-clock-part-end-time-line-task-dot-complete'
			: 'slide-one-clock-part-end-time-line-task-dot',
	});
	dotEl.style.color = badgeColor;

	// Per-dot timestamp in the gutter to the dot's left (`.etlg-stop-linetime`).
	if (task?.time) {
		taskRow.createDiv({
			cls: 'slide-one-clock-part-end-time-line-task-row-linetime',
			text: formatLineTimestamp(task, task.time),
		});
	}

	// Header row: title on the left, time on the right.
	const titleLine = taskRow.createDiv({ cls: 'slide-one-clock-part-end-time-line-task-row-title' });
	titleLine.createDiv({
		cls: completed
			? 'slide-one-clock-part-end-time-line-task-complete'
			: 'slide-one-clock-part-end-time-line-task-incomplete',
		text: desc,
	});
	if (task?.time) {
		titleLine.createDiv({
			cls: 'slide-one-clock-part-end-time-line-task-row-time',
			text: formatClockTime(task.time),
		});
	}

	// Status line (its own class so it is not as bold/large as the title).
	const statusText = completed ? 'done' : (task?.expiryTime != null ? `expires in ${task.expiryTime}m` : null);
	if (statusText) {
		const statusEl = taskRow.createDiv({
			cls: 'slide-one-clock-part-end-time-line-task-row-status',
			text: statusText,
		});
		statusEl.style.color = completed ? '#188038' : '#d93025';
	}

	// Category badge chip, pinned to the bottom of the stop.
	const badge = taskRow.createDiv({ cls: 'slide-one-clock-part-end-time-line-task-badge' });
	badge.setText(catName);
	badge.style.backgroundColor = badgeColor;
	badge.style.color = badgeColor === '#ffffff' ? '#000000' : '#ffffff';
	return taskRow;
};

export const slideOneEndTimeLine = (parentContainer: HTMLElement, instance: ControlarHost) => {
	const clockPartEndTimeLine = parentContainer
		.createDiv({ cls: 'slide-one-clock-part-end-time-line' });

	// Control bar sits ABOVE the end timeline -- holds ONLY the expand
	// button (its own markup and position are untouched; the magnifier
	// glass and its range bar/handle that used to live near here were
	// removed on request).
	const endTimeLineControls = clockPartEndTimeLine.createDiv({
		cls: 'slide-one-clock-part-end-time-line-scroll-bar-control',
	});

	const endTimeLineControlsExpandBtn = endTimeLineControls.createDiv({
		cls: 'slide-one-clock-part-end-time-line-scroll-bar-control-expand-btn',
		text: 'Expand',
	});

	// The end timeline (line + tasks) lives below the control bar
	const clockPartEndTimeLineScrollBar = clockPartEndTimeLine.createDiv({
		cls: 'slide-one-clock-part-end-time-line-scroll-bar',
	});

	// Chevron scroll-hint icon was removed on request -- couldn't get its
	// position to line up right with the real (native) scrollbar, so now
	// there's just the one real scrollbar on the list's own edge, nothing
	// extra layered on top of it.
	//
	// The route line used to be a sibling of the tasks list, sized via
	// top/bottom against the SCROLL CONTAINER's own box -- which is capped
	// at max-height (500px) by CSS. That only covers the visible window,
	// not the full scrollable list, so with enough tasks to need scrolling
	// the line ran out partway down and the rest of the rows had no line
	// next to them ("line is not proper"). Making it a CHILD of the tasks
	// list instead means it's sized against the tasks list's own full
	// height (which grows with however many tasks there are, uncapped),
	// so it now always reaches every row, scrolled or not.
	const endTimeLineBarTask = clockPartEndTimeLineScrollBar.createDiv({
		cls: 'slide-one-clock-part-end-time-line-scroll-bar-tasks',
	});

	// ---- Magnifier glass -------------------------------------------------
	// Re-added on request after being removed earlier in this project.
	// Ported from the "16 - endTimeLineGlass" mockup's actual interaction
	// logic, not just its look: a round lens shows a small moving WINDOW of
	// tasks -- `magCount` of them (3 by default), starting at `magStart` --
	// out of the full list, not the whole list at once. Two separate
	// controls move that window, same as the mockup:
	//   - the HANDLE (wheel, or vertical drag) shifts WHICH tasks show,
	//     one at a time, without changing how many.
	//   - the GEAR mounted on the handle (wheel, or horizontal drag)
	//     changes HOW MANY tasks show at once (zoom in/out). Dragging the
	//     gear, unlike scrolling it, only moves the window like the
	//     handle does -- it does NOT change the count (matches the
	//     mockup: onGearDragStart shares the same drag-move logic as the
	//     handle, only onGearWheel touches magCount).
	// A two-line label next to the gear shows the visible window's date
	// range and time range.
	let magStart = 2;
	let magCount = 3;

	// ALL tasks (incomplete first, completed after -- recently closed ones sink to
	// the bottom), listed straight from the task store. Only the rows on screen
	// (and the magnifier's few) are ever fetched.
	const renderStop = (task: Task, catName: string, parent: HTMLElement): HTMLElement =>
		renderStopRow(parent, task, catName, isDone(task));
	const rowSource = new GroupedTaskRows(['incomplete', 'completed'], renderStop);
	const entryAt = (i: number): EndTimeLineEntry | null => {
		const a = rowSource.taskAt(i);
		return a ? { task: a.task, catName: a.group.name, completed: a.kind === 'completed' } : null;
	};
	const totalCount = () => rowSource.count();

	const clampMagWindow = (start: number, count: number) => {
		const total = totalCount();
		const c = Math.max(1, Math.min(Math.max(total, 1), count));
		const s = Math.max(0, Math.min(Math.max(total - c, 0), start));
		return { start: s, count: c };
	};

	// Rebuilt closer to the mockup's actual proportions/shape after the
	// first pass turned out much smaller and plainer than the source: the
	// mockup's lens is roughly HALF the card's own width and spans several
	// rows, tilted at an angle like a handheld magnifying glass, with a
	// diagonal metal handle (milled-edge grip strip, not a round gear) and
	// the range label sitting on that handle rather than inside the lens.
	//
	// It's created as a child of the OUTER card (clockPartEndTimeLine), not
	// the scroll-bar -- the scroll-bar has `overflow-y: auto`, which per the
	// CSS overflow spec forces `overflow-x` to also clip ("auto") rather
	// than stay visible, so a big tilted assembly sized to actually look
	// like the mockup would just get silently cut off by that box. The
	// outer card has no overflow rule of its own, so this floats on top of
	// the whole card instead, clipped only if it strayed past the CARD's
	// own edges -- which it's kept well inside (see the CSS) specifically
	// because the card's own parent (the multi-widget carousel row) DOES
	// clip/scroll, and the very first version of this whole component had a
	// bug where things poking past this card landed on top of whatever
	// sibling widget sat next to it.
	const magWrap = clockPartEndTimeLine.createDiv({
		cls: 'slide-one-clock-part-end-time-line-mag-wrap',
	});
	const magLens = magWrap.createDiv({ cls: 'slide-one-clock-part-end-time-line-mag-lens' });
	const magLensInner = magLens.createDiv({ cls: 'slide-one-clock-part-end-time-line-mag-lens-inner' });
	magLens.createDiv({ cls: 'slide-one-clock-part-end-time-line-mag-shine' });
	const magHandle = magWrap.createDiv({ cls: 'slide-one-clock-part-end-time-line-mag-handle' });
	// Mockup's zoom control isn't a separate round gear -- it's a
	// milled-edge grip strip built into the handle itself (`.etlg-mag-grip-teeth`).
	// Kept the same wheel/drag behavior as before (this is still what
	// changes magCount), just re-skinned to match.
	const magGrip = magHandle.createDiv({ cls: 'slide-one-clock-part-end-time-line-mag-grip' });
	// Range label sits ON the handle now (mirrors the mockup), not inside
	// the lens -- safe to do here because the handle and lens no longer
	// overlap in this layout (handle hangs off to the lens's lower-left),
	// so there's no risk of repeating the "renders behind the lens" bug
	// from the last version, which only happened because the label's own
	// box actually overlapped the lens's.
	const magRangeLabel = magHandle.createDiv({ cls: 'slide-one-clock-part-end-time-line-mag-range-label' });
	const magRangeLine1 = magRangeLabel.createDiv({ cls: 'slide-one-clock-part-end-time-line-mag-range-label-line' });
	const magRangeLine2 = magRangeLabel.createDiv({ cls: 'slide-one-clock-part-end-time-line-mag-range-label-line' });

	// Brief flash on the grip whenever it's scrolled -- same tactile
	// feedback as the mockup's pulseGear().
	let gripPulseTimer: number | null = null;
	const pulseGrip = () => {
		if (gripPulseTimer != null) window.clearTimeout(gripPulseTimer);
		magGrip.addClass('slide-one-clock-part-end-time-line-mag-grip-active');
		gripPulseTimer = window.setTimeout(() => {
			magGrip.removeClass('slide-one-clock-part-end-time-line-mag-grip-active');
		}, 260);
	};

	const renderMagnifier = () => {
		const win = clampMagWindow(magStart, magCount);
		magStart = win.start;
		magCount = win.count;

		magLensInner.empty();
		const windowTasks: EndTimeLineEntry[] = [];
		for (let i = magStart; i < magStart + magCount; i++) {
			const e = entryAt(i);
			if (e) windowTasks.push(e);
		}

		windowTasks.forEach(({ task, catName, completed }) => {
			const desc = typeof task === 'string' ? task : (task?.description || task?.Name || 'Unnamed Task');
			const badgeColor = getTaskCategoryColor(task, catName);
			const row = magLensInner.createDiv({ cls: 'slide-one-clock-part-end-time-line-mag-row' });
			// Small date label above the title -- mirrors the mockup's
			// `.etlg-mag-row-date` (each column gets its own date since the
			// window can span more than one day, unlike the single combined
			// range shown down on the handle's label).
			if (task?.time) {
				row.createDiv({
					cls: 'slide-one-clock-part-end-time-line-mag-row-date',
					text: formatLineTimestamp(task, task.time).split(', ')[0],
				});
			}
			const title = row.createDiv({
				cls: completed
					? 'slide-one-clock-part-end-time-line-mag-row-title-complete'
					: 'slide-one-clock-part-end-time-line-mag-row-title',
				text: desc,
			});
			title.style.color = badgeColor;
			if (task?.time) {
				row.createDiv({
					cls: 'slide-one-clock-part-end-time-line-mag-row-time',
					text: formatClockTime(task.time),
				});
			}
			const statusText = completed ? 'done' : (task?.expiryTime != null ? `expires in ${task.expiryTime}m` : null);
			if (statusText) {
				const statusEl = row.createDiv({
					cls: 'slide-one-clock-part-end-time-line-mag-row-sub',
					text: statusText,
				});
				statusEl.style.color = completed ? '#188038' : '#d93025';
			}
			const badge = row.createDiv({ cls: 'slide-one-clock-part-end-time-line-mag-row-badge' });
			badge.setText(catName);
			badge.style.backgroundColor = badgeColor;
			badge.style.color = badgeColor === '#ffffff' ? '#000000' : '#ffffff';
		});

		// Range label -- mirrors the mockup's rangeLabel1/rangeLabel2: date
		// range of the window (or "Global" when none of the visible tasks
		// carry a time), plus its time range.
		const datedTasks = windowTasks.filter((t) => t.task?.time);
		if (datedTasks.length) {
			const first = datedTasks[0]!;
			const last = datedTasks[datedTasks.length - 1]!;
			const d1 = formatLineTimestamp(first.task, first.task.time ?? '').split(', ')[0];
			const d2 = formatLineTimestamp(last.task, last.task.time ?? '').split(', ')[0];
			magRangeLine1.setText(`${d1} – ${d2}`);
		} else {
			magRangeLine1.setText('Global');
		}
		const timeOf = (t: EndTimeLineEntry | undefined) => (t?.task?.time ? formatClockTime(t.task.time) : 'Now');
		magRangeLine2.setText(
			windowTasks.length ? `${timeOf(windowTasks[0])} – ${timeOf(windowTasks[windowTasks.length - 1])}` : '',
		);

		// Nudges the whole assembly down slightly as the window moves
		// further into the list -- same idea as the mockup's magOffsetY,
		// scaled down since this card is smaller than the mockup's demo.
		magWrap.style.transform = `translateY(${(magStart - 2) * 9}px)`;
	};

	const setMagWindow = (start: number, count: number) => {
		const win = clampMagWindow(start, count);
		if (win.start === magStart && win.count === magCount) return;
		magStart = win.start;
		magCount = win.count;
		renderMagnifier();
	};

	const onHandleWheel = (e: WheelEvent) => {
		e.preventDefault();
		setMagWindow(magStart + (e.deltaY > 0 ? 1 : -1), magCount);
	};
	magHandle.addEventListener('wheel', onHandleWheel);

	let magDragAxis: 'x' | 'y' | null = null;
	let magDragOrigin = 0;
	let magDragOriginStart = 0;

	const onMagDragMove = (e: MouseEvent) => {
		const pos = magDragAxis === 'y' ? e.clientY : e.clientX;
		const steps = Math.round((pos - magDragOrigin) / 16);
		setMagWindow(magDragOriginStart + steps, magCount);
	};
	const onMagDragEnd = () => {
		window.removeEventListener('mousemove', onMagDragMove);
		window.removeEventListener('mouseup', onMagDragEnd);
		magDragAxis = null;
	};
	const onHandleMouseDown = (e: MouseEvent) => {
		e.preventDefault();
		magDragAxis = 'y';
		magDragOrigin = e.clientY;
		magDragOriginStart = magStart;
		window.addEventListener('mousemove', onMagDragMove);
		window.addEventListener('mouseup', onMagDragEnd);
	};
	magHandle.addEventListener('mousedown', onHandleMouseDown);

	// Custom date jump -- a real (native) date input sits invisibly on top
	// of the range label, same size/position, so the label's own look never
	// changes. Clicking it opens the OS/Chromium date picker (this is
	// Electron, same as a browser); picking a date jumps the window to
	// whichever task's creation date is closest to it, rather than only
	// being able to nudge the window one task at a time via drag/scroll.
	const magDateInput = magRangeLabel.createEl('input', {
		type: 'date',
		cls: 'slide-one-clock-part-end-time-line-mag-date-input',
	});
	magDateInput.addEventListener('click', (e) => e.stopPropagation());
	magDateInput.addEventListener('change', () => {
		const picked = magDateInput.valueAsDate;
		const total = totalCount();
		if (!picked || !total) return;
		// valueAsDate parses as UTC midnight; compare by UTC day count so a
		// task's local creation date still matches the date the person
		// actually picked, regardless of timezone offset.
		const pickedDay = Math.floor(picked.getTime() / 86400000);
		let bestIndex = 0;
		let bestDiff = Infinity;
		const consider = (i: number) => {
			const e = entryAt(i);
			if (!e) return;
			const created = taskCreatedDate(e.task);
			const createdUtcDay = Math.floor(Date.UTC(created.getFullYear(), created.getMonth(), created.getDate()) / 86400000);
			const diff = Math.abs(createdUtcDay - pickedDay);
			if (diff < bestDiff) {
				bestDiff = diff;
				bestIndex = i;
			}
		};
		if (total <= EXACT_JUMP_LIMIT) {
			for (let i = 0; i < total; i++) consider(i);
		} else {
			// Huge list: look at evenly spaced samples, then check every task around the best one.
			for (let s = 0; s < JUMP_SAMPLES; s++) consider(Math.floor((s * (total - 1)) / (JUMP_SAMPLES - 1)));
			const from = Math.max(0, bestIndex - JUMP_REFINE);
			const to = Math.min(total, bestIndex + JUMP_REFINE);
			for (let i = from; i < to; i++) consider(i);
		}
		setMagWindow(bestIndex, magCount);
	});

	magGrip.addEventListener('wheel', (e: WheelEvent) => {
		e.preventDefault();
		e.stopPropagation();
		setMagWindow(magStart, magCount + (e.deltaY > 0 ? 1 : -1));
		pulseGrip();
	});
	magGrip.addEventListener('mousedown', (e: MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
		magDragAxis = 'x';
		magDragOrigin = e.clientX;
		magDragOriginStart = magStart;
		window.addEventListener('mousemove', onMagDragMove);
		window.addEventListener('mouseup', onMagDragEnd);
	});

	// Toggle expand state on click
	let isExpanded = false;
	endTimeLineControlsExpandBtn.addEventListener('click', () => {
		isExpanded = !isExpanded;
		// .selected-global-task also sets the expanded width (styles.css)
		if (isExpanded) {
			clockPartEndTimeLine.addClass('selected-global-task');
			endTimeLineControlsExpandBtn.setText('Collapse');
		} else {
			clockPartEndTimeLine.removeClass('selected-global-task');
			endTimeLineControlsExpandBtn.setText('Expand');
		}
	});

	// The route line is created once (it is not part of the virtual rows); it is sized
	// against the full list height because it lives in the same container as the list host.
	endTimeLineBarTask.createDiv({ cls: 'slide-one-clock-part-end-time-line-scroll-bar-line' });
	const list = new VirtualList(clockPartEndTimeLineScrollBar, endTimeLineBarTask, rowSource, {
		gap: 0,
		defaultHeights: [96],
		overscanPx: 500,
	});

	let lastVersion = -1;
	const renderEndTimeLine = () => {
		// Called every second by the timeline tick; only does work when tasks changed.
		if (store.version === lastVersion) return;
		lastVersion = store.version;
		rowSource.rebuild(store.groups);
		list.refresh();
		renderMagnifier();
	};

	renderEndTimeLine();
	instance.refreshEndTimeLine = renderEndTimeLine;
};
