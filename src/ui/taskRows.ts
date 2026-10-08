// Virtual-list row sources over the task store.
//
//  * GroupedTaskRows: one row per task of some kind, across a list of groups
//    (Uncategorized + categories) in order. Size is O(groups); a row's task is
//    fetched from the store in small cached batches.
//  * ArrayTaskRows: one row per entry of a plain array (already-filtered results).

import { store } from '../store/taskStore';
import type { Group, Kind, Task } from '../store/taskStore';
import type { VirtualSource } from './VirtualList';

const BATCH = 96;
const BEHIND = 32;

export type TaskRowRenderer = (task: Task, groupName: string, parent: HTMLElement, index: number) => HTMLElement;

export class GroupedTaskRows implements VirtualSource {
	readonly kinds = 1;
	private segs: { group: Group; kind: Kind }[] = [];
	private starts: Float64Array = new Float64Array(1);
	private total = 0;
	private cache = new Map<number, { from: number; tasks: Task[] }>();

	/** `kinds`: the passes to list, in order (e.g. all incomplete tasks of every group, then all completed ones). */
	constructor(
		private kinds_: Kind[],
		private renderRow: TaskRowRenderer,
		private onRelease?: (el: HTMLElement) => void,
	) {}

	/** Recompute sizes for `groups` (cheap: O(groups x passes)). */
	rebuild(groups: Group[]): void {
		const segs: { group: Group; kind: Kind }[] = [];
		for (const kind of this.kinds_) {
			for (const g of groups) if (g.count(kind) > 0) segs.push({ group: g, kind });
		}
		const starts = new Float64Array(segs.length + 1);
		let at = 0;
		for (let i = 0; i < segs.length; i++) {
			starts[i] = at;
			at += segs[i]!.group.count(segs[i]!.kind);
		}
		starts[segs.length] = at;
		this.segs = segs;
		this.starts = starts;
		this.total = at;
		this.cache.clear();
	}

	count(): number { return this.total; }
	kind(): number { return 0; }
	kindBefore(i: number, k: number): number { return k === 0 ? Math.min(i, this.total) : 0; }

	private segIndexOf(i: number): number {
		let lo = 0;
		let hi = this.segs.length - 1;
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1;
			if (this.starts[mid]! <= i) lo = mid; else hi = mid - 1;
		}
		return lo;
	}

	taskAt(i: number): { task: Task; group: Group; kind: Kind } | null {
		if (i < 0 || i >= this.total) return null;
		const si = this.segIndexOf(i);
		const { group, kind } = this.segs[si]!;
		const k = i - this.starts[si]!;
		let c = this.cache.get(si);
		if (!c || k < c.from || k >= c.from + c.tasks.length) {
			const from = Math.max(0, k - BEHIND);
			c = { from, tasks: store.range(group, kind, from, BATCH) };
			this.cache.set(si, c);
		}
		const task = c.tasks[k - c.from];
		return task == null ? null : { task, group, kind };
	}

	render(i: number, parent: HTMLElement): HTMLElement {
		const at = this.taskAt(i);
		if (!at) return parent.createDiv();
		return this.renderRow(at.task, at.group.name, parent, i);
	}

	release(_i: number, el: HTMLElement): void {
		this.onRelease?.(el);
	}
}

export interface ArrayRow { task: Task; groupName: string }

export class ArrayTaskRows implements VirtualSource {
	readonly kinds = 1;
	rows: ArrayRow[] = [];

	constructor(
		private renderRow: TaskRowRenderer,
		private onRelease?: (el: HTMLElement) => void,
	) {}

	count(): number { return this.rows.length; }
	kind(): number { return 0; }
	kindBefore(i: number, k: number): number { return k === 0 ? Math.min(i, this.rows.length) : 0; }

	render(i: number, parent: HTMLElement): HTMLElement {
		const r = this.rows[i];
		if (!r) return parent.createDiv();
		return this.renderRow(r.task, r.groupName, parent, i);
	}

	release(_i: number, el: HTMLElement): void {
		this.onRelease?.(el);
	}
}
