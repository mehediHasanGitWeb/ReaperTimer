// "sliderThree": hosts the end-of-day timeline and the Gantt chart
// (moved here from slide 1's clock part).

import type { ControlarHost } from '../../../types';
import { slideOneEndTimeLine } from '../sliderOne/sliderOneClock/sliderOneClockEndTimeline';
import { slideOneGanntChart } from '../sliderOne/sliderOneClock/sliderOneClockGanttChart';

export const slideThree = (parentContainer: HTMLElement, instance: ControlarHost) => {
	const _slideThree = parentContainer.createDiv({ cls: 'slide-three' });
	// Reuse the clock-part wrapper class so the existing layout + theme styles still apply.
	// `slide-three-clock-part` stacks them vertically: Gantt chart on top, end timeline below.
	const clockEl = _slideThree.createDiv({ cls: 'slide-one-clock-part slide-three-clock-part' });
	slideOneGanntChart(clockEl, instance);
	slideOneEndTimeLine(clockEl, instance);
};
