// The gear button + small popover with every Gantt option.
//
// Closed by default so the chart keeps the room it always had. The popover
// floats over the plot area (the clock part clips anything outside its own
// box), shows one group at a time, and writes straight into the shared
// settings object the chart reads on every redraw.

import { setIcon } from 'obsidian';
import { DEFAULT_SETTINGS, OPTION_GROUPS } from './ganttSettings';
import type { GanttSettings, OptionItem } from './ganttSettings';

const CLS = 'slide-one-clock-part-gantt-chart';

export interface OptionsPanelApi {
	/** re-read the settings object into every control (after a drag-zoom, reset, ...) */
	sync(): void;
	close(): void;
}

export const buildOptionsPanel = (
	host: HTMLElement,
	settings: GanttSettings,
	onChange: (key: keyof GanttSettings | 'all') => void,
): OptionsPanelApi => {
	const gear = host.createDiv({ cls: `${CLS}-options-btn`, attr: { 'aria-label': 'Chart options', title: 'Chart options' } });
	setIcon(gear, 'settings');

	const pop = host.createDiv({ cls: `${CLS}-options` });
	pop.hide();

	// --- top row: just Reset (the look always follows the plugin theme)
	const top = pop.createDiv({ cls: `${CLS}-opt-top` });
	const reset = top.createEl('button', { cls: `${CLS}-opt-mini`, text: 'Reset all options', attr: { title: 'Reset all options' } });

	// --- tabs
	const tabs = pop.createDiv({ cls: `${CLS}-opt-tabs` });
	const pane = pop.createDiv({ cls: `${CLS}-opt-pane` });
	const refreshers: (() => void)[] = [];
	const bodies: HTMLElement[] = [];
	const tabEls: HTMLElement[] = [];
	let openIdx = 0;

	const showTab = (i: number) => {
		openIdx = i;
		bodies.forEach((b, j) => { if (j === i) b.show(); else b.hide(); });
		tabEls.forEach((t, j) => t.toggleClass('is-on', j === i));
	};

	const buildRow = (body: HTMLElement, it: OptionItem) => {
		const row = body.createDiv({ cls: `${CLS}-opt-row` });
		row.createSpan({ text: it.label });
		const key = it.k;
		const isNum = typeof DEFAULT_SETTINGS[key] === 'number';
		let refresh: () => void;
		if (it.t === 'select') {
			const sel = row.createEl('select', { cls: `${CLS}-opt-select` });
			(it.opts || []).forEach(([v, t]) => sel.createEl('option', { value: v, text: t }));
			sel.addEventListener('change', () => {
				(settings as unknown as Record<string, unknown>)[key] = isNum ? Number(sel.value) : sel.value;
				onChange(key); syncAll();
			});
			refresh = () => { sel.value = String((settings as unknown as Record<string, unknown>)[key]); };
		} else if (it.t === 'range') {
			const sc = it.scale || 1;
			const wrap = row.createDiv({ cls: `${CLS}-opt-range` });
			const input = wrap.createEl('input', { type: 'range' });
			input.min = String(it.min); input.max = String(it.max); input.step = String(it.step || 1);
			const out = wrap.createSpan({ cls: `${CLS}-opt-val` });
			const show = () => {
				const n = Number(input.value);
				out.setText(it.fmt ? it.fmt(n) : n + (it.unit || ''));
			};
			input.addEventListener('input', () => {
				(settings as unknown as Record<string, unknown>)[key] = Number(input.value) / sc;
				show(); onChange(key);
			});
			refresh = () => { input.value = String(Number((settings as unknown as Record<string, unknown>)[key]) * sc); show(); };
		} else {
			const tg = row.createDiv({ cls: `${CLS}-opt-toggle` });
			tg.addEventListener('click', () => {
				(settings as unknown as Record<string, unknown>)[key] = !(settings as unknown as Record<string, unknown>)[key];
				tg.toggleClass('is-on', !!(settings as unknown as Record<string, unknown>)[key]);
				onChange(key);
			});
			refresh = () => tg.toggleClass('is-on', !!(settings as unknown as Record<string, unknown>)[key]);
		}
		refreshers.push(() => {
			refresh();
			if (it.when) { if (it.when(settings)) row.show(); else row.hide(); }
		});
	};

	const syncAll = () => { refreshers.forEach((f) => f()); };

	OPTION_GROUPS.forEach((gp, i) => {
		const tab = tabs.createEl('button', { cls: `${CLS}-opt-tab`, text: gp.title });
		tab.addEventListener('click', () => showTab(i));
		tabEls.push(tab);
		const body = pane.createDiv({ cls: `${CLS}-opt-body` });
		gp.items.forEach((it) => buildRow(body, it));
		bodies.push(body);
	});
	showTab(0);

	reset.addEventListener('click', () => {
		const keep = settings.hidden;
		Object.assign(settings, DEFAULT_SETTINGS, { hidden: keep });
		settings.hidden = [];
		syncAll(); onChange('all');
	});

	let isOpen = false;
	const setOpen = (v: boolean) => {
		isOpen = v;
		if (v) { syncAll(); showTab(openIdx); pop.show(); } else pop.hide();
		gear.toggleClass('is-on', v);
	};
	gear.addEventListener('click', (e) => { e.stopPropagation(); setOpen(!isOpen); });
	// the popover itself must not start the chart's drag-zoom
	pop.addEventListener('mousedown', (e) => e.stopPropagation());
	syncAll();

	return { sync: syncAll, close: () => setOpen(false) };
};
