// "sliderTwoTaskSummery": the Total/Done/Pending/Categories/Uncategorized/Gap
// summary row at the top of slide 2's task list.
//
// Numbers come from the task store's per-chunk counters (O(number of chunks)),
// never from scanning tasks, so this costs the same for 10 tasks or 10 million.

import { store } from '../../../../store/taskStore';

// Big counts are abbreviated (2.5M, 120k) so they fit the small ring / stat cells; the full
// number is kept in the tooltip.
export const formatCount = (n: number): string => {
	if (n < 100_000) return String(n);
	const trim = (v: number) => String(Math.round(v * 100) / 100);
	if (n < 1_000_000) return `${trim(n / 1_000)}k`;
	if (n < 1_000_000_000) return `${trim(n / 1_000_000)}M`;
	return `${trim(n / 1_000_000_000)}B`;
};

export const renderSliderTwoTaskSummary = (host: HTMLElement) => {
	host.empty();
	const summaryEl = host.createDiv({ cls: 'slide-two-tasks-summery' });

	const totals = store.totals();
	const totalTasks = totals.total;
	const completedTasks = totals.completed;
	const incompleteTasks = totals.incomplete;
	const uncat = store.groups[0]!;
	const uncatCount = store.count(uncat, 'all');
	let firstTask = store.range(uncat, 'all', 0, 1)[0] || null;
	if (!firstTask) {
		for (let i = 1; i < store.groups.length && !firstTask; i++) {
			firstTask = store.range(store.groups[i]!, 'all', 0, 1)[0] || null;
		}
	}
	const donePct = totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;

	const ringwrap = summaryEl.createDiv({ cls: 'slide-two-tasks-summery-ringwrap' });

	const ring = ringwrap.createDiv({ cls: 'slide-two-tasks-summery-ring' });
	ring.style.setProperty('--pct', `${donePct}%`);
	const hole = ring.createDiv({ cls: 'slide-two-tasks-summery-ring-hole' });
	const pctEl = hole.createDiv({ cls: 'slide-two-tasks-summery-ring-pct', text: `${formatCount(completedTasks)}/${formatCount(totalTasks)}` });
	pctEl.title = `${completedTasks.toLocaleString()} / ${totalTasks.toLocaleString()}`;
	hole.createDiv({ cls: 'slide-two-tasks-summery-ring-frac', text: 'done' });

	const statlist = ringwrap.createDiv({ cls: 'slide-two-tasks-summery-statlist' });

	const addStatRow = (label: string, value: string | number, cls: string) => {
		const row = statlist.createDiv({ cls: `slide-two-tasks-summery-statrow ${cls}` });
		row.createSpan({ cls: 'slide-two-tasks-summery-label', text: label });
		const valueEl = row.createSpan({ cls: 'slide-two-tasks-summery-value', text: typeof value === 'number' ? formatCount(value) : value });
		if (typeof value === 'number') valueEl.title = value.toLocaleString();
	};

	addStatRow('Pending', incompleteTasks, 'detail-pending');
	addStatRow('Categories', store.groups.length - 1, 'detail-categories');
	addStatRow('Uncategorized', uncatCount, 'detail-uncategorized');
	addStatRow('Gap', firstTask?.gapTime || '5', 'detail-gap');

	return summaryEl;
};
