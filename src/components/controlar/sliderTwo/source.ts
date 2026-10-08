// Row source for slide two's virtual list.
//
// The list the user sees is, top to bottom:
//   [banner, card, card, ...] for every visible group that has pending tasks
//   [DONE till button] + (unless collapsed) [banner, cards...] per group with started tasks
//   [Completed button] + (unless collapsed) [banner, cards...] per visible group
//
// It is described as a short list of *segments* (a banner, a button, or a run
// of cards from one group) so its size is O(number of groups) however many
// tasks exist. Row i is found by binary search; the task behind a card row is
// fetched from the store in small batches.

import { store } from '../../../store/taskStore';
import type { Group, Kind, Task } from '../../../store/taskStore';
import type { VirtualSource } from '../../../ui/VirtualList';
import type { ControlarHost } from '../../../types';
import { getTaskCategoryColor } from '../../../utils/timer';
import { resetCrackHighlightBudget } from '../../../utils/crackHighlight';
import { renderTaskCard } from './taskCard';
import { visibleGroups } from '../../../utils/filterGroups';
import { confirmDeleteCategory } from '../../../utils/deleteCategory';
import { setIcon } from 'obsidian';
import { renderSliderTwoCollapseBtn } from './sliderTwoTaskColapsBtn';
import type { SliderTwoFilterState } from './sliderTwobadgesList';

export const ROW_BANNER = 0;
export const ROW_CARD = 1;
export const ROW_BUTTON = 2;

type Section = 'incomplete' | 'donetill' | 'completed';

interface Seg {
	type: number;
	section: Section;
	group: Group | null;
	kind: Kind;
	n: number;
	start: number;
}

export interface SliderTwoView {
	filter: SliderTwoFilterState;
	collapsed: { donetill: boolean; completed: boolean };
}

const BATCH = 96;
const BEHIND = 32;

export class SliderTwoSource implements VirtualSource {
	readonly kinds = 3;
	private segs: Seg[] = [];
	private starts: Float64Array = new Float64Array(1);
	private before: [Float64Array, Float64Array, Float64Array] = [new Float64Array(1), new Float64Array(1), new Float64Array(1)];
	private total = 0;
	private cache = new Map<number, { from: number; tasks: Task[] }>();

	constructor(
		private readonly view: SliderTwoView,
		private readonly instance: ControlarHost,
		private readonly onToggle: () => void,
	) {
		this.rebuild();
	}

	private visibleGroups(): Group[] {
		return visibleGroups(this.view.filter);
	}

	/** Recompute the segment list from the store's counters (cheap: O(groups)). */
	rebuild(): void {
		const segs: Seg[] = [];
		const groups = this.visibleGroups();
		const pushGroup = (section: Section, kind: Kind, alwaysBanner: boolean) => {
			for (const g of groups) {
				const n = g.count(kind);
				if (n === 0 && !alwaysBanner) continue;
				segs.push({ type: ROW_BANNER, section, group: g, kind, n: 1, start: 0 });
				if (n > 0) segs.push({ type: ROW_CARD, section, group: g, kind, n, start: 0 });
			}
		};
		pushGroup('incomplete', 'pending', false);
		segs.push({ type: ROW_BUTTON, section: 'donetill', group: null, kind: 'started', n: 1, start: 0 });
		if (!this.view.collapsed.donetill) pushGroup('donetill', 'started', false);
		segs.push({ type: ROW_BUTTON, section: 'completed', group: null, kind: 'completed', n: 1, start: 0 });
		if (!this.view.collapsed.completed) pushGroup('completed', 'completed', true);

		const starts = new Float64Array(segs.length + 1);
		const b0 = new Float64Array(segs.length + 1);
		const b1 = new Float64Array(segs.length + 1);
		const b2 = new Float64Array(segs.length + 1);
		let at = 0;
		for (let i = 0; i < segs.length; i++) {
			const s = segs[i]!;
			s.start = at;
			starts[i] = at;
			b0[i] = at === 0 ? 0 : b0[i - 1]! + (segs[i - 1]!.type === ROW_BANNER ? segs[i - 1]!.n : 0);
			b1[i] = i === 0 ? 0 : b1[i - 1]! + (segs[i - 1]!.type === ROW_CARD ? segs[i - 1]!.n : 0);
			b2[i] = i === 0 ? 0 : b2[i - 1]! + (segs[i - 1]!.type === ROW_BUTTON ? segs[i - 1]!.n : 0);
			at += s.n;
		}
		const last = segs.length;
		starts[last] = at;
		if (last > 0) {
			b0[last] = b0[last - 1]! + (segs[last - 1]!.type === ROW_BANNER ? segs[last - 1]!.n : 0);
			b1[last] = b1[last - 1]! + (segs[last - 1]!.type === ROW_CARD ? segs[last - 1]!.n : 0);
			b2[last] = b2[last - 1]! + (segs[last - 1]!.type === ROW_BUTTON ? segs[last - 1]!.n : 0);
		}
		this.segs = segs;
		this.starts = starts;
		this.before = [b0, b1, b2];
		this.total = at;
		this.cache.clear();
	}

	private segIndexOf(i: number): number {
		let lo = 0;
		let hi = this.segs.length - 1;
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1;
			if (this.starts[mid]! <= i) lo = mid; else hi = mid - 1;
		}
		return lo;
	}

	count(): number {
		return this.total;
	}

	kind(i: number): number {
		if (this.segs.length === 0) return ROW_BANNER;
		return this.segs[this.segIndexOf(i)]!.type;
	}

	kindBefore(i: number, k: number): number {
		if (this.segs.length === 0) return 0;
		if (i >= this.total) return this.before[k]![this.segs.length]!;
		const si = this.segIndexOf(i);
		const seg = this.segs[si]!;
		return this.before[k]![si]! + (seg.type === k ? i - seg.start : 0);
	}

	private taskAt(si: number, seg: Seg, k: number): Task | null {
		let c = this.cache.get(si);
		if (!c || k < c.from || k >= c.from + c.tasks.length) {
			const from = Math.max(0, k - BEHIND);
			c = { from, tasks: store.range(seg.group!, seg.kind, from, BATCH) };
			this.cache.set(si, c);
		}
		return c.tasks[k - c.from] ?? null;
	}

	render(i: number, parent: HTMLElement): HTMLElement {
		const si = this.segIndexOf(i);
		const seg = this.segs[si];
		if (!seg) return parent.createDiv();

		if (seg.type === ROW_BUTTON) {
			if (seg.section === 'donetill') {
				return renderSliderTwoCollapseBtn(parent, {
					label: 'DONE till',
					hollow: true,
					collapsed: this.view.collapsed.donetill,
					onToggle: (c) => { this.view.collapsed.donetill = c; this.onToggle(); },
				});
			}
			return renderSliderTwoCollapseBtn(parent, {
				collapsed: this.view.collapsed.completed,
				onToggle: (c) => { this.view.collapsed.completed = c; this.onToggle(); },
			});
		}

		const g = seg.group!;
		if (seg.type === ROW_BANNER) {
			const cls = seg.section === 'completed'
				? 'slide-two-tasks-complete-category-name'
				: 'slide-two-tasks-incomplete-category-name';
			const el = parent.createDiv({ cls, text: g.index === 0 ? 'Uncategorized' : `• ${g.name}` });
			if (g.index !== 0) {
				el.style.backgroundColor = getTaskCategoryColor(undefined, g.name);
				if (seg.section === 'incomplete') {
					el.addClass('slide-two-banner-has-delete');
					const del = el.createSpan({ cls: 'slide-two-banner-delete', attr: { 'aria-label': 'Delete category', title: 'Delete category' } });
					setIcon(del, 'trash-2');
					del.addEventListener('click', (evt: MouseEvent) => {
						evt.stopPropagation();
						confirmDeleteCategory(this.instance, g.name);
					});
				}
			}
			return el;
		}

		// Task card. The crack-highlight effect has a per-pass work budget; every
		// card in the window is one small pass of its own now.
		resetCrackHighlightBudget();
		const task = this.taskAt(si, seg, i - seg.start);
		if (!task) return parent.createDiv();
		return renderTaskCard(parent, task, g.name, 'slide-two-tasks-incomplete-tasks', this.instance);
	}
}
