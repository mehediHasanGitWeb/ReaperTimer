// --- Timeline per-task countdown timer helpers ---
// Ported verbatim from main.js (lines ~1126-1220).

import { state } from '../state';
import type { CategoryEntry, Task } from '../types';

// Explicit discriminated-union return type so `.type === 'clock'` narrowing
// works correctly at call sites (an inferred return type would widen the
// 'duration'/'clock' string literals and break that narrowing under strict
// mode) — a typing-only addition, not a behavior change.
export type ExpiredInfo = { type: 'duration'; minutes: number } | { type: 'clock'; hour: number; minute: number };

export const getExpiredMinutes = (task: Task | null | undefined): ExpiredInfo | null => {
	if (!task) return null;
	if (task.expiryTime != null && !isNaN(Number(task.expiryTime)) && Number(task.expiryTime) > 0) {
		return { type: 'duration', minutes: Number(task.expiryTime) };
	}
	const raw = task.expiredTime;
	if (raw == null || raw === '' || String(raw).trim().toLowerCase() === 'never') return null;
	const s = String(raw).trim().toLowerCase();
	const durMatch = s.match(/^(\d+(?:\.\d+)?)\s*(m|min|mins|minute|minutes)?$/);
	if (durMatch) {
		// durMatch[1] is the mandatory capturing group, always present on a match.
		return { type: 'duration', minutes: parseFloat(durMatch[1]!) };
	}
	const clockMatch = s.match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/);
	if (clockMatch) {
		// clockMatch[1]/[2] are mandatory capturing groups, always present on a match.
		let h = parseInt(clockMatch[1]!, 10);
		const minute = parseInt(clockMatch[2]!, 10);
		const ampm = clockMatch[3];
		if (ampm === 'pm' && h < 12) h += 12;
		if (ampm === 'am' && h === 12) h = 0;
		return { type: 'clock', hour: h, minute: minute };
	}
	return null;
};

export const getGapMinutes = (task: Task | null | undefined) => {
	if (!task) return null;
	const gap = task.gap != null && !isNaN(Number(task.gap)) ? Number(task.gap)
		: (task.gapTime != null && String(task.gapTime).trim() !== '' && !isNaN(Number(task.gapTime)) ? Number(task.gapTime) : null);
	return gap != null && gap > 0 ? gap : null;
};

export const getTimerMode = (task: Task | null | undefined) => {
	const hasExpired = getExpiredMinutes(task) != null;
	const hasGap = getGapMinutes(task) != null;
	if (hasExpired && hasGap) return 'gapCycleUntilDeadline';
	if (hasExpired) return 'expiredTimer';
	if (hasGap) return 'gapCycle';
	return 'none';
};

export const getTimerDurationSeconds = (task: Task | null | undefined, mode: string) => {
	if (mode === 'expiredTimer') {
		const e = getExpiredMinutes(task);
		if (e && e.type === 'duration') return e.minutes * 60;
		return null; // clock-time expiry counts down to the deadline instead
	}
	const gap = getGapMinutes(task);
	if (gap != null && gap > 0) return gap * 60;
	return null;
};

export const formatCountdown = (seconds: number | null | undefined) => {
	if (seconds == null || seconds <= 0) return '00:00';
	const s = Math.floor(seconds % 60);
	const m = Math.floor((seconds / 60) % 60);
	const h = Math.floor(seconds / 3600);
	const mm = String(m).padStart(2, '0');
	const ss = String(s).padStart(2, '0');
	return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};

// Fluid RGB color for the live countdown progress.
// progress = remaining / total (1 = just started, 0 = almost out of time).
// Cascades seamlessly across 4 color brackets: Purple -> Blue -> Green -> Red.
export const getColor = (progress: number) => {
	const p = Math.max(0, Math.min(1, progress));
	// Typed as fixed-length tuples so `.rgb[0/1/2]` stay non-optional under
	// noUncheckedIndexedAccess (a plain `number[]` wouldn't).
	const stops: { pos: number; rgb: [number, number, number] }[] = [
		{ pos: 1, rgb: [176, 82, 255] },
		{ pos: 2 / 3, rgb: [64, 120, 255] },
		{ pos: 1 / 3, rgb: [60, 220, 130] },
		{ pos: 0, rgb: [255, 60, 60] },
	];
	for (let i = 0; i < stops.length - 1; i++) {
		// Safe: the loop bound (i < stops.length - 1) guarantees both indices exist.
		const hi = stops[i]!;
		const lo = stops[i + 1]!;
		if (p <= hi.pos && p >= lo.pos) {
			const span = hi.pos - lo.pos;
			const t = span > 0 ? (hi.pos - p) / span : 1;
			const r = Math.round(hi.rgb[0] + (lo.rgb[0] - hi.rgb[0]) * t);
			const g = Math.round(hi.rgb[1] + (lo.rgb[1] - hi.rgb[1]) * t);
			const b = Math.round(hi.rgb[2] + (lo.rgb[2] - hi.rgb[2]) * t);
			return `rgb(${r}, ${g}, ${b})`;
		}
	}
	return 'rgb(255, 60, 60)';
};

export const getTaskCategoryColor = (task: Task | null | undefined, categoryName: string): string => {
	if (task && task.color) return task.color;
	const categories: CategoryEntry[] = state.fileData?.data?.category || state.fileData?.category || [];
	const cat = categories.find((c) => (typeof c === 'string' ? c === categoryName : c?.Name === categoryName));
	return (cat && typeof cat === 'object' && cat.color) || '#ffffff';
};
