// "sliderOneClock": the global clock for slide 1.
// (The end-timeline and Gantt chart now live on slide 3 — see ../../sliderThree.)

import type { ControlarHost } from '../../../../types';
import { slideOneClock } from './sliderOneClockGlobalClock';

export const slideOneClockpart = (parentContainer: HTMLElement, instance: ControlarHost) => {
	const clockEl = parentContainer.createDiv({ cls: 'slide-one-clock-part' });
	slideOneClock(clockEl, instance);
};
