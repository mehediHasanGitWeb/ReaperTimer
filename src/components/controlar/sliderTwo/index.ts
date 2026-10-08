// "sliderTwo": composes the badges list, task summary and the (virtual) task
// list for slide 2.
//
// The task list is one VirtualList (src/ui/VirtualList.ts): only the cards that
// are on screen exist in the DOM, so the list is as fast with 10 million tasks
// as with ten. What is in it, and how it is split into sections, lives in
// ./source.ts; the numbers in the summary come from the store's counters.

import { store } from '../../../store/taskStore';
import type { ControlarHost } from '../../../types';
import { renderSliderTwoTaskSummary } from './sliderTwoTaskSummery';
import { renderSliderTwoBadgesList } from './sliderTwobadgesList';
import type { SliderTwoFilterState } from './sliderTwobadgesList';
import { VirtualList } from '../../../ui/VirtualList';
import { SliderTwoSource } from './source';
import type { SliderTwoView } from './source';

export const slideTwo = (parentContainer: HTMLElement, instance: ControlarHost) => {
	const _slideTwo = parentContainer.createDiv({ cls: 'slide-two' });
	const categoriesContainer = _slideTwo.createDiv({ cls: 'slide-two-badgesList' }).createDiv({ cls: 'slide-two-badgesList-scroll-bar' });
	const taskContainer = _slideTwo.createDiv({ cls: 'slide-two-tasks-scrollbar' });
	const summaryHost = taskContainer.createDiv({ cls: 'slide-two-tasks-summery-host' });

	const filterState: SliderTwoFilterState = { activeFilter: 'all', selectedBadgeNames: new Set<string>() };
	const view: SliderTwoView = { filter: filterState, collapsed: { donetill: false, completed: false } };

	let raf = 0;
	let unsubscribe: (() => void) | null = null;

	const source = new SliderTwoSource(view, instance, () => renderTasks());
	const list = new VirtualList(taskContainer, taskContainer, source, {
		gap: 10,
		defaultHeights: [44, 170, 44],
		overscanPx: 600,
		windowClass: 'vl-window-grid',
	});

	// Row gap follows the theme (the Paper theme spaces cards further apart).
	const syncGap = () => {
		const g = parseFloat(getComputedStyle(taskContainer).rowGap);
		if (isFinite(g)) list.setGap(g);
	};

	const renderTasks = () => {
		if (raf) { window.cancelAnimationFrame(raf); raf = 0; }
		source.rebuild();
		renderSliderTwoTaskSummary(summaryHost);
		list.refresh();
	};

	// Re-read the data whenever the store changes (coalesced to one render per frame).
	unsubscribe = store.subscribe(() => {
		if (!taskContainer.isConnected) {
			if (unsubscribe) { unsubscribe(); unsubscribe = null; }
			list.destroy();
			if (raf) { window.cancelAnimationFrame(raf); raf = 0; }
			return;
		}
		if (raf) return;
		raf = window.requestAnimationFrame(() => { raf = 0; renderTasks(); });
	});

	instance.refreshSlideTwo = () => {
		syncGap();
		renderTasks();
		renderBadges();
	};

	const syncFilterToInstance = () => {
		if (instance) {
			instance.slideTwoFilter = {
				activeFilter: filterState.activeFilter,
				selectedBadgeNames: new Set(filterState.selectedBadgeNames),
			};
		}
	};

	const refreshSlideOne = () => {
		if (instance && typeof instance.refreshSlideOne === 'function') {
			instance.refreshSlideOne();
		}
	};

	const renderBadges = () => {
		renderSliderTwoBadgesList(categoriesContainer, {
			categories: store.categoryList(),
			filterState,
			onFilterChange: () => {
				renderTasks();
				syncFilterToInstance();
				refreshSlideOne();
			},
		});
	};

	syncGap();
	renderTasks();
	renderBadges();
	syncFilterToInstance();
};
