// Plugin entry point.
// Ported verbatim from main.js's `module.exports = class MyStatusBarPlugin
// extends Plugin { ... }` (lines ~2264-2538), converted to an ES module
// default export the way this project's original sample main.ts did.

import { Plugin } from 'obsidian';
import type { ControlarHost, SlideTwoFilter, TimerPlugin } from './types';
import { state, safeSaveData, recoverDataJsonIfNeeded } from './state';
import { getTimerDurationSeconds, getTimerMode, formatCountdown, getColor } from './utils/timer';
import { store } from './store/taskStore';
import { persistence } from './store/persistence';
import { engine } from './store/timerEngine';
import type { TimerEntry } from './store/timerEngine';
import { timerParams } from './store/timerParams';
import { setGlobalTask } from './utils/taskSelection';
import { visibleGroups } from './utils/filterGroups';
import { SlidingModalWithClock } from './modals/SlidingModalWithClock';
import { SIDEBAR_VIEW_TYPE, SidebarTimerView } from './sidebar/SidebarTimerView';
import { SoundPackModal } from './modals/SoundPackModal';
import { downloadSoundPack, shouldOfferSoundPack } from './sounds/soundPack';

// Note: modals/AddTaskModal.ts is a straight port of a class that was never
// instantiated anywhere in the original main.js either — it isn't wired up
// here for the same reason it wasn't wired up there.

export default class MyStatusBarPlugin extends Plugin implements TimerPlugin {
	taskTimers!: Record<string, TimerEntry>;
	statusPresetIndex!: number;
	statusPaused!: boolean;
	slideTwoFilter!: SlideTwoFilter;
	statusTimerInterval?: number | null;
	// Set externally by the controlar toolbar (components/controlar/index.ts).
	persistedThemeIndex?: number;
	// Set externally by the sidebar view (sidebar/SidebarTimerView.ts).
	_sidebarFacade?: ControlarHost | null;

	async getFolderFiles(relativePath: string): Promise<string[]> {
		try {
			const basePath = (this.manifest.dir || '') + '/' + relativePath;
			const listResult = await this.app.vault.adapter.list(basePath);
			if (!listResult || !Array.isArray(listResult.files)) return [];
			return listResult.files
				.map((f) => f.split('/').pop())
				.filter((n): n is string => !!n)
				.sort((a, b) => a.localeCompare(b));
		} catch {
			return [];
		}
	}

	// Saving is now guarded centrally by safeSaveData() / state.loadedRealData
	// (see state.ts) -- every saveData() call site in the plugin goes through
	// it, not just this one, so a failed/racing loadData() can't be wiped by
	// some unrelated save elsewhere (task selection, a slider drag, a form
	// submit, ...) either. This function no longer needs its own bespoke
	// safeToSave parameter/guard.
	async populateAssetOptions() {
		const target = state.fileData.data ? state.fileData.data : state.fileData;
		target.alarmSounds = await this.getFolderFiles('asset/audio/alarm');
		target.ambientSounds = await this.getFolderFiles('asset/audio/background');
		await safeSaveData(this, state.fileData);
	}

	async onload() {
		// Backstop for writeDataAtomic()'s remove-then-rename window in
		// state.ts: if data.json is missing/corrupt because a previous save
		// got interrupted right between removing the old file and renaming
		// the new one into place, restore it from data.json.tmp (the fully
		// written, already-validated new content) before loadData() runs.
		await recoverDataJsonIfNeeded(this);
		const rawData: unknown = await this.loadData();
		// Tracks whether this load actually produced real, saved data --
		// see safeSaveData() in state.ts, which every saveData() call site
		// in the plugin now goes through.
		state.loadedRealData = !!rawData;

		// Hand the loaded data to the task store. Everything except the task lists
		// stays in `state.fileData` exactly as before; the tasks themselves live in
		// the store's chunks (which may be read back from disk lazily).
		this.taskTimers = this.taskTimers || {};
		engine.restart();
		state.fileData = await persistence.attach(this, rawData);

		// Timer engine: derives every task's countdown, fires expired ones.
		engine.setOverrides(this.taskTimers);
		engine.getGlobal = () => state.fileData?.data?.globalTasks ?? null;
		engine.onGlobalReplaced = (_old, replacement) => {
			// A regenerated copy of the selected task takes over the selection.
			if (replacement) setGlobalTask(replacement);
		};

		// Re-link the persisted global task to its live task object so the
		// timeline can highlight it after a reload (and keep it in memory).
		const persistedGlobal = state.fileData?.data?.globalTasks;
		if (persistedGlobal?.id != null) {
			// Searching every cold chunk is only cheap for modest lists.
			const live = store.findById(persistedGlobal.id, store.totals().total <= 300_000);
			const section = state.fileData.data;
			if (live && section) section.globalTasks = live;
			store.pin(section?.globalTasks);
		}

		await this.populateAssetOptions();

		const statusBarItemEl = this.addStatusBarItem();
		// cursor / padding / radius / font / margin come from .controlar-status-bar-timer in styles.css
		statusBarItemEl.addClass('controlar-status-bar-timer');

		this.statusPresetIndex = 0;
		this.statusPaused = false;
		this.slideTwoFilter = this.slideTwoFilter || { activeFilter: 'all', selectedBadgeNames: new Set() };

		// Live remaining time (and total span) of the global task's timer
		const computeGlobalRemaining = () => {
			const globalTask = state.fileData?.data?.globalTasks;
			if (!globalTask || globalTask.completed) return null;
			// If the task was edited, a stored (paused / preset) timer that no longer matches it is reset.
			const stored: TimerEntry | undefined = this.taskTimers[globalTask.id];
			if (stored && stored.mode !== 'preset') {
				const p = timerParams(globalTask);
				if (stored.mode !== p.mode || stored.durationSeconds !== p.dur) {
					stored.mode = p.mode;
					stored.durationSeconds = p.dur;
					stored.startedAt = Date.now();
				}
			}
			const entry = engine.entryOf(globalTask);
			const mode = entry.mode;

			let remaining = null;
			let totalMs = 0;
			if (entry.paused) {
				remaining = entry.pausedRemaining != null ? entry.pausedRemaining : 0;
				totalMs = entry.pausedTotalMs || 0;
			} else if (entry.deadline != null) {
				remaining = (entry.deadline - Date.now()) / 1000;
				totalMs = entry.deadline - entry.startedAt;
			} else if (entry.durationSeconds != null && entry.durationSeconds > 0) {
				remaining = entry.durationSeconds - (Date.now() - entry.startedAt) / 1000;
				totalMs = entry.durationSeconds * 1000;
			}
			return { remaining, totalMs, entry, mode, globalTask };
		};

		// Time presets = durations (seconds) of slide one's timeline filtered tasks.
		// Looks at the first PRESET_SCAN incomplete tasks of each visible group, so it
		// stays instant however long the lists are.
		const PRESET_SCAN = 2000;
		const buildTimelinePresets = () => {
			const presets: number[] = [];
			const seenIds = new Set();
			for (const g of visibleGroups(this.slideTwoFilter)) {
				for (const task of store.range(g, 'incomplete', 0, PRESET_SCAN)) {
					if (!task || task.completed || task.isCompleted) continue;
					if (task.id != null) {
						if (seenIds.has(task.id)) continue;
						seenIds.add(task.id);
					}
					const dur = getTimerDurationSeconds(task, getTimerMode(task));
					if (dur != null && dur > 0) presets.push(dur);
				}
			}
			return presets;
		};

		const stopStatusInterval = () => {
			if (this.statusTimerInterval) {
				window.clearInterval(this.statusTimerInterval);
				this.statusTimerInterval = null;
			}
		};

		const updateStatusTimer = () => {
			const info = computeGlobalRemaining();
			if (!info) {
				statusBarItemEl.setText(this.statusPaused ? '⏸ 00:00' : '▶ 00:00');
				statusBarItemEl.style.removeProperty('background-color');
				return;
			}
			// Preset countdown finished → fall back to the global task's own timer
			if (info.remaining != null && info.remaining <= 0 && info.entry.mode === 'preset') {
				delete this.taskTimers[info.globalTask.id];
				updateStatusTimer();
				return;
			}
			const remaining = info.remaining != null ? Math.max(0, info.remaining) : 0;
			const totalSeconds = info.totalMs / 1000;
			const progress = totalSeconds > 0 ? remaining / totalSeconds : 0;
			statusBarItemEl.setText((info.entry.paused ? '⏸ ' : '▶ ') + formatCountdown(remaining));
			statusBarItemEl.style.backgroundColor = getColor(progress);
		};

		const startStatusInterval = () => {
			stopStatusInterval();
			updateStatusTimer();
			this.statusTimerInterval = window.setInterval(updateStatusTimer, 1000);
		};

		const togglePause = () => {
			const first = computeGlobalRemaining();
			if (!first) return;
			// Pausing needs the task's own stored timer entry (derived ones are read-only).
			const info = { ...first, entry: engine.materialize(first.globalTask) };
			if (info.entry.paused) {
				const rem = info.entry.pausedRemaining != null ? info.entry.pausedRemaining : 0;
				if (info.entry.deadline != null) {
					info.entry.deadline = Date.now() + rem * 1000;
				} else if (info.entry.durationSeconds != null && info.entry.durationSeconds > 0) {
					info.entry.startedAt = Date.now() - (info.entry.durationSeconds - rem) * 1000;
				}
				delete info.entry.paused;
				delete info.entry.pausedRemaining;
				delete info.entry.pausedTotalMs;
				this.statusPaused = false;
				startStatusInterval();
			} else {
				info.entry.paused = true;
				info.entry.pausedRemaining = info.remaining != null ? Math.max(0, info.remaining) : 0;
				info.entry.pausedTotalMs = info.totalMs;
				this.statusPaused = true;
				stopStatusInterval();
				updateStatusTimer();
			}
		};

		const cyclePreset = () => {
			const globalTask = state.fileData?.data?.globalTasks;
			const presets = buildTimelinePresets();
			if (!globalTask || presets.length === 0) return;
			this.statusPresetIndex = (this.statusPresetIndex || 0) + 1;
			if (this.statusPresetIndex >= presets.length) this.statusPresetIndex = 0;
			const entry = engine.materialize(globalTask);
			entry.mode = 'preset';
			entry.durationSeconds = presets[this.statusPresetIndex] ?? null;
			entry.startedAt = Date.now();
			entry.deadline = null;
			delete entry.paused;
			delete entry.pausedRemaining;
			delete entry.pausedTotalMs;
			this.statusPaused = false;
			startStatusInterval();
		};

		// Left click: pause or resume the running countdown
		statusBarItemEl.addEventListener('click', (e) => {
			e.stopPropagation();
			togglePause();
		});

		// Right click: open the slider modal
		statusBarItemEl.addEventListener('contextmenu', (e) => {
			e.preventDefault();
			e.stopPropagation();
			new SlidingModalWithClock(this.app, this).open();
		});

		// Middle / scroll-wheel click: cycle forward through the duration presets
		statusBarItemEl.addEventListener('auxclick', (e) => {
			e.preventDefault();
			e.stopPropagation();
			if (e.button === 1) cyclePreset();
		});

		startStatusInterval();

		// Timer engine loop: fires expired timers for ALL tasks (not just the ones on
		// screen). Each step is time-boxed; if more is due than fits, the rest is
		// worked off in the following short slices so the UI stays responsive.
		let engineSlice: number | null = null;
		const runEngine = () => {
			let res = { fired: 0, backlog: false };
			try {
				res = engine.tick(Date.now(), 8);
			} catch (e) {
				console.error('Status Bar Plugin: timer engine failed', e);
			}
			if (res.fired > 0) {
				store.touch();
				void safeSaveData(this, null);
			}
			if (res.backlog && !engineSlice) {
				// While lots of unsaved chunks are in memory, give the saver time to catch up first.
				const pressure = store.hotTasks > store.hotBudget * 1.5;
				if (pressure) void persistence.flush();
				engineSlice = window.setTimeout(() => { engineSlice = null; runEngine(); }, pressure ? 300 : 30);
			}
		};
		this.registerInterval(window.setInterval(runEngine, 1000));
		this.register(() => { if (engineSlice) { window.clearTimeout(engineSlice); engineSlice = null; } });

		// Make sure pending changes reach the disk when the window is closed or hidden
		// (saves are debounced, so there can be a moment of unsaved changes).
		const flushNow = () => persistence.flushSync();
		this.registerDomEvent(window, 'beforeunload', flushNow);
		this.registerDomEvent(document, 'visibilitychange', () => {
			if (document.visibilityState === 'hidden') flushNow();
		});

		// Right sidebar timer menu (works on desktop and mobile)
		this.registerView(SIDEBAR_VIEW_TYPE, (leaf) => new SidebarTimerView(leaf, this));

		// Sounds are downloaded separately (see sounds/soundPack.ts).
		this.addCommand({
			id: 'download-sound-pack',
			name: 'Download sound pack',
			callback: () => { void downloadSoundPack(this); },
		});

		this.app.workspace.onLayoutReady(() => {
			void this.openSidebarView();
			// First run without sounds: ask once whether to download them.
			void shouldOfferSoundPack(this).then((offer) => {
				if (offer) new SoundPackModal(this).open();
			});
		});

		// readData();
	}

	async openSidebarView() {
		const { workspace } = this.app;
		const existing = workspace.getLeavesOfType(SIDEBAR_VIEW_TYPE);
		if (existing.length > 0) {
			// Safe: length check above guarantees index 0 exists.
			void workspace.revealLeaf(existing[0]!);
			return;
		}
		const leaf = workspace.getRightLeaf(false) || workspace.getLeaf('tab');
		if (!leaf) return;
		await leaf.setViewState({ type: SIDEBAR_VIEW_TYPE, active: true });
		void workspace.revealLeaf(leaf);
	}

	onunload() {
		if (this.statusTimerInterval) {
			window.clearInterval(this.statusTimerInterval);
			this.statusTimerInterval = null;
		}
		// Write anything still waiting in the debounce window, then detach.
		persistence.dispose();
	}
}
