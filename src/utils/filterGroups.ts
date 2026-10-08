// Which task groups (Uncategorized + categories) slide two's badge filter lets through.
// Shared by slide two's list, the timeline, the gantt chart and the status bar presets
// so they all agree on what "the filtered tasks" are.

import { store } from '../store/taskStore';
import type { Group } from '../store/taskStore';

export interface GroupFilter {
	activeFilter?: string;
	selectedBadgeNames?: Set<string>;
}

export const visibleGroups = (filter: GroupFilter | null | undefined): Group[] => {
	const activeFilter = filter?.activeFilter || 'all';
	const selected = filter?.selectedBadgeNames || new Set<string>();
	const gs = store.groups;
	const out: Group[] = [];
	if (activeFilter === 'all' || selected.has('Uncategorized')) out.push(gs[0]!);
	if (activeFilter === 'all') {
		for (let i = 1; i < gs.length; i++) out.push(gs[i]!);
	} else if (activeFilter === 'categories') {
		for (let i = 1; i < gs.length; i++) if (selected.has(gs[i]!.name)) out.push(gs[i]!);
	}
	return out;
};

/** Cheap fingerprint of a filter, to notice when it changed. */
export const filterKey = (filter: GroupFilter | null | undefined): string => {
	const activeFilter = filter?.activeFilter || 'all';
	const sel = filter?.selectedBadgeNames ? Array.from(filter.selectedBadgeNames).sort().join('\u0001') : '';
	return `${activeFilter}\u0002${sel}`;
};
