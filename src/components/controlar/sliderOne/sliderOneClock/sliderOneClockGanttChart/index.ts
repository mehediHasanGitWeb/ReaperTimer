// "sliderOneClockGanttChart": the live per-category Gantt-style activity chart.
//
// Same chart as before: time runs down the left axis (newest on top), every
// category owns a fixed lane, and a task is a dot at its start, a line for its
// duration and a dot at its end (an open, pulsing dot while it is still
// running). Dragging the time axis zooms the time scale, dragging the graph
// zooms the lane spacing, "expand" widens the panel.
//
// What changed:
//  * Time is now continuous. Tasks are remembered as segments (start / end) and
//    the whole chart is redrawn from them a few times a second, instead of
//    scrolling one fixed-height row per second. With "Fit all tasks" (default)
//    or "Elastic" the scale adapts, so tasks no longer slide off the bottom
//    as time passes.
//  * 14 looks (plus "Auto", which follows the plugin theme) and a gear popover
//    with the rest of the options -- see ganttSettings.ts / ganttOptionsPanel.ts.

import type { ControlarHost, Task } from '../../../../../types';
import { getTimerMode, getTimerDurationSeconds, getTaskCategoryColor } from '../../../../../utils/timer';
import { store } from '../../../../../store/taskStore';
import { engine } from '../../../../../store/timerEngine';
import { buildOptionsPanel } from './ganttOptionsPanel';
import { currentThemeStyleId, loadSettings, saveSettings, styleById } from './ganttSettings';
import type { GanttSettings, GanttStyle, Palette } from './ganttSettings';

// The chart is a small live picture, so for each category it looks at the first
// CHART_TASKS_PER_LANE incomplete tasks and draws at most CHART_MAX_LANES lanes
// -- it never walks a huge task list.
const CHART_TASKS_PER_LANE = 64;
const CHART_MAX_LANES = 64;
const MAX_SEGMENTS = 600;
/** Drawing rate (ms between frames). The data itself is refreshed once a second. */
const FRAME_MS = 70;

const SVG_NS = 'http://www.w3.org/2000/svg';
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const pad2 = (n: number) => String(n).padStart(2, '0');

interface Lane { name: string; color: string; tasks: Task[] }
interface Seg { id: string; lane: string; color: string; name: string; start: number; end: number; seen: boolean; order: number; dur: number }

let ganttToken = 0;
let gradientCounter = 0;

const mk = (tag: string, attrs: Record<string, string | number>, parent?: Element): SVGElement => {
	const e = document.createElementNS(SVG_NS, tag);
	for (const k in attrs) e.setAttribute(k, String(attrs[k]));
	if (parent) parent.appendChild(e);
	return e;
};

export const slideOneGanntChart = (parentContainer: HTMLElement, instance: ControlarHost) => {
	const settings: GanttSettings = loadSettings();

	const root = parentContainer.createDiv({ cls: 'slide-one-clock-part-gantt-chart' });
	const expandBtn = root.createDiv({ cls: 'slide-one-clock-part-gantt-chart-expand-btn', text: 'Expand' });
	const zoomBadge = root.createDiv({ cls: 'slide-one-clock-part-gantt-chart-zoom-badge' });
	const timeAxis = root.createDiv({ cls: 'slide-one-clock-part-gantt-chart-time-axis' });
	const timeAxisTimeline = timeAxis.createDiv({ cls: 'slide-one-clock-part-gantt-chart-time-axis-timeline' });
	const page = root.createDiv({ cls: 'slide-one-clock-part-gantt-chart-page' });
	const body = page.createDiv({ cls: 'slide-one-clock-part-gantt-chart-body' });
	const catAxis = root.createDiv({ cls: 'slide-one-clock-part-gantt-chart-category-axis' });
	const tipEl = root.createDiv({ cls: 'slide-one-clock-part-gantt-chart-tip' });
	tipEl.hide();

	const graphSvg = document.createElementNS(SVG_NS, 'svg');
	graphSvg.setAttribute('class', 'slide-one-clock-part-gantt-chart-graph');
	graphSvg.setAttribute('focusable', 'false');
	body.appendChild(graphSvg);
	const timeSvg = document.createElementNS(SVG_NS, 'svg');
	timeSvg.setAttribute('class', 'slide-one-clock-part-gantt-chart-time-svg');
	timeSvg.setAttribute('aria-hidden', 'true');
	timeAxisTimeline.appendChild(timeSvg);
	const catSvg = document.createElementNS(SVG_NS, 'svg');
	catSvg.setAttribute('class', 'slide-one-clock-part-gantt-chart-cat-svg');
	let catSvgAttached = false;

	let isExpanded = false;
	let hoverId: string | null = null;
	const segs = new Map<string, Seg>();
	let lanes: Lane[] = [];

	// ------------------------------------------------------------- data

	const getTaskRuntime = (task: Task) => {
		const entry = engine.entryOf(task);
		let durationSeconds = 60;
		if (task.runtimeGap != null && Number(task.runtimeGap) > 0) {
			durationSeconds = Number(task.runtimeGap) * 60;
		} else if (entry && entry.durationSeconds != null && entry.durationSeconds > 0) {
			durationSeconds = entry.durationSeconds;
		} else {
			const dur = getTimerDurationSeconds(task, getTimerMode(task));
			if (dur != null && dur > 0) durationSeconds = dur;
		}
		const startMs = (entry && entry.startedAt != null) ? entry.startedAt : Date.now() - durationSeconds * 1000;
		return { durationSeconds, startMs, endMs: startMs + durationSeconds * 1000 };
	};

	const collectColumns = (): Lane[] => {
		const columns: Lane[] = [];
		const seen = new Set<string>();
		const push = (name: string, color: string, tasks: Task[]) => {
			if (seen.has(name) || columns.length >= CHART_MAX_LANES) return;
			seen.add(name);
			columns.push({ name, color, tasks: tasks || [] });
		};
		// Categories first (in list order), then Uncategorized if it has any incomplete task.
		for (let i = 1; i < store.groups.length; i++) {
			const g = store.groups[i]!;
			push(g.name, g.color || '#ffffff', store.range(g, 'incomplete', 0, CHART_TASKS_PER_LANE));
		}
		const uncat = store.groups[0];
		if (uncat && uncat.count('incomplete') > 0) {
			push('Uncategorized', '#ffffff', store.range(uncat, 'incomplete', 0, CHART_TASKS_PER_LANE));
		}
		return columns;
	};

	/** Remember every task as a segment so finished ones stay on the chart for a while. */
	const refreshSegments = (now: number) => {
		lanes = collectColumns();
		for (const s of segs.values()) s.seen = false;
		lanes.forEach((col) => {
			col.tasks.forEach((t, ti) => {
				if (!t) return;
				const r = getTaskRuntime(t);
				if (r.startMs > now) return;
				const id = String(t.id ?? `${col.name}:${ti}:${r.startMs}`);
				let s = segs.get(id);
				if (!s) {
					s = { id, lane: col.name, color: '', name: '', start: r.startMs, end: r.endMs, seen: true, order: ti, dur: r.durationSeconds };
					segs.set(id, s);
				}
				s.lane = col.name;
				s.color = String(getTaskCategoryColor(t, col.name) || col.color || '#ffffff');
				s.name = String(t.name || t.description || 'Task');
				s.start = r.startMs;
				s.end = r.endMs;
				s.dur = r.durationSeconds;
				s.order = ti;
				s.seen = true;
			});
		});
		const cutoff = now - settings.lookback * 1000;
		for (const [id, s] of segs) {
			if (!s.seen && s.end > now) s.end = now; // completed / removed before its timer ran out
			if (s.end < cutoff) segs.delete(id);
		}
		if (segs.size > MAX_SEGMENTS) {
			const old = [...segs.values()].sort((a, b) => a.end - b.end);
			for (let i = 0; i < segs.size - MAX_SEGMENTS; i++) segs.delete(old[i]!.id);
		}
	};

	// ------------------------------------------------------------ style

	const activeStyle = (): { st: GanttStyle; pal: Palette; own: boolean } => {
		if (settings.style === 'auto') {
			const st = styleById(currentThemeStyleId());
			// Metal: paint exactly like style 13 (its green plate surfaces too)
			return { st, pal: st.pal, own: st.id === 'tmet' };
		}
		const st = styleById(settings.style);
		return { st, pal: st.pal, own: true };
	};

	/** Give the panel the picked style's surfaces (Auto leaves the plugin theme's own CSS alone). */
	let appliedOwn = false;
	const applySurfaces = (own: boolean, pal: Palette, st: GanttStyle) => {
		const set = (el: HTMLElement, bg: string, border: string) => {
			if (own) { el.style.background = bg; el.style.borderColor = border; } else if (appliedOwn) { el.style.removeProperty('background'); el.style.removeProperty('border-color'); }
		};
		set(root, pal.bg, pal.line);
		set(page, pal.plot === 'transparent' ? pal.solid : pal.plot, pal.line);
		set(timeAxis, pal.plot === 'transparent' ? pal.solid : pal.plot, pal.line);
		set(catAxis, 'transparent', pal.line);
		// .gantt-own-surface switches the axes' box-shadow off (styles.css)
		if (own) {
			root.setCssProps({ '--gantt-ink': pal.ink });
			root.addClass('gantt-own-surface');
		} else if (appliedOwn) {
			root.removeClass('gantt-own-surface');
			root.style.removeProperty('--gantt-ink');
		}
		root.toggleClass('is-stone', st.id === 'tmet');
		appliedOwn = own;
		root.style.fontFamily = own ? st.font : '';
	};

	// ----------------------------------------------------------- layout

	const PANEL_BUDGET = 372; // inner height available to plot + category axis in the clock part

	let hDragMoved = false;

	const catAxisHeight = (): number => {
		const m = settings.cax;
		if (m === 'none') return 0;
		if (m === 'chips') return 40;
		if (m === 'axis-dots') return 48;
		if (m === 'axis-rot' || m === 'axis') return 78;
		return 46;
	};

	// ------------------------------------------------------------ render

	const fmtClock = (d: Date) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
	const fmtAxis = (d: Date) => `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${fmtClock(d)}`;
	const fmtAge = (a: number) => (a === 0 ? 'now' : a < 60 ? `-${Math.round(a)}s` : a < 3600 ? `-${Math.floor(a / 60)}m${pad2(Math.round(a % 60))}s` : `-${Math.floor(a / 3600)}h${pad2(Math.floor(a % 3600 / 60))}m`);

	const hideTip = () => tipEl.hide();
	const showTip = (e: MouseEvent, seg: Seg, color: string, open: boolean) => {
		const r = root.getBoundingClientRect();
		tipEl.empty();
		tipEl.createEl('b', { text: seg.name }).style.color = color;
		const span = `${fmtClock(new Date(seg.start))} → ${open ? 'now' : fmtClock(new Date(seg.end))}`;
		if (settings.tip === 'detail') {
			tipEl.createDiv({ text: `${seg.lane} · ${open ? 'running' : 'finished'}` });
			tipEl.createDiv({ text: span });
			tipEl.createDiv({ text: `Length: ${Math.round(seg.dur)} s` });
		} else {
			tipEl.createDiv({ text: span });
		}
		tipEl.show();
		const x = e.clientX - r.left + 12;
		tipEl.style.left = Math.min(x, r.width - 150) + 'px';
		tipEl.style.top = e.clientY - r.top + 12 + 'px';
	};

	let lastW = 0;
	let lastH = 0;

	const render = () => {
		const now = Date.now();
		const { st, pal, own } = activeStyle();
		applySurfaces(own, pal, st);

		// ---- layout: plot height / category axis position
		const axH = catAxisHeight();
		// On slide 3, "expand" makes the chart fill the slide (the end timeline is
		// hidden by CSS meanwhile), so give the plot the slide's height to work with.
		const slideEl = root.closest<HTMLElement>('.slide-three');
		const budget = isExpanded && slideEl ? Math.max(PANEL_BUDGET, slideEl.clientHeight - 60) : PANEL_BUDGET;
		const plotH = settings.plotH > 0 ? settings.plotH : Math.max(150, budget - axH - 4);
		const top = settings.caxPos === 'top' && settings.cax !== 'none';
		root.style.gridTemplateRows = top ? `${axH ? 'auto' : '0'} ${plotH}px` : `${plotH}px auto`;
		const plotRow = top ? '2' : '1';
		timeAxis.style.gridRow = plotRow; page.style.gridRow = plotRow;
		page.style.height = plotH + 'px'; timeAxis.style.height = plotH + 'px';
		// overflow: hidden for the page comes from styles.css
		catAxis.style.gridRow = top ? '1' : '2';
		catAxis.style.display = settings.cax === 'none' ? 'none' : '';

		const W = Math.max(60, page.clientWidth - 2);
		const AW = Math.max(30, timeAxis.clientWidth - 2);
		const H = plotH - 2;
		if (page.clientWidth === 0) return; // not laid out (hidden tab)
		lastW = W; lastH = H;

		graphSvg.setAttribute('width', String(W)); graphSvg.setAttribute('height', String(H));
		graphSvg.setAttribute('viewBox', `0 0 ${W} ${H}`);
		timeSvg.setAttribute('width', String(AW)); timeSvg.setAttribute('height', String(H));
		timeSvg.setAttribute('viewBox', `0 0 ${AW} ${H}`);
		graphSvg.replaceChildren(); timeSvg.replaceChildren();

		// ---- tasks in view
		const hiddenLanes = new Set(settings.hidden);
		let list = [...segs.values()].filter((s) => {
			const run = s.end >= now;
			if (settings.status === 'running' && !run) return false;
			if (settings.status === 'finished' && run) return false;
			if (settings.finMode === 'hide' && !run && s.end < now - settings.finSecs * 1000) return false;
			return true;
		});
		const laneOf = (s: Seg) => s.lane;

		// concurrent tasks in one lane: keep the first one only, or stack them side by side
		const subSlot = new Map<string, number>();
		{
			const byLane = new Map<string, Seg[]>();
			list.forEach((s) => { const a = byLane.get(laneOf(s)) || []; a.push(s); byLane.set(laneOf(s), a); });
			const kept: Seg[] = [];
			byLane.forEach((arr) => {
				if (settings.concurrent === 'stack') {
					arr.sort((a, b) => a.start - b.start);
					const ends: number[] = [];
					arr.forEach((s) => {
						let k = ends.findIndex((e) => e < s.start);
						if (k < 0) { k = ends.length; ends.push(0); }
						ends[k] = Math.min(s.end, now);
						subSlot.set(s.id, Math.min(k, 3));
						kept.push(s);
					});
				} else {
					arr.sort((a, b) => a.order - b.order || a.start - b.start);
					const taken: [number, number][] = [];
					arr.forEach((s) => {
						const e = Math.min(s.end, now);
						if (taken.some(([a, b]) => s.start < b && e > a)) return;
						taken.push([s.start, e]);
						kept.push(s);
					});
				}
			});
			list = kept;
		}

		const laneNames = lanes.map((l) => l.name);
		const laneCount = (name: string) => list.filter((s) => s.lane === name).length;
		const order = laneNames.map((_, i) => i);
		const runCount = (name: string) => list.filter((s) => s.lane === name && s.end >= now).length;
		if (settings.sort === 'az') order.sort((a, b) => laneNames[a]!.localeCompare(laneNames[b]!));
		else if (settings.sort === 'za') order.sort((a, b) => laneNames[b]!.localeCompare(laneNames[a]!));
		else if (settings.sort === 'count') order.sort((a, b) => laneCount(laneNames[b]!) - laneCount(laneNames[a]!));
		else if (settings.sort === 'fewest') order.sort((a, b) => laneCount(laneNames[a]!) - laneCount(laneNames[b]!));
		else if (settings.sort === 'running') order.sort((a, b) => runCount(laneNames[b]!) - runCount(laneNames[a]!));
		const slotOf = (name: string) => order.indexOf(laneNames.indexOf(name));

		// ---- time scale
		const maxAge = Math.max(20, ...list.map((s) => (now - s.start) / 1000)) + 4;
		let rowH = 16 * settings.rowZoom;
		let yOf: (ms: number) => number;
		const ticks: { ms: number; major: boolean }[] = [];
		if (settings.win === 'elastic') {
			const f = (a: number) => Math.log1p(a / 10);
			const z = settings.rowZoom;
			yOf = (ms) => 8 + (H - 20) * Math.min(1.6, f(Math.max(0, (now - ms) / 1000) / z) / f(maxAge / z));
			[0, 5, 10, 20, 30, 45, 60, 90, 120, 180, 300, 600, 900, 1800, 3600, 7200].filter((a) => a <= maxAge + 10).forEach((a) => {
				const major = [0, 10, 30, 60, 120, 300, 900, 3600].includes(a);
				if (settings.density === 'sparse' && !major) return;
				ticks.push({ ms: now - a * 1000, major });
			});
		} else {
			if (settings.win !== 'manual') {
				const span = settings.win === 'fit' ? maxAge : settings.win === 'custom' ? settings.customSec : Number(settings.win) || 60;
				rowH = clamp((H - 20) / span * settings.rowZoom, 0.5, 40);
			}
			yOf = (ms) => 8 + ((now - ms) / 1000) * rowH;
			const base = Math.floor(now / 1000);
			const minPx = { auto: 13, dense: 9, sparse: 30 }[settings.density] || 13;
			const step = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600].find((n) => n * rowH >= minPx) || 3600;
			for (let i = 0; i < H / rowH + 2; i++) if (!((base - i) % step)) ticks.push({ ms: (base - i) * 1000, major: (base - i) % (step * 5) === 0 });
		}
		const tickLabel = (ms: number) => (settings.tfmt === 'rel' ? fmtAge((now - ms) / 1000) : settings.tfmt === 'clock' ? fmtAxis(new Date(ms)) : fmtClock(new Date(ms)));

		// ---- geometry
		const usable = W - 26;
		const auto = usable / Math.max(1, laneNames.length - 0.4);
		const laneGap = Math.max(8, Math.min(auto, isExpanded ? 46 : 38) * settings.laneScale);
		const laneX0 = 16;
		const laneXof = (name: string) => laneX0 + slotOf(name) * laneGap;
		const dotR = st.dotR * settings.dot * (isExpanded ? 1.12 : 0.9);
		const lw = st.line * settings.lw * (isExpanded ? 1.1 : 0.85);
		const gm = settings.grid === 'style' ? st.grid : settings.grid;
		const defs = mk('defs', {}, graphSvg);
		if (st.glow) {
			const f = mk('filter', { id: 'gantt-gl', filterUnits: 'userSpaceOnUse', x: 0, y: -40, width: W, height: H + 80 }, defs);
			mk('feGaussianBlur', { stdDeviation: st.id === 'aurora' ? 3 : 2, result: 'b' }, f);
			const m = mk('feMerge', {}, f); mk('feMergeNode', { in: 'b' }, m); mk('feMergeNode', { in: 'SourceGraphic' }, m);
		}

		// ---- grid + time axis
		ticks.forEach(({ ms, major }) => {
			const y = yOf(ms);
			if (y < 0 || y > H) return;
			if (gm === 'rows' || (gm !== 'none' && major) || gm === 'full') {
				mk('line', { x1: 0, x2: W, y1: y, y2: y, stroke: pal.ink, 'stroke-dasharray': { solid: 'none', dashed: '5 4', dotted: '1 4' }[settings.gridLine] || 'none', 'stroke-opacity': Math.min(1, (gm === 'full' ? (major ? 0.22 : 0.1) : (major ? 0.1 : 0.04)) * settings.gridOp) }, graphSvg);
			}
			const tx = mk('text', { x: AW - 3, y, 'text-anchor': 'end', 'dominant-baseline': 'middle', 'font-size': settings.tfmt === 'clock' ? 6.5 : 8.5, 'font-family': MONO_FONT, fill: major ? pal.ink2 : pal.ink3, 'fill-opacity': major ? 1 : 0.8 }, timeSvg);
			tx.textContent = tickLabel(ms);
		});
		if (gm !== 'none' && settings.guides) {
			laneNames.forEach((n, i) => {
				const lx = laneXof(n);
				const c = lanes[i]!.color;
				mk('line', { x1: lx, x2: lx, y1: 0, y2: H, stroke: gm === 'full' ? pal.ink : c, 'stroke-opacity': gm === 'full' ? 0.1 : 0.12, 'stroke-dasharray': gm === 'full' ? 'none' : '2 5' }, graphSvg);
			});
		}

		const yNow = yOf(now);
		if (st.dot && settings.now) {
			mk('line', { x1: 0, x2: W, y1: yNow, y2: yNow, stroke: pal.accent, 'stroke-opacity': 0.6, 'stroke-dasharray': settings.nowStyle === 'dashed' ? '6 4' : settings.nowStyle === 'solid' ? 'none' : (st.id === 'blueprint' ? '4 3' : 'none') }, graphSvg);
			if (settings.nowLabel) {
				const nt = mk('text', { x: W - 4, y: yNow - 4, 'text-anchor': 'end', 'font-size': 7.5, fill: pal.accent, 'letter-spacing': '.08em' }, graphSvg);
				nt.textContent = 'NOW';
			}
		}

		// ---- tasks
		list.sort((a, b) => a.start - b.start);
		list.forEach((s, ti) => {
			if (hiddenLanes.has(s.lane)) return;
			const laneIdx = laneNames.indexOf(s.lane);
			if (laneIdx < 0) return;
			const sub = subSlot.get(s.id) || 0;
			const x = laneXof(s.lane) + (settings.concurrent === 'stack' ? sub * Math.max(4, lw * 0.9) : 0);
			const open = s.end >= now;
			const finished = !open;
			let col = s.color;
			if (settings.colorBy === 'mono') col = pal.ink2;
			else if (settings.colorBy === 'accent') col = pal.accent;
			else if (settings.colorBy === 'status') col = open ? '#3ddc97' : '#8a93a8';
			else if (settings.colorBy === 'dur') col = `hsl(${190 + Math.min(1, Math.min(s.dur, 120) / 120) * 140},85%,62%)`;
			const yS = Math.min(yOf(s.start), H - 6);
			const yE = open ? yNow : Math.min(yOf(s.end), H - 6);
			if (yE > H + 20 || yS < -20) return;

			const opacity = ((settings.focus && hoverId && hoverId !== s.id) ? 0.22 : 1)
				* (settings.finMode === 'fade' && finished ? 0.38 : 1)
				* (settings.colorBy === 'age' && finished ? Math.max(0.25, 1 - (now - s.end) / 1000 / 150) : 1)
				* settings.barOp;
			const grp = mk('g', { style: 'cursor:pointer', opacity }, graphSvg);

			// body
			let stroke = col;
			if (st.gradient) {
				const id = `gantt-lg-${++gradientCounter}`;
				const lg = mk('linearGradient', { id, x1: 0, x2: 0, y1: yE, y2: yS, gradientUnits: 'userSpaceOnUse' }, defs);
				mk('stop', { offset: 0, 'stop-color': col }, lg);
				mk('stop', { offset: 1, 'stop-color': col, 'stop-opacity': 0.4 }, lg);
				stroke = `url(#${id})`;
			}
			if (st.halo) mk('line', { x1: x, x2: x, y1: yE, y2: yS, stroke: col, 'stroke-opacity': 0.2, 'stroke-width': lw + 5, 'stroke-linecap': 'round' }, grp);
			if (st.cap) {
				mk('rect', { x: x - lw / 2, y: yE - lw / 2, width: lw, height: Math.max(lw, yS - yE + lw), rx: lw / 2, fill: st.id === 'aurora' ? stroke : col, 'fill-opacity': st.id === 'aurora' ? 0.9 : 0.28, stroke: col, 'stroke-width': st.id === 'aurora' ? 0 : 1.4, filter: st.glow ? 'url(#gantt-gl)' : 'none' }, grp);
			} else {
				mk('line', { x1: x, x2: x, y1: yE, y2: yS, stroke, 'stroke-width': lw, 'stroke-linecap': settings.lineCap === 'style' ? (st.dot === 'square' ? 'butt' : 'round') : settings.lineCap, filter: st.glow ? 'url(#gantt-gl)' : 'none', 'stroke-dasharray': st.id === 'blueprint' && open ? '5 3' : 'none' }, grp);
			}

			// dots
			const kind = settings.dotShape === 'style' ? st.dot : settings.dotShape;
			const dot = (y: number, isOpen: boolean) => {
				if (kind === 'none') return;
				if (kind === 'diamond') {
					mk('polygon', { points: `${x},${y - dotR - 1} ${x + dotR + 1},${y} ${x},${y + dotR + 1} ${x - dotR - 1},${y}`, fill: isOpen ? pal.solid : col, stroke: col, 'stroke-width': 1.6 }, grp);
				} else if (kind === 'square') {
					mk('rect', { x: x - dotR, y: y - dotR, width: dotR * 2, height: dotR * 2, fill: isOpen ? pal.solid : col, stroke: col, 'stroke-width': 1.5 }, grp);
				} else if (kind === 'station') {
					mk('circle', { cx: x, cy: y, r: dotR, fill: isOpen ? col : '#fff', stroke: isOpen ? '#fff' : col, 'stroke-width': 2.6 }, grp);
				} else if (kind === 'ring') {
					mk('circle', { cx: x, cy: y, r: dotR, fill: isOpen ? pal.solid : (pal.light ? '#fff' : '#fff'), stroke: col, 'stroke-width': 2.2 }, grp);
				} else if (kind === 'orb') {
					mk('circle', { cx: x, cy: y, r: dotR + 3, fill: col, 'fill-opacity': 0.25, filter: 'url(#gantt-gl)' }, grp);
					mk('circle', { cx: x, cy: y, r: dotR - (isOpen ? 1.2 : 0), fill: isOpen ? pal.solid : '#fff', stroke: col, 'stroke-width': isOpen ? 2.2 : 1.8 }, grp);
				} else {
					if (st.halo) mk('circle', { cx: x, cy: y, r: dotR + 2, fill: pal.solid }, grp);
					mk('circle', { cx: x, cy: y, r: isOpen ? dotR - 0.8 : dotR, fill: isOpen ? pal.solid : col, stroke: col, 'stroke-width': isOpen ? 2 : 0 }, grp);
				}
			};
			if (settings.ends === 'both' || settings.ends === 'start') dot(yS, false);
			if (settings.ends === 'both' || settings.ends === 'end') dot(yE, open);
			if (open && settings.pulse) {
				const ring = mk('circle', { cx: x, cy: yE, r: dotR + 1, fill: 'none', stroke: col, 'stroke-width': 1.6, class: 'slide-one-clock-part-gantt-chart-pulse' }, grp);
				const ph = (now % 1400) / 1400;
				ring.setAttribute('r', String(dotR + 1 + ph * 8));
				ring.setAttribute('stroke-opacity', String((1 - ph) * 0.7));
			}

			// task name (auto side: flips left when there is no room on the right)
			if (settings.labels) {
				const nm = settings.maxChars && s.name.length > settings.maxChars ? s.name.slice(0, settings.maxChars - 1) + '…' : s.name;
				const txt = settings.info === 'dur' ? `${nm} · ${Math.round(s.dur)}s`
					: settings.info === 'start' ? `${nm} · ${fmtClock(new Date(s.start))}`
					: settings.info === 'status' ? `${nm} · ${open ? 'running' : 'done'}`
					: nm;
				const fs = settings.labelSize * (isExpanded ? 1.15 : 1);
				const yL = settings.labelPos === 'end' ? yE : settings.labelPos === 'mid' ? (yS + yE) / 2 : yS;
				const w = txt.length * fs * 0.59 + 12;
				let left = settings.side === 'left';
				if (settings.side === 'auto') left = x + dotR + 3 + w + 4 > W;
				const dir = left ? -1 : 1;
				const edge = x + dir * (dotR + 3);
				const tail = edge + dir * 3;
				const boxX = left ? tail - w : tail;
				const txtX = left ? tail - 6 : tail + 6;
				const anchor = left ? 'end' : 'start';
				const tick = () => mk('line', { x1: x + dir * dotR, x2: tail, y1: yL, y2: yL, stroke: col, 'stroke-width': 1.3, 'stroke-linecap': 'round' }, grp);
				const T = (extra: Record<string, string | number>) => {
					const e = mk('text', { x: txtX, y: yL, 'text-anchor': anchor, 'dominant-baseline': 'middle', 'font-size': fs, ...extra }, grp);
					e.textContent = txt;
					return e;
				};
				const bh = fs + 5;
				switch (st.labels) {
					case 'pill': tick(); mk('rect', { x: boxX, y: yL - bh / 2, width: w, height: bh, rx: bh / 2, fill: col, 'fill-opacity': 0.14, stroke: col, 'stroke-opacity': 0.45 }, grp); T({ fill: pal.ink }); break;
					case 'pill-solid': tick(); mk('rect', { x: boxX, y: yL - bh / 2, width: w, height: bh, rx: bh / 2, fill: col }, grp); T({ fill: '#14111c', 'font-weight': 700 }); break;
					case 'tag': tick(); mk('rect', { x: boxX, y: yL - (bh - 2) / 2, width: w, height: bh - 2, fill: 'none', stroke: col, 'stroke-width': 1 }, grp); T({ fill: col }); break;
					case 'bold': T({ x: edge, fill: pal.ink, 'font-weight': 700, stroke: pal.solid, 'stroke-width': 3, 'paint-order': 'stroke' }); break;
					case 'glow': T({ x: edge, fill: pal.ink, filter: 'url(#gantt-gl)' }); break;
					case 'bracket': { const e = T({ x: edge, fill: col }); e.textContent = `[${txt}]`; break; }
					default: T({ x: edge, fill: pal.ink2 });
				}
			}
			const hit = mk('rect', { x: x - 10, y: yE - 5, width: 80, height: Math.max(14, yS - yE + 10), fill: 'transparent' }, grp);
			hit.addEventListener('mousemove', (e) => { if (hoverId !== s.id) { hoverId = s.id; } showTip(e, s, col, open); });
			hit.addEventListener('mouseleave', () => { hoverId = null; hideTip(); });
		});

		renderCategoryAxis(st, pal, order, laneNames, laneGap, laneX0, list);
		root.toggleClass('is-hovering', hoverId != null);
	};

	// ----------------------------------------------- category axis (under / over the lanes)

	const renderCategoryAxis = (st: GanttStyle, pal: Palette, order: number[], laneNames: string[], laneGap: number, laneX0: number, list: Seg[]) => {
		const mode = settings.cax;
		if (mode === 'none') { catAxis.removeClass('is-svg-axis'); catAxis.empty(); catSvgAttached = false; return; }
		if (mode === 'chips') {
			// the original wrap of "swatch + name" chips
			catAxis.removeClass('is-svg-axis');
			if (catSvgAttached) { catAxis.empty(); catSvgAttached = false; }
			const sig = lanes.map((l) => l.name + l.color).join('|') + settings.hidden.join(',');
			if (catAxis.dataset.sig !== sig || catAxis.childElementCount === 0) {
				catAxis.empty(); catAxis.dataset.sig = sig;
				lanes.forEach((col) => {
					const chip = catAxis.createDiv({ cls: 'slide-one-clock-part-gantt-chart-category-axis-cell' });
					chip.createSpan({ cls: 'slide-one-clock-part-gantt-chart-legend-dot' }).style.backgroundColor = col.color || '#ffffff';
					chip.createSpan({ cls: 'slide-one-clock-part-gantt-chart-legend-label', text: col.name });
				});
			}
			return;
		}
		// SVG axis aligned under each lane
		// .is-svg-axis: no padding, display block (styles.css)
		catAxis.addClass('is-svg-axis');
		if (!catSvgAttached) { catAxis.empty(); catAxis.dataset.sig = ''; catAxis.appendChild(catSvg); catSvgAttached = true; }
		const tw = Math.max(60, catAxis.clientWidth);
		const longest = Math.max(1, ...laneNames.map((n) => n.length + (settings.counts ? 4 : 0))) * settings.caxSize * 0.58 + 6;
		const rotate = mode === 'axis-rot' || (mode === 'axis' && laneGap < longest);
		const hh = catAxisHeight();
		catSvg.setAttribute('viewBox', `0 0 ${tw} ${hh}`); catSvg.setAttribute('width', String(tw)); catSvg.setAttribute('height', String(hh));
		catSvg.replaceChildren();
		const flip = settings.caxPos === 'top';
		const baseY = flip ? hh - 6 : 6;
		mk('line', { x1: 0, x2: tw, y1: baseY, y2: baseY, stroke: pal.line, 'stroke-width': 1.2 }, catSvg);
		order.forEach((li, k) => {
			const col = lanes[li]!;
			const x = laneX0 + k * laneGap + 1;
			const hid = settings.hidden.includes(col.name);
			const n = list.filter((s) => s.lane === col.name).length;
			const g = mk('g', { style: 'cursor:pointer', opacity: hid ? 0.35 : 1 }, catSvg);
			const dir = flip ? -1 : 1;
			mk('line', { x1: x, x2: x, y1: baseY, y2: baseY + dir * 8, stroke: col.color, 'stroke-width': 2, 'stroke-linecap': 'round' }, g);
			if (mode === 'axis-dots') {
				const cy = baseY + dir * 20;
				mk('circle', { cx: x, cy, r: 8, fill: col.color }, g);
				const t1 = mk('text', { x, y: cy, 'text-anchor': 'middle', 'dominant-baseline': 'middle', 'font-size': 8.5, 'font-weight': 700, fill: '#101216' }, g);
				t1.textContent = col.name.slice(0, 2);
				if (settings.counts) { const t2 = mk('text', { x, y: cy + dir * 15, 'text-anchor': 'middle', 'dominant-baseline': 'middle', 'font-size': 8, fill: pal.ink2 }, g); t2.textContent = String(n); }
			} else {
				mk('circle', { cx: x, cy: baseY + dir * 13, r: 3, fill: col.color }, g);
				const label = mode === 'axis-short' ? col.name.slice(0, 3) : col.name;
				const text = settings.counts ? `${label} (${n})` : label;
				const ty = baseY + dir * 20;
				const t1 = rotate
					? mk('text', { x: x + 3, y: ty, 'text-anchor': 'start', 'font-size': settings.caxSize, fill: pal.ink, transform: `rotate(${flip ? -40 : 40} ${x + 3} ${ty})`, 'dominant-baseline': 'middle' }, g)
					: mk('text', { x, y: ty + dir * 2, 'text-anchor': 'middle', 'font-size': settings.caxSize, fill: pal.ink }, g);
				let shown = text;
				if (rotate) {
					// keep the slanted label inside the strip: horizontal run = length * cos(40deg)
					const room = Math.max(24, (tw - x - 6) / 0.77);
					const fit = Math.floor(room / (settings.caxSize * 0.58));
					if (shown.length > fit) shown = shown.slice(0, Math.max(3, fit - 1)) + '…';
				}
				t1.textContent = shown;
			}
			if (hid) mk('line', { x1: x - 10, x2: x + 10, y1: baseY + dir * 20, y2: baseY + dir * 20, stroke: pal.ink, 'stroke-opacity': 0.6 }, g);
			mk('title', {}, g).textContent = `${col.name}: click to ${hid ? 'show' : 'hide'}`;
			g.addEventListener('click', () => {
				if (hDragMoved) return; // that was a drag on the axis, not a click on a lane
				const i = settings.hidden.indexOf(col.name);
				if (i >= 0) settings.hidden.splice(i, 1); else settings.hidden.push(col.name);
				saveSettings(instance, settings); render();
			});
		});
	};

	// -------------------------------------------------------------- loop

	const myToken = ++ganttToken;
	instance.ganttToken = myToken;
	let lastFrame = 0;
	const frame = (t: number) => {
		if (instance.ganttToken !== myToken || !root.isConnected) return; // chart was replaced / removed
		if (t - lastFrame >= FRAME_MS && !document.hidden) {
			lastFrame = t;
			try { render(); } catch (e) { console.error('Gantt chart: draw failed', e); }
		}
		window.requestAnimationFrame(frame);
	};

	const tickData = () => {
		if (!root.isConnected) return;
		refreshSegments(Date.now());
	};

	if (instance.ganntInterval) window.clearInterval(instance.ganntInterval);
	refreshSegments(Date.now());
	instance.ganntInterval = window.setInterval(tickData, 1000);
	render();
	window.requestAnimationFrame(frame);

	// ------------------------------------------------------------ options

	const options = buildOptionsPanel(root, settings, (key) => {
		saveSettings(instance, settings);
		if (key === 'style' || key === 'all') { /* surfaces re-applied in render() */ }
		if (key === 'lookback') refreshSegments(Date.now());
		render();
	});

	// Toggle expand state on click -- widens the panel (existing behavior) and
	// gives the graph more breathing room: bigger lane spacing, dots and text.
	expandBtn.addEventListener('click', () => {
		isExpanded = !isExpanded;
		// .selected-global-task also sets the expanded width (styles.css)
		if (isExpanded) {
			root.addClass('selected-global-task');
			expandBtn.setText('Collapse');
		} else {
			root.removeClass('selected-global-task');
			expandBtn.setText('Expand');
		}
		// The panel's width transitions -- redraw now, then once it settles.
		render();
		window.requestAnimationFrame(render);
	});
	root.addEventListener('transitionend', (e) => {
		if (e.propertyName === 'flex-basis' || e.propertyName === 'width') render();
	});
	// close the popover when clicking elsewhere on the chart
	page.addEventListener('mousedown', () => options.close());

	// --- Drag-to-zoom, with a small badge showing the current percentage ---
	let zoomBadgeHideTimer: number | null = null;
	const showZoomBadge = (text: string) => {
		zoomBadge.setText(text);
		zoomBadge.addClass('is-visible');
		if (zoomBadgeHideTimer) window.clearTimeout(zoomBadgeHideTimer);
	};
	const hideZoomBadgeSoon = () => {
		if (zoomBadgeHideTimer) window.clearTimeout(zoomBadgeHideTimer);
		zoomBadgeHideTimer = window.setTimeout(() => zoomBadge.removeClass('is-visible'), 700);
	};

	// Vertical drag on the time axis: dragging DOWN zooms the time scale out
	// (more time in the same space); dragging UP zooms back in.
	let vDragStartY = 0;
	let vDragStartScale = 1;
	const onVDragMove = (e: MouseEvent) => {
		settings.rowZoom = clamp(vDragStartScale - (e.clientY - vDragStartY) / 120, 0.4, 3);
		showZoomBadge(`Time ${Math.round(settings.rowZoom * 100)}%`);
		render();
	};
	const onVDragEnd = () => {
		document.removeEventListener('mousemove', onVDragMove);
		document.removeEventListener('mouseup', onVDragEnd);
		timeAxis.removeClass('is-dragging');
		hideZoomBadgeSoon();
		saveSettings(instance, settings);
		options.sync();
	};
	timeAxis.addEventListener('mousedown', (e) => {
		e.preventDefault();
		vDragStartY = e.clientY;
		vDragStartScale = settings.rowZoom;
		timeAxis.addClass('is-dragging');
		showZoomBadge(`Time ${Math.round(settings.rowZoom * 100)}%`);
		document.addEventListener('mousemove', onVDragMove);
		document.addEventListener('mouseup', onVDragEnd);
	});

	// Horizontal drag on the graph: dragging RIGHT packs the lanes tighter,
	// dragging LEFT spreads them out again.
	let hDragStartX = 0;
	let hDragStartScale = 1;
	let hDragEl: HTMLElement = page;
	const onHDragMove = (e: MouseEvent) => {
		if (Math.abs(e.clientX - hDragStartX) > 3) hDragMoved = true;
		settings.laneScale = clamp(hDragStartScale - (e.clientX - hDragStartX) / 100, 0.4, 2.5);
		showZoomBadge(`Lanes ${Math.round(settings.laneScale * 100)}%`);
		render();
	};
	const onHDragEnd = () => {
		document.removeEventListener('mousemove', onHDragMove);
		document.removeEventListener('mouseup', onHDragEnd);
		hDragEl.removeClass('is-dragging');
		hideZoomBadgeSoon();
		saveSettings(instance, settings);
		options.sync();
		window.setTimeout(() => { hDragMoved = false; }, 0); // lets the click handler see the flag first
	};
	// Same lane-spacing drag works on the graph AND on the category (tasks) axis.
	const startHDrag = (el: HTMLElement) => (e: MouseEvent) => {
		e.preventDefault();
		hDragMoved = false;
		hDragEl = el;
		hDragStartX = e.clientX;
		hDragStartScale = settings.laneScale;
		el.addClass('is-dragging');
		showZoomBadge(`Lanes ${Math.round(settings.laneScale * 100)}%`);
		document.addEventListener('mousemove', onHDragMove);
		document.addEventListener('mouseup', onHDragEnd);
	};
	page.addEventListener('mousedown', startHDrag(page));
	catAxis.addEventListener('mousedown', startHDrag(catAxis));

	void lastW; void lastH;
};

const MONO_FONT = 'var(--font-monospace, ui-monospace, Menlo, monospace)';
