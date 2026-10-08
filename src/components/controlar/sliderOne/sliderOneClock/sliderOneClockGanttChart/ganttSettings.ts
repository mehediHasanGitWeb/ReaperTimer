// Gantt chart look + options: the 14 visual styles, the option list shown in the
// gear popover, and loading / saving of the user's choices.
//
// Choices live in data.json under `data.ganttSettings` (plain JSON), saved
// through the same safeSaveData() path every other setting uses.

import { state, safeSaveData } from '../../../../../state';
import type { ControlarHost, DataSection } from '../../../../../types';

// ---------------------------------------------------------------- settings

export interface GanttSettings {
	style: string;          // 'auto' (match the plugin theme) or a style id
	// time
	win: string;            // fit | elastic | seconds ('30'...) | custom | manual
	customSec: number;
	lookback: number;       // seconds of history kept
	rowZoom: number;        // 1 = 100 % (also set by dragging the time axis)
	tfmt: string;           // time | clock | rel
	density: string;        // auto | dense | sparse
	// task names
	labels: boolean;
	side: string;           // auto | right | left
	info: string;           // name | dur | start | status
	labelPos: string;       // start | mid | end
	labelSize: number;
	maxChars: number;       // 0 = whole name
	tip: string;            // basic | detail
	// colour + status
	colorBy: string;        // cat | status | dur | age | mono | accent
	status: string;         // all | running | finished
	finMode: string;        // show | fade | hide
	finSecs: number;
	focus: boolean;
	barOp: number;          // 0.3 - 1
	concurrent: string;     // first (one task per lane at a time) | stack
	// axis + lanes
	cax: string;            // axis | axis-rot | axis-short | axis-dots | chips | none
	caxPos: string;         // bottom | top
	caxSize: number;
	counts: boolean;
	sort: string;           // list | az | za | count | fewest | running
	laneScale: number;      // also set by dragging the graph
	hidden: string[];       // lanes switched off by clicking the axis
	// grid
	grid: string;           // style | rows | major | full | none
	gridLine: string;       // solid | dashed | dotted
	gridOp: number;
	guides: boolean;
	// marks
	lw: number;
	lineCap: string;        // style | round | butt
	dot: number;
	dotShape: string;       // style | circle | square | diamond | ring | none
	ends: string;           // both | start | end | none
	pulse: boolean;
	// now line + layout
	now: boolean;
	nowStyle: string;       // style | solid | dashed
	nowLabel: boolean;
	plotH: number;          // 0 = fit the panel
}

export const DEFAULT_SETTINGS: GanttSettings = {
	style: 'auto',
	win: 'fit', customSec: 90, lookback: 600, rowZoom: 1, tfmt: 'time', density: 'auto',
	labels: true, side: 'auto', info: 'name', labelPos: 'start', labelSize: 9, maxChars: 0, tip: 'basic',
	colorBy: 'cat', status: 'all', finMode: 'show', finSecs: 30, focus: true, barOp: 1, concurrent: 'first',
	cax: 'axis', caxPos: 'bottom', caxSize: 9.5, counts: false, sort: 'list', laneScale: 1, hidden: [],
	grid: 'style', gridLine: 'solid', gridOp: 1, guides: true,
	lw: 1, lineCap: 'style', dot: 1, dotShape: 'style', ends: 'both', pulse: true,
	now: true, nowStyle: 'style', nowLabel: true, plotH: 0,
};

const settingsHost = (): DataSection => {
	const fd = state.fileData || {};
	return fd.data && typeof fd.data === 'object' ? fd.data : fd;
};

export const loadSettings = (): GanttSettings => {
	const saved = settingsHost().ganttSettings;
	const out: GanttSettings = { ...DEFAULT_SETTINGS, hidden: [] };
	if (saved && typeof saved === 'object') {
		const writable = out as unknown as Record<string, unknown>;
		for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof GanttSettings)[]) {
			const v = saved[k];
			if (v === undefined || v === null) continue;
			if (typeof v === typeof DEFAULT_SETTINGS[k]) writable[k] = v;
		}
		if (!Array.isArray(out.hidden)) out.hidden = [];
	}
	out.style = 'auto'; // the look always follows the plugin theme (no manual style picker)
	return out;
};

let saveTimer: number | null = null;
/** Remember the choices (debounced -- sliders fire a lot). */
export const saveSettings = (instance: ControlarHost, s: GanttSettings): void => {
	settingsHost().ganttSettings = { ...s, hidden: [...s.hidden] };
	if (saveTimer) window.clearTimeout(saveTimer);
	saveTimer = window.setTimeout(() => {
		saveTimer = null;
		if (instance && instance.plugin) void safeSaveData(instance.plugin, null);
	}, 500);
};

// ------------------------------------------------------------------ styles

export interface Palette {
	/** panel background (a colour or a gradient) */
	bg: string;
	/** one solid colour close to the panel, used to knock out dots / label backgrounds */
	solid: string;
	/** plot-area background */
	plot: string;
	ink: string;
	ink2: string;
	ink3: string;
	/** axis + border line */
	line: string;
	accent: string;
	light: boolean;
}

export type DotKind = 'circle' | 'square' | 'ring' | 'station' | 'orb';
export type LabelKind = 'pill' | 'pill-solid' | 'tag' | 'text' | 'bold' | 'glow' | 'bracket';

export interface GanttStyle {
	id: string;
	name: string;
	line: number;
	halo: boolean;
	glow: boolean;
	fade: boolean;
	dot: DotKind;
	dotR: number;
	labels: LabelKind;
	grid: 'rows' | 'major' | 'full';
	gradient: boolean;
	cap: boolean;
	font: string;
	pal: Palette;
}

const SANS = 'var(--font-interface, system-ui, sans-serif)';
const MONO = 'var(--font-monospace, ui-monospace, Menlo, Consolas, monospace)';

const P = (bg: string, solid: string, plot: string, ink: string, ink2: string, ink3: string, line: string, accent: string, light = false): Palette =>
	({ bg, solid, plot, ink, ink2, ink3, line, accent, light });

export const STYLES: GanttStyle[] = [
	{ id: 'tdef', name: 'Plugin Default', line: 10, halo: false, glow: false, fade: true, dot: 'circle', dotR: 5, labels: 'pill', grid: 'major', gradient: false, cap: true, font: SANS,
		pal: P('#181818', '#181818', '#101010', '#f0f0f2', '#a6a6ac', '#6b6b72', 'rgba(255,255,255,.14)', '#8b7bff') },
	{ id: 'tmag', name: 'Plugin Magma', line: 10, halo: false, glow: false, fade: true, dot: 'ring', dotR: 5, labels: 'text', grid: 'major', gradient: false, cap: true, font: SANS,
		pal: P('#e0e0e0', '#e0e0e0', '#e0e0e0', '#4a4a4a', '#6b6b6b', '#9a9a9a', 'rgba(0,0,0,.1)', '#e0401f', true) },
	{ id: 'tmet', name: 'Plugin Metal', line: 10, halo: false, glow: false, fade: false, dot: 'ring', dotR: 5, labels: 'tag', grid: 'full', gradient: false, cap: true, font: MONO,
		pal: P('linear-gradient(160deg,#4a6350,#2c4033 55%,#10190f)', '#2c4033', '#031409', '#d3f0d8', '#9ec7a8', '#5f8368', 'rgba(190,255,215,.28)', '#9fdb8e') },
	{ id: 'tpap', name: 'Plugin Paper', line: 10, halo: false, glow: false, fade: true, dot: 'ring', dotR: 4.6, labels: 'pill', grid: 'rows', gradient: false, cap: true, font: 'Georgia, serif',
		pal: P('#fefaf2', '#fefaf2', '#fbe9e2', '#4e2e35', '#8a5d66', '#bf9aa2', 'rgba(78,46,53,.22)', '#c4566b', true) },
];

export const styleById = (id: string): GanttStyle => STYLES.find((s) => s.id === id) || STYLES[0]!;

/** Which of the plugin's own themes is active (drives "Auto"). */
export const currentThemeStyleId = (): string => {
	const cl = document.body.classList;
	if (cl.contains('controlar-theme-magma')) return 'tmag';
	if (cl.contains('controlar-theme-metal')) return 'tmet';
	if (cl.contains('controlar-theme-paper')) return 'tpap';
	return 'tdef';
};

// ------------------------------------------------------------------ options
// One config drives the popover. `when` hides a row until it matters.

export type Opt = [string, string];
export interface OptionItem {
	k: keyof GanttSettings;
	label: string;
	t: 'select' | 'range' | 'toggle';
	opts?: Opt[];
	min?: number; max?: number; step?: number; scale?: number; unit?: string;
	fmt?: (v: number) => string;
	when?: (s: GanttSettings) => boolean;
}
export interface OptionGroup { title: string; items: OptionItem[] }

const O = (v: string, t: string): Opt => [v, t];

export const OPTION_GROUPS: OptionGroup[] = [
	{ title: 'Time', items: [
		{ k: 'win', label: 'Time scale', t: 'select', opts: [O('fit', 'Fit all tasks (auto)'), O('elastic', 'Elastic (old compress)'), O('15', 'Fixed 15 s'), O('30', 'Fixed 30 s'), O('60', 'Fixed 60 s'), O('90', 'Fixed 90 s'), O('120', 'Fixed 2 min'), O('300', 'Fixed 5 min'), O('600', 'Fixed 10 min'), O('custom', 'Custom seconds'), O('manual', 'Manual (row height)')] },
		{ k: 'customSec', label: 'Custom window', t: 'range', min: 10, max: 900, unit: ' s', when: (s) => s.win === 'custom' },
		{ k: 'rowZoom', label: 'Time zoom', t: 'range', min: 40, max: 300, scale: 100, unit: '%' },
		{ k: 'lookback', label: 'History kept', t: 'select', opts: [O('60', '1 min'), O('300', '5 min'), O('600', '10 min'), O('1800', '30 min'), O('3600', '1 hour')] },
		{ k: 'tfmt', label: 'Time labels', t: 'select', opts: [O('time', 'Time only'), O('clock', 'Date + time'), O('rel', 'Relative (-12s)')] },
		{ k: 'density', label: 'Label density', t: 'select', opts: [O('auto', 'Auto'), O('dense', 'Dense'), O('sparse', 'Sparse')] },
	] },
	{ title: 'Names', items: [
		{ k: 'labels', label: 'Show names', t: 'toggle' },
		{ k: 'info', label: 'Content', t: 'select', opts: [O('name', 'Name'), O('dur', 'Name + length'), O('start', 'Name + start time'), O('status', 'Name + status')] },
		{ k: 'side', label: 'Side', t: 'select', opts: [O('auto', 'Auto'), O('right', 'Right'), O('left', 'Left')] },
		{ k: 'labelPos', label: 'Position', t: 'select', opts: [O('start', 'At start (bottom)'), O('mid', 'Middle of bar'), O('end', 'At end (top)')] },
		{ k: 'labelSize', label: 'Text size', t: 'range', min: 7, max: 14, step: 0.5, unit: ' px' },
		{ k: 'maxChars', label: 'Max characters', t: 'range', min: 0, max: 30, fmt: (v) => (v ? String(v) : 'all') },
		{ k: 'tip', label: 'Tooltip', t: 'select', opts: [O('basic', 'Basic'), O('detail', 'Detailed')] },
	] },
	{ title: 'Colour', items: [
		{ k: 'colorBy', label: 'Colour by', t: 'select', opts: [O('cat', 'Category'), O('status', 'Status (running / done)'), O('dur', 'Task length'), O('age', 'Category, fade with age'), O('mono', 'Single neutral'), O('accent', 'Theme accent')] },
		{ k: 'status', label: 'Show tasks', t: 'select', opts: [O('all', 'All'), O('running', 'Running only'), O('finished', 'Finished only')] },
		{ k: 'finMode', label: 'Finished tasks', t: 'select', opts: [O('show', 'Keep'), O('fade', 'Fade out'), O('hide', 'Hide after…')] },
		{ k: 'finSecs', label: 'Hide after', t: 'range', min: 5, max: 300, unit: ' s', when: (s) => s.finMode === 'hide' },
		{ k: 'concurrent', label: 'Same-lane overlap', t: 'select', opts: [O('first', 'One task per lane'), O('stack', 'Stack side by side')] },
		{ k: 'focus', label: 'Focus on hover', t: 'toggle' },
		{ k: 'barOp', label: 'Bar opacity', t: 'range', min: 30, max: 100, scale: 100, unit: '%' },
	] },
	{ title: 'Axis', items: [
		{ k: 'cax', label: 'Category axis', t: 'select', opts: [O('axis', 'Axis · full names'), O('axis-rot', 'Axis · rotated'), O('axis-short', 'Axis · short'), O('axis-dots', 'Axis · initials'), O('chips', 'Chips (old)'), O('none', 'Hidden')] },
		{ k: 'caxPos', label: 'Axis position', t: 'select', opts: [O('bottom', 'Bottom'), O('top', 'Top')] },
		{ k: 'caxSize', label: 'Axis text size', t: 'range', min: 7, max: 14, step: 0.5, unit: ' px' },
		{ k: 'counts', label: 'Task counts', t: 'toggle' },
		{ k: 'sort', label: 'Lane order', t: 'select', opts: [O('list', 'Category list'), O('az', 'A – Z'), O('za', 'Z – A'), O('count', 'Most tasks'), O('fewest', 'Fewest tasks'), O('running', 'Most running')] },
		{ k: 'laneScale', label: 'Lane spacing', t: 'range', min: 40, max: 250, scale: 100, unit: '%' },
	] },
	{ title: 'Grid', items: [
		{ k: 'grid', label: 'Grid', t: 'select', opts: [O('style', 'Style default'), O('rows', 'Every row'), O('major', 'Every 5th'), O('full', 'Full grid'), O('none', 'None')] },
		{ k: 'gridLine', label: 'Grid line', t: 'select', opts: [O('solid', 'Solid'), O('dashed', 'Dashed'), O('dotted', 'Dotted')] },
		{ k: 'gridOp', label: 'Grid strength', t: 'range', min: 0, max: 300, scale: 100, unit: '%' },
		{ k: 'guides', label: 'Lane guide lines', t: 'toggle' },
	] },
	{ title: 'Marks', items: [
		{ k: 'lw', label: 'Line thickness', t: 'range', min: 40, max: 250, scale: 100, unit: '%' },
		{ k: 'lineCap', label: 'Line ends', t: 'select', opts: [O('style', 'Style default'), O('round', 'Round'), O('butt', 'Flat')] },
		{ k: 'dot', label: 'Dot size', t: 'range', min: 50, max: 220, scale: 100, unit: '%' },
		{ k: 'dotShape', label: 'Dot shape', t: 'select', opts: [O('style', 'Style default'), O('circle', 'Circle'), O('square', 'Square'), O('diamond', 'Diamond'), O('ring', 'Ring'), O('none', 'None')] },
		{ k: 'ends', label: 'Show dots at', t: 'select', opts: [O('both', 'Start and end'), O('start', 'Start only'), O('end', 'End only'), O('none', 'Neither')] },
		{ k: 'pulse', label: 'Pulse running tasks', t: 'toggle' },
	] },
	{ title: 'Layout', items: [
		{ k: 'now', label: 'Now line', t: 'toggle' },
		{ k: 'nowStyle', label: 'Now line style', t: 'select', opts: [O('style', 'Style default'), O('solid', 'Solid'), O('dashed', 'Dashed')] },
		{ k: 'nowLabel', label: '"NOW" label', t: 'toggle' },
		{ k: 'plotH', label: 'Chart height', t: 'range', min: 0, max: 560, unit: ' px', fmt: (v) => (v ? v + ' px' : 'auto') },
	] },
];
