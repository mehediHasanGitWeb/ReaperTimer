// VirtualList: renders only the rows that are on screen (plus a little
// overscan) no matter how many rows the list has.
//
// How it works
// ------------
// * `host` is an element inside the scrolling element (`scroller`). Its height
//   is set to the (estimated) height of the whole list, so the scrollbar looks
//   right, and the visible rows live in an absolutely positioned `windowEl`
//   inside it.
// * Rows have variable heights. Heights of the rows that are on screen are
//   measured; rows that are not are estimated per "kind" (e.g. banner vs card)
//   from what has been measured so far. Scrolling slides the window by adding
//   and removing rows at its edges using the MEASURED heights, so content never
//   jumps while you scroll; only a long jump (dragging the scrollbar) re-seeds
//   the window from the estimates.
// * Browsers cap the height of an element (~33 million px in Chromium). Above
//   `maxContentPx` the list switches to "scaled" mode: the real scroll position
//   is kept in `pos` (a plain number, can be billions of px), the native
//   scrollbar only maps to it proportionally (so dragging the thumb jumps
//   anywhere in the list), and mouse-wheel scrolling is handled directly so a
//   wheel notch still moves the content by a natural amount.

export interface VirtualSource {
	count(): number;
	/** number of distinct row kinds (rows of one kind are assumed to be about the same height) */
	kinds: number;
	kind(i: number): number;
	/** number of rows of kind `k` with index < i */
	kindBefore(i: number, k: number): number;
	/** Create row `i` inside `parent` (append it) and return its element. */
	render(i: number, parent: HTMLElement): HTMLElement;
	/** Optional: row element is being discarded. */
	release?(i: number, el: HTMLElement): void;
}

export interface VirtualOptions {
	/** px between rows (matches the CSS gap of the window) */
	gap?: number;
	/** px of extra rendered content above and below the viewport */
	overscanPx?: number;
	/** initial height guess per row kind */
	defaultHeights?: number[];
	/** above this total height the list switches to scaled-scroll mode */
	maxContentPx?: number;
	/** extra class for the window element */
	windowClass?: string;
}

export class VirtualList {
	readonly host: HTMLElement;
	private readonly sizer: HTMLElement;
	private readonly windowEl: HTMLElement;
	private rows: HTMLElement[] = [];
	private pitch: number[] = [];
	private first = 0;
	private topPx = 0;
	private pos = 0;
	private scaled = false;
	private totalH = 0;
	private est: number[];
	private sum: number[];
	private cnt: number[];
	private lastSetScrollTop = -1;
	private lastHostTop = 0;
	private raf = 0;
	private ro: ResizeObserver | null = null;
	private destroyed = false;
	private gap: number;
	private readonly overscan: number;
	private readonly maxContentPx: number;
	private onScroll = () => this.handleScroll();
	private onWheel = (e: WheelEvent) => this.handleWheel(e);

	constructor(
		private readonly scroller: HTMLElement,
		container: HTMLElement,
		private source: VirtualSource,
		opts: VirtualOptions = {},
	) {
		this.gap = opts.gap ?? 0;
		this.overscan = opts.overscanPx ?? 500;
		this.maxContentPx = opts.maxContentPx ?? 10_000_000;
		const defaults = opts.defaultHeights ?? [];
		this.est = [];
		this.sum = [];
		this.cnt = [];
		for (let k = 0; k < source.kinds; k++) {
			this.est.push(defaults[k] ?? 100);
			this.sum.push(0);
			this.cnt.push(0);
		}
		this.host = container.createDiv({ cls: 'vl-host' });
		this.sizer = this.host.createDiv({ cls: 'vl-sizer' });
		this.windowEl = this.host.createDiv({ cls: 'vl-window' + (opts.windowClass ? ' ' + opts.windowClass : '') });
		this.windowEl.style.rowGap = `${this.gap}px`;
		scroller.addEventListener('scroll', this.onScroll, { passive: true });
		scroller.addEventListener('wheel', this.onWheel, { passive: false });
		if (typeof ResizeObserver !== 'undefined') {
			this.ro = new ResizeObserver(() => this.schedule());
			this.ro.observe(scroller);
			this.ro.observe(this.windowEl);
		}
		this.refresh();
	}

	// --------------------------------------------------------------- public

	/** Re-render the visible rows (data changed). Keeps the scroll position. */
	refresh(): void {
		if (this.destroyed) return;
		this.clearRows();
		this.update();
	}

	/** Visit rendered rows (index, element), e.g. for a per-second refresh of timers. */
	forEachRendered(cb: (index: number, el: HTMLElement) => void): void {
		for (let i = 0; i < this.rows.length; i++) cb(this.first + i, this.rows[i]!);
	}

	/** Index range currently rendered [from, to). */
	renderedRange(): [number, number] {
		return [this.first, this.first + this.rows.length];
	}

	/** Change the px gap between rows (e.g. after a theme change) and re-render. */
	setGap(px: number): void {
		if (!isFinite(px) || px < 0 || px === this.gap) return;
		this.gap = px;
		this.windowEl.style.rowGap = `${px}px`;
		this.refresh();
	}

	setSource(source: VirtualSource): void {
		this.source = source;
		for (let k = 0; k < source.kinds; k++) {
			if (this.est[k] === undefined) { this.est[k] = 100; this.sum[k] = 0; this.cnt[k] = 0; }
		}
		this.refresh();
	}

	scrollToIndex(index: number): void {
		const n = this.source.count();
		const i = Math.max(0, Math.min(n - 1, index));
		const off = this.estOffset(i);
		if (this.scaled) {
			this.pos = off;
			this.applyThumb();
		} else {
			this.scroller.scrollTop = this.hostTop() + off;
			this.pos = off;
		}
		this.clearRows();
		this.update();
	}

	destroy(): void {
		this.destroyed = true;
		this.scroller.removeEventListener('scroll', this.onScroll);
		this.scroller.removeEventListener('wheel', this.onWheel);
		this.ro?.disconnect();
		if (this.raf) window.cancelAnimationFrame(this.raf);
		this.clearRows();
		this.host.remove();
	}

	// --------------------------------------------------------------- layout

	private estOffset(i: number): number {
		let off = 0;
		for (let k = 0; k < this.est.length; k++) off += this.source.kindBefore(i, k) * this.est[k]!;
		return off;
	}

	private idxAt(offset: number): number {
		const n = this.source.count();
		let lo = 0;
		let hi = n - 1;
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1;
			if (this.estOffset(mid) <= offset) lo = mid; else hi = mid - 1;
		}
		return lo;
	}

	private hostTop(): number {
		return this.host.getBoundingClientRect().top - this.scroller.getBoundingClientRect().top + this.scroller.scrollTop;
	}

	private clearRows(): void {
		for (let i = 0; i < this.rows.length; i++) {
			this.source.release?.(this.first + i, this.rows[i]!);
			this.rows[i]!.remove();
		}
		this.rows = [];
		this.pitch = [];
	}

	private measure(): void {
		for (let i = 0; i < this.rows.length; i++) {
			const h = this.rows[i]!.getBoundingClientRect().height + this.gap;
			this.pitch[i] = h;
		}
	}

	private learn(index: number, h: number): void {
		const k = this.source.kind(index);
		// stop adapting after enough samples so the scroll mapping stays stable
		if (this.cnt[k]! >= 40) return;
		this.sum[k]! += h;
		this.cnt[k]!++;
		this.est[k] = this.sum[k]! / this.cnt[k]!;
	}

	private bottomPx(): number {
		let b = this.topPx;
		for (let i = 0; i < this.pitch.length; i++) b += this.pitch[i]!;
		return b;
	}

	private renderRow(i: number): HTMLElement {
		return this.source.render(i, this.windowEl);
	}

	private schedule(): void {
		if (this.raf || this.destroyed) return;
		this.raf = window.requestAnimationFrame(() => { this.raf = 0; this.update(); });
	}

	/** Estimated height of the whole list, anchored to the rows that are really rendered. */
	private estTotal(): number {
		const n = this.source.count();
		if (n === 0) return 0;
		if (!this.rows.length) return this.estOffset(n);
		const last = this.first + this.rows.length;
		return this.bottomPx() + (last >= n ? 0 : this.estOffset(n) - this.estOffset(last));
	}

	/** Scroll position relative to the top of the host (negative while content above the host is still showing). */
	private hostScrollTop(): number {
		return this.scroller.scrollTop - this.hostTop();
	}

	private maxHostScroll(): number {
		return Math.max(1, this.scroller.scrollHeight - this.scroller.clientHeight - this.hostTop());
	}

	/** Scaled mode: logical position for the native scroll position. */
	private posFromScroll(): number {
		const s = this.hostScrollTop();
		if (s <= 0) return s;
		const range = Math.max(1, this.totalH - this.scroller.clientHeight);
		return Math.min(1, s / this.maxHostScroll()) * range;
	}

	private handleScroll(): void {
		if (this.scaled && Math.abs(this.scroller.scrollTop - this.lastSetScrollTop) > 1.5) {
			// A scrollbar drag (not our own programmatic move) maps proportionally onto the whole list.
			this.totalH = this.estTotal();
			this.pos = this.posFromScroll();
		}
		this.schedule();
	}

	private handleWheel(e: WheelEvent): void {
		if (!this.scaled) return;
		const target = e.target as HTMLElement | null;
		// let nested scrollable controls (inputs etc.) keep their own wheel behaviour
		if (target && target.closest && target.closest('input, textarea, select')) return;
		e.preventDefault();
		let dy = e.deltaY;
		if (e.deltaMode === 1) dy *= 40;
		else if (e.deltaMode === 2) dy *= this.scroller.clientHeight;
		const viewH = this.scroller.clientHeight;
		this.totalH = this.estTotal();
		this.pos = Math.max(-this.hostTop(), Math.min(Math.max(0, this.totalH - viewH), this.pos + dy));
		this.applyThumb();
		this.schedule();
	}

	/** Scaled mode: move the native scrollbar to represent `pos`. */
	private applyThumb(): void {
		const viewH = this.scroller.clientHeight;
		const range = Math.max(1, this.totalH - viewH);
		const st = this.pos <= 0
			? this.hostTop() + this.pos
			: this.hostTop() + (this.pos / range) * this.maxHostScroll();
		this.scroller.scrollTop = Math.max(0, st);
		// the browser may clamp/round; remember what it really is
		this.lastSetScrollTop = this.scroller.scrollTop;
	}

	/** Bring the rendered window in line with the scroll position. */
	update(): void {
		if (this.destroyed) return;
		const n = this.source.count();
		const viewH = this.scroller.clientHeight || 600;
		if (n === 0) {
			this.clearRows();
			this.topPx = 0;
			this.first = 0;
			this.totalH = 0;
			this.scaled = false;
			this.sizer.style.height = `${this.totalH}px`;
			return;
		}
		if (this.first >= n) { this.clearRows(); this.first = 0; this.topPx = 0; }

		const wasScaled = this.scaled;
		let H = this.estTotal();
		this.scaled = H > this.maxContentPx;
		this.sizer.style.height = `${Math.ceil(this.scaled ? this.maxContentPx : H)}px`;
		this.totalH = H;
		// Content above the list changed height (e.g. a summary row got filled in) while the view
		// was parked at the very top: stay at the very top instead of drifting down by that amount.
		const ht = this.hostTop();
		if (this.scaled && wasScaled && this.pos <= 0 && Math.abs(this.pos + this.lastHostTop) < 1) this.pos = -ht;
		this.lastHostTop = ht;
		if (!this.scaled || !wasScaled) this.pos = this.hostScrollTop();
		this.pos = Math.min(this.pos, Math.max(0, H - viewH));

		const lo = Math.max(0, this.pos) - this.overscan;
		const hi = this.pos + viewH + this.overscan;

		// far from the current window (or nothing rendered): re-seed from the estimates
		const winBottom = this.rows.length ? this.bottomPx() : 0;
		if (!this.rows.length || hi < this.topPx - viewH || lo > winBottom + viewH) {
			this.clearRows();
			this.first = this.idxAt(Math.max(0, lo));
			this.topPx = this.estOffset(this.first);
		}

		// grow downward
		let guard = 0;
		while (guard++ < 200) {
			const last2 = this.first + this.rows.length;
			if (last2 >= n) break;
			const bottom = this.bottomPx();
			if (bottom >= hi && this.rows.length) break;
			const want = Math.max(1, Math.min(n - last2, Math.ceil((hi - bottom) / Math.max(20, this.est[this.source.kind(last2)] ?? 100)) + 1));
			const start = this.rows.length;
			for (let j = 0; j < want; j++) {
				this.rows.push(this.renderRow(last2 + j));
				this.pitch.push(0);
			}
			this.measureFrom(start);
		}
		// grow upward
		guard = 0;
		while (guard++ < 200 && this.first > 0 && this.topPx > lo) {
			const want = Math.max(1, Math.min(this.first, Math.ceil((this.topPx - lo) / Math.max(20, this.est[this.source.kind(this.first - 1)] ?? 100)) + 1));
			const fresh: HTMLElement[] = [];
			for (let j = 1; j <= want; j++) {
				const el = this.renderRow(this.first - j);
				this.windowEl.insertBefore(el, this.windowEl.firstChild);
				fresh.push(el);
			}
			// fresh[0] is the row just above the old first, fresh[1] the one above that, ...
			const heights = fresh.map((el) => el.getBoundingClientRect().height + this.gap);
			for (let j = 0; j < fresh.length; j++) {
				this.rows.unshift(fresh[j]!);
				this.pitch.unshift(heights[j]!);
				this.first--;
				this.topPx -= heights[j]!;
				this.learn(this.first, heights[j]!);
			}
		}
		this.measure();
		if (this.first === 0 && this.topPx !== 0) this.topPx = 0;

		// trim rows that are far outside the window
		while (this.rows.length > 1 && this.topPx + this.pitch[0]! < lo - 100) {
			this.source.release?.(this.first, this.rows[0]!);
			this.rows[0]!.remove();
			this.topPx += this.pitch[0]!;
			this.rows.shift();
			this.pitch.shift();
			this.first++;
		}
		while (this.rows.length > 1 && this.bottomPx() - this.pitch[this.pitch.length - 1]! > hi + 100) {
			const idx = this.first + this.rows.length - 1;
			this.source.release?.(idx, this.rows[this.rows.length - 1]!);
			this.rows[this.rows.length - 1]!.remove();
			this.rows.pop();
			this.pitch.pop();
		}

		// totals with the final window
		H = this.estTotal();
		this.totalH = H;
		this.scaled = H > this.maxContentPx;
		this.sizer.style.height = `${Math.ceil(this.scaled ? this.maxContentPx : H)}px`;
		if (this.scaled) {
			this.pos = Math.min(this.pos, Math.max(0, H - viewH));
			this.applyThumb();
		}
		// place the window: row `first` sits (topPx - pos) below the top of the viewport
		const hostScrollTop2 = this.hostScrollTop();
		const posNow = this.scaled ? this.pos : hostScrollTop2;
		this.windowEl.style.top = `${hostScrollTop2 + this.topPx - posNow}px`;
	}

	private measureFrom(start: number): void {
		for (let i = start; i < this.rows.length; i++) {
			const h = this.rows[i]!.getBoundingClientRect().height + this.gap;
			this.pitch[i] = h;
			this.learn(this.first + i, h);
		}
	}
}
