// "sliderTwobadgesList": the All / Uncategorized / per-category filter badges
// above the task list on slide 2.
// Ported verbatim from main.js's `slideTwo.renderBadges()` /
// `slideTwo.updateBadges()` / `slideTwo.setBadgeActive()` (lines ~1756-1852).
//
// NOTE on ordering: in the original, a badge click ran (in this order)
// renderTasks() -> updateBadges() -> syncFilterToInstance() -> refreshSlideOne().
// Here, `onFilterChange` (implemented by the sliderTwo orchestrator) covers
// renderTasks()+syncFilterToInstance()+refreshSlideOne(), and this module's
// own `updateBadges()` runs right after. All four operations are independent
// (none reads a result produced by another), so this reordering has no
// observable effect — it's purely a consequence of splitting the file.

import type { CategoryEntry } from '../../../../types';

// Uncategorized badge colour: vivid orange, tuned per theme in styles.css (--uncat-badge-color).
const UNCATEGORIZED_COLOR = 'var(--uncat-badge-color, #f76707)';

export interface SliderTwoFilterState {
	activeFilter: string;
	selectedBadgeNames: Set<string>;
}

export interface SliderTwoBadgesListParams {
	categories: CategoryEntry[];
	// Shared mutable object (not a copied primitive) so that badge clicks in
	// here are visible back in the sliderTwo orchestrator's own `filterState`
	// — same reasoning as `state.fileData` in src/state.ts.
	filterState: SliderTwoFilterState;
	onFilterChange: () => void;
}

export const renderSliderTwoBadgesList = (categoriesContainer: HTMLElement, params: SliderTwoBadgesListParams) => {
	const { categories, filterState } = params;
	const selectedBadgeNames = filterState.selectedBadgeNames;

	categoriesContainer.empty();

	// Old data can hold bare category names instead of objects.
	const catName = (e: CategoryEntry): string => (typeof e === 'string' ? e : e.Name);
	const catColor = (e: CategoryEntry): string | undefined => (typeof e === 'string' ? undefined : e.color);

	const setBadgeActive = (badgeEl: HTMLElement, isActive: boolean, color?: string) => {
		if (isActive) {
			// text colour of an active badge comes from .slide-two-badges.active-badge in styles.css
			badgeEl.addClass('active-badge');
			badgeEl.style.backgroundColor = color || 'var(--interactive-accent)';
		} else {
			badgeEl.removeClass('active-badge');
			badgeEl.style.removeProperty('background-color');
			badgeEl.style.color = color || '';
		}
	};

	let catBadges: HTMLElement[] = [];

	const updateBadges = () => {
		setBadgeActive(allBadge, filterState.activeFilter === 'all');
		setBadgeActive(uncatBadge, selectedBadgeNames.has('Uncategorized'), UNCATEGORIZED_COLOR);
		catBadges.forEach((badge, i) => {
			const e = categories[i];
			if (e == null) return;
			const isActive = selectedBadgeNames.has(catName(e));
			setBadgeActive(badge, isActive, catColor(e));
		});
	};

	const makeBadge = (text: string, onClick: () => void) => {
		const badge = categoriesContainer.createDiv({ text, cls: 'slide-two-badges' });
		badge.addEventListener('click', (evt: MouseEvent) => {
			evt.stopPropagation();
			onClick();
			params.onFilterChange();
			updateBadges();
		});
		return badge;
	};

	// All badge (permanent)
	const allBadge = makeBadge('All', () => {
		filterState.activeFilter = 'all';
		selectedBadgeNames.clear();
	});

	// Uncategorized badge (permanent)
	const uncatBadge = makeBadge('Uncategorized', () => {
		if (filterState.activeFilter === 'all') {
			filterState.activeFilter = 'categories';
		}
		if (selectedBadgeNames.has('Uncategorized')) {
			selectedBadgeNames.delete('Uncategorized');
		} else {
			selectedBadgeNames.add('Uncategorized');
		}
		if (selectedBadgeNames.size === 0) {
			filterState.activeFilter = 'all';
		}
	});

	uncatBadge.style.borderColor = UNCATEGORIZED_COLOR;

	// Category badges (rebuilt so new categories appear)
	catBadges = categories.map((e) => {
		const name = catName(e);
		const color = catColor(e) ?? '';
		const badge = categoriesContainer.createDiv({ text: name, cls: 'slide-two-badges' });
		badge.style.color = color;
		badge.style.borderColor = color;

		badge.addEventListener('click', (evt: MouseEvent) => {
			evt.stopPropagation();

			if (filterState.activeFilter === 'all') {
				filterState.activeFilter = 'categories';
			}
			if (selectedBadgeNames.has(name)) {
				selectedBadgeNames.delete(name);
			} else {
				selectedBadgeNames.add(name);
			}

			if (selectedBadgeNames.size === 0) {
				filterState.activeFilter = 'all';
			}

			params.onFilterChange();
			updateBadges();
		});

		return badge;
	});

	updateBadges();
};
