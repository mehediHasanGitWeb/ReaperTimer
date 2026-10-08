// Ported verbatim from main.js (lines ~2109-2155).

import { App, Modal } from 'obsidian';
import type { ControlarHost, TimerEntry, TimerPlugin } from '../types';
import { buildSliderLayout } from '../components/controlar';

export class SlidingModalWithClock extends Modal implements ControlarHost {
	plugin: TimerPlugin;
	currentSlide: number;
	totalSlides: number;
	clockInterval: number | null;
	sliderTrack: HTMLElement | null;
	taskTimers: Record<string, TimerEntry>;
	timelineInterval?: number | null;
	ganntInterval?: number | null;

	constructor(app: App, plugin: TimerPlugin) {
		super(app);
		this.plugin = plugin;
		this.currentSlide = 0;
		this.totalSlides = 3;
		this.clockInterval = null;
		this.sliderTrack = null;
		this.taskTimers = plugin.taskTimers || (plugin.taskTimers = {});
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		buildSliderLayout(contentEl, this);
	}

	goToSlide(index: number) {
		if (index < 0) {
			this.currentSlide = this.totalSlides - 1;
		} else if (index >= this.totalSlides) {
			this.currentSlide = 0;
		} else {
			this.currentSlide = index;
		}

		if (this.sliderTrack) {
			const percentage = (100 / this.totalSlides) * this.currentSlide;
			this.sliderTrack.style.transform = `translateX(-${percentage}%)`;
		}
	}

	onClose() {
		if (this.clockInterval) {
			window.clearInterval(this.clockInterval);
			this.clockInterval = null;
		}

		if (this.timelineInterval) {
			window.clearInterval(this.timelineInterval);
			this.timelineInterval = null;
		}

		const { contentEl } = this;
		contentEl.empty();
	}
}
