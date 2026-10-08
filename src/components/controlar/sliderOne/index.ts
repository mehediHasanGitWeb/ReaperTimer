// "sliderOne": composes the clock part and the timeline for slide 1.
// Ported verbatim from main.js's `slideOne` (lines ~1506-1510).

import type { ControlarHost } from '../../../types';
import { slideOneClockpart } from './sliderOneClock';
import { slideOneTimeLine } from './sliderOneTimeline';

export const slideOne = (parentContainer: HTMLElement, instance: ControlarHost) => {
	const _slideOne = parentContainer.createDiv({ cls: 'slide-one' });
	slideOneClockpart(_slideOne, instance);
	slideOneTimeLine(_slideOne, instance);
};
