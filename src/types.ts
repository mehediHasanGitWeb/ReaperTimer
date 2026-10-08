// Shared data types for the plugin.
//
// Everything that used to be typed `any` (tasks, categories, the data.json
// root, the dashboard/sidebar "instance" object and the plugin itself) is
// described here once, so every module can be type-checked against the same
// shapes. These are descriptions of the existing data -- nothing about the
// saved format changes.

import type { Plugin } from 'obsidian';

/** Symbol key for the cached timer parameters on a task (never serialized by JSON.stringify). */
export const TP: unique symbol = Symbol('timerParams');

export interface TimerParams {
	mode: string;
	/** countdown length in seconds; null for "no timer" and for clock-time expiry (counts down to a deadline instead) */
	dur: number | null;
}

/** A single task, exactly as stored in data.json (all fields but `id` are optional in old data). */
export interface Task {
	id: string;
	name?: string;
	/** legacy display names used by some older data */
	title?: string;
	Name?: string;
	description?: string;
	completed?: boolean;
	/** legacy spelling of `completed` found in some older data */
	isCompleted?: boolean;
	category?: string;
	categoryName?: string;
	color?: string;
	customColor?: boolean;
	background?: string;
	alarmSound?: string;
	ambientSound?: string;
	/** minutes until the task expires */
	expiryTime?: number | string | null;
	/** legacy free-text expiry ("30m", "10:00 pm", "never") */
	expiredTime?: number | string | null;
	/** minutes between repeats */
	gap?: number | string | null;
	/** legacy spelling of `gap` */
	gapTime?: number | string | null;
	runtimeGap?: number | string | null;
	/** "HH:MM" time-of-day the task was scheduled for (or a timestamp string) */
	time?: string;
	date?: string;
	/** fields written by the old stand-alone "Add task" dialog (still shown on cards if present) */
	endDate?: string;
	selectedBgImage?: string;
	selectedAmbientSound?: string;
	selectedAlarmSound?: string;
	runtimeSeconds?: number | null;
	/** persistent "stop cycling at" epoch ms for gap-cycle-until-deadline tasks */
	timerDeadline?: number | null;
	/** epoch ms the task's timer started (only trusted when `_s` matches the current session) */
	_t0?: number;
	/** session id that wrote `_t0` */
	_s?: string;
	[TP]?: TimerParams;
}

/** Property names that hold a task array on a category or on the data root. */
export type TaskListKey = 'Tasks' | 'tasks' | 'notCategoriseTasks' | 'notCategoriseTasksInComplete';

export type TaskHolder = Partial<Record<TaskListKey, Task[]>>;

export interface Category extends TaskHolder {
	Name: string;
	color?: string;
	id?: string;
	categoryName?: string;
	selected?: boolean;
}

/** Old data can contain bare category names instead of objects. */
export type CategoryEntry = Category | string;

/** The settings/task section of data.json (found either at the root or under `data`). */
export interface DataSection extends TaskHolder {
	category?: CategoryEntry[];
	globalTasks?: Task | null;
	alarmSounds?: string[];
	ambientSounds?: string[];
	backgrounds?: string[];
	ganttSettings?: Record<string, unknown>;
	/** sound-pack download choice (see sounds/soundPack.ts) */
	soundPack?: { declined?: boolean; installed?: string };
	[key: string]: unknown;
}

/** The whole object loaded from / saved to data.json. */
export interface PluginData extends DataSection {
	data?: DataSection;
}

/** Slide two's category filter (shared with the status-bar presets and the timeline). */
export interface SlideTwoFilter {
	activeFilter: string;
	selectedBadgeNames: Set<string>;
}

/** A user-adjustable timer entry (pause / presets) for the global task. */
export interface TimerEntry {
	startedAt: number;
	durationSeconds: number | null;
	mode: string;
	deadline?: number | null;
	paused?: boolean;
	pausedRemaining?: number;
	pausedTotalMs?: number;
}

/** What the plugin class exposes to the rest of the code. */
export interface TimerPlugin extends Plugin {
	taskTimers: Record<string, TimerEntry>;
	slideTwoFilter: SlideTwoFilter;
	persistedThemeIndex?: number;
	_sidebarFacade?: ControlarHost | null;
	populateAssetOptions(): Promise<void>;
}

/**
 * The object every dashboard component receives: the slider modal, or the
 * lightweight stand-in the sidebar view builds. Components hang their
 * refresh callbacks and interval ids on it.
 */
export interface ControlarHost {
	plugin: TimerPlugin;
	taskTimers: Record<string, TimerEntry>;
	slideTwoFilter?: SlideTwoFilter;
	currentSlide?: number;
	totalSlides?: number;
	goToSlide?: (index: number) => void;
	sliderTrack?: HTMLElement | null;
	clockInterval?: number | null;
	timelineInterval?: number | null;
	ganntInterval?: number | null;
	ganttToken?: number;
	refreshSlideOne?: () => void;
	refreshSlideTwo?: () => void;
	refreshEndTimeLine?: () => void;
}
