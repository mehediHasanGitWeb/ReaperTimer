// --- RIGHT SIDEBAR TIMER MENU VIEW ---
// Ported verbatim from main.js (lines ~2157-2261).

import { ItemView, WorkspaceLeaf } from 'obsidian';
import type { ControlarHost, TimerPlugin } from '../types';
import { SlidingModalWithClock } from '../modals/SlidingModalWithClock';
import { slideOneClock } from '../components/controlar/sliderOne/sliderOneClock/sliderOneClockGlobalClock';
import { slideOneTimeLine } from '../components/controlar/sliderOne/sliderOneTimeline';

export const SIDEBAR_VIEW_TYPE = 'timer-sidebar-view';

export const renderSidebarMenu = (rootEl: HTMLElement, plugin: TimerPlugin): ControlarHost => {
	if (plugin._sidebarFacade) {
		const old = plugin._sidebarFacade;
		if (old.clockInterval) window.clearInterval(old.clockInterval);
		if (old.timelineInterval) window.clearInterval(old.timelineInterval);
		if (old.ganntInterval) window.clearInterval(old.ganntInterval);
	}

	rootEl.empty();
	rootEl.addClass('controlar-sidebar-view');

	const facade: ControlarHost = {
		plugin: plugin,
		taskTimers: plugin.taskTimers || (plugin.taskTimers = {}),
		slideTwoFilter: { activeFilter: 'all', selectedBadgeNames: new Set() },
		refreshSlideTwo: () => {},
	};
	plugin._sidebarFacade = facade;

	const clockWrap = rootEl.createDiv({ cls: 'controlar-sidebar-section controlar-sidebar-clock' });
	slideOneClock(clockWrap, facade);

	const timelineWrap = rootEl.createDiv({ cls: 'controlar-sidebar-section controlar-sidebar-timeline' });
	slideOneTimeLine(timelineWrap, facade);

	return facade;
};

export class SidebarTimerView extends ItemView {
	pluginInstance: TimerPlugin;
	_lpX?: number;
	_lpY?: number;
	_lpTimer?: number | null;

	constructor(leaf: WorkspaceLeaf, pluginInstance: TimerPlugin) {
		super(leaf);
		this.pluginInstance = pluginInstance;
	}

	getViewType() {
		return SIDEBAR_VIEW_TYPE;
	}

	getDisplayText() {
		return 'Timer menu';
	}

	getIcon() {
		return 'timer';
	}

	async onOpen() {
		renderSidebarMenu(this.contentEl, this.pluginInstance);
		const el = this.contentEl;
		const openModal = () => {
			new SlidingModalWithClock(this.pluginInstance.app, this.pluginInstance).open();
		};
		if (!el.dataset.menuListeners) {
			el.dataset.menuListeners = '1';
			el.addEventListener('dblclick', (e) => {
				e.preventDefault();
				openModal();
			});
			el.addEventListener('pointerdown', (e) => {
				if (e.button !== 0) return;
				this._lpX = e.clientX;
				this._lpY = e.clientY;
				if (this._lpTimer) window.clearTimeout(this._lpTimer);
				this._lpTimer = window.setTimeout(() => {
					this._lpTimer = null;
					openModal();
				}, 600);
			});
			el.addEventListener('pointermove', (e) => {
				if (this._lpTimer && (Math.abs(e.clientX - (this._lpX ?? 0)) > 10 || Math.abs(e.clientY - (this._lpY ?? 0)) > 10)) {
					window.clearTimeout(this._lpTimer);
					this._lpTimer = null;
				}
			});
			const cancelLongPress = () => {
				if (this._lpTimer) {
					window.clearTimeout(this._lpTimer);
					this._lpTimer = null;
				}
			};
			el.addEventListener('pointerup', cancelLongPress);
			el.addEventListener('pointerleave', cancelLongPress);
			el.addEventListener('pointercancel', cancelLongPress);
			el.addEventListener('contextmenu', (e) => e.preventDefault());
		}
	}

	async onClose() {
		const facade = this.pluginInstance._sidebarFacade;
		if (facade) {
			if (facade.clockInterval) window.clearInterval(facade.clockInterval);
			if (facade.timelineInterval) window.clearInterval(facade.timelineInterval);
			if (facade.ganntInterval) window.clearInterval(facade.ganntInterval);
		}
		if (this._lpTimer) {
			window.clearTimeout(this._lpTimer);
			this._lpTimer = null;
		}
		this.pluginInstance._sidebarFacade = null;
	}
}
