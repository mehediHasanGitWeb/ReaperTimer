// "controlar" root component: the top toolbar (help/theme/edit-form/nav
// buttons) plus the function that lays out the whole 3-slide layout.
// Ported verbatim from main.js (lines ~23-403 and ~1873-1906).

import { setIcon } from 'obsidian';
import type { ControlarHost, TimerPlugin } from '../../types';
import { state } from '../../state';
import { HelpModal } from '../../modals/HelpModal';
import { controlarEdit } from './form';
import { slideOne } from './sliderOne';
import { slideTwo } from './sliderTwo';
import { slideThree } from './sliderThree';
import { refreshAllVisibleCardTextHighlights } from '../../utils/crackHighlight';

export const THEMES = [
	{ name: null, label: 'Theme' },
	{ name: 'magma', label: 'Liquid Magma' },
	{ name: 'metal', label: 'Atlas Metal' },
	{ name: 'paper', label: 'Paper Crayon' },
];

export const applyControlarTheme = (plugin: TimerPlugin, index: number) => {
	const i = ((index % THEMES.length) + THEMES.length) % THEMES.length;
	// Safe: the modulo above always keeps i within THEMES' bounds.
	const theme = THEMES[i]!;
	document.body.classList.remove('controlar-theme-magma', 'controlar-theme-metal', 'controlar-theme-paper');
	if (theme.name) {
		document.body.classList.add(`controlar-theme-${theme.name}`);
	}
	plugin.persistedThemeIndex = i;
	return theme;
};

// When a task is saved, visually detach (clone) the form from the controlar
// and fly it into slide 2's tasks container before re-rendering the new task.
export const flyFormToSlideTwo = (formContainer: HTMLElement) => {
	const target = document.querySelector<HTMLElement>('.slide-two-tasks-scrollbar');
	if (!target || !formContainer) return false;

	const src = formContainer.getBoundingClientRect();
	const dst = target.getBoundingClientRect();
	if (src.width === 0 || src.height === 0 || (dst.width === 0 && dst.height === 0)) {
		return false;
	}

	const clone = formContainer.cloneNode(true) as HTMLElement;
	// position / z-index / pointer-events / margin come from .controlar-edit-fly-clone in styles.css
	clone.classList.add('controlar-edit-fly-clone');
	clone.style.left = src.left + 'px';
	clone.style.top = src.top + 'px';
	clone.style.width = src.width + 'px';
	document.body.appendChild(clone);

	void clone.offsetWidth; // force reflow so the transition starts cleanly

	const dx = (dst.left + dst.width / 2) - (src.left + src.width / 2);
	const dy = (dst.top + dst.height / 2) - (src.top + src.height / 2);
	// .is-flying turns on the transition and the fade (styles.css); the move itself is dynamic
	clone.addClass('is-flying');
	clone.style.transform = `translate(${dx}px, ${dy}px) scale(0.15)`;

	window.setTimeout(() => {
		if (clone && typeof clone.remove === 'function') clone.remove();
	}, 780);

	return true;
};

// Helper function to build top control buttons
export const controlsBtn = (parentContainer: HTMLElement, instance: ControlarHost) => {
	const buttonGroup = parentContainer.createDiv({ cls: 'controlar-btn' });

	const controlarHelp = buttonGroup.createEl('button', { text: 'Controlar help', cls: 'controlar-btn-help' });

	setIcon(controlarHelp, 'help-circle');
	controlarHelp.addEventListener('click', () => {
		new HelpModal(instance.plugin.app).open();
	});

	const controlarTheme = buttonGroup.createEl('button', { text: 'Controlar theme', cls: 'controlar-btn-theme' });
	const themePlugin = instance.plugin;
	themePlugin.persistedThemeIndex = themePlugin.persistedThemeIndex || 0;
	const syncTheme = () => {
		const theme = applyControlarTheme(themePlugin, themePlugin.persistedThemeIndex ?? 0);
		controlarTheme.setText(theme.label);
	};
	syncTheme();
	controlarTheme.addEventListener('click', () => {
		themePlugin.persistedThemeIndex = (themePlugin.persistedThemeIndex ?? 0) + 1;
		syncTheme();
		// CSS-driven chrome (background, border, drips, badge/button/
		// checkbox colors) reacts to the new body class instantly for
		// free, but each on-screen card's TEXT highlighting was computed
		// once in JS back when it was rendered -- resync it now so a card
		// that was already open doesn't keep showing the PREVIOUS theme's
		// highlight pattern/color laid over the new theme's chrome. See
		// refreshAllVisibleCardTextHighlights in crackHighlight.ts.
		refreshAllVisibleCardTextHighlights(
			document.body.classList.contains('controlar-theme-magma'),
			document.body.classList.contains('controlar-theme-metal'),
			document.body.classList.contains('controlar-theme-paper')
		);
	});

	// Integrated controlarEdit call
	controlarEdit(buttonGroup, instance);

	// Floating "+" button pinned to the modal's top-right corner (see
	// .controlar-btn-plus in styles.css). Icon-only since it's now a small
	// circular button rather than a full-width text button.
	const controlarPlus = buttonGroup.createEl('button', { cls: 'controlar-btn controlar-btn-plus' });
	setIcon(controlarPlus, 'plus');
	controlarPlus.setAttribute('aria-label', 'Controlar plus');
	// Placeholder: the "+" button has no action yet (it only logged to the console before).

	// Right Navigation Button — floats on the modal's right edge (see
	// .controlar-btn-right in styles.css).
	const rightBtn = buttonGroup.createEl('button', { cls: 'controlar-btn controlar-btn-right' });
	setIcon(rightBtn, 'chevron-right');
	rightBtn.setAttribute('aria-label', 'Next slide');
	rightBtn.addEventListener('click', () => {
		if (instance && typeof instance.goToSlide === 'function') {
			instance.goToSlide((instance.currentSlide ?? 0) + 1);
		}
	});

	// Left Navigation Button — floats on the modal's left edge (see
	// .controlar-btn-left in styles.css).
	const leftBtn = buttonGroup.createEl('button', { cls: 'controlar-btn controlar-btn-left' });
	setIcon(leftBtn, 'chevron-left');
	leftBtn.setAttribute('aria-label', 'Previous slide');
	leftBtn.addEventListener('click', () => {
		if (instance && typeof instance.goToSlide === 'function') {
			instance.goToSlide((instance.currentSlide ?? 0) - 1);
		}
	});
};

export const buildSliderLayout = (parentContainer: HTMLElement, instance: ControlarHost) => {
	parentContainer.addClass('modal-controlar');
	// The slides read tasks straight from the task store; nothing is copied up front any more.
	state.selectedTaskForTimeLine = undefined;

	const topSection = parentContainer.createDiv({ cls: 'controlar' });
	controlsBtn(topSection, instance);

	parentContainer.createEl('hr');

	const sliderWrapper = parentContainer.createDiv({ cls: 'slide-columns-wrapper' });

	// display:flex and the slide transition come from .slider-track in styles.css
	const totalSlides = instance.totalSlides ?? 3;
	const sliderTrack = sliderWrapper.createDiv({ cls: 'slider-track' });
	instance.sliderTrack = sliderTrack;
	sliderTrack.style.width = `${totalSlides * 100}%`;

	for (let i = 0; i < totalSlides; i++) {
		// flex-shrink / padding / box-sizing come from .slider-track > .slide in styles.css
		const slide = sliderTrack.createDiv({ cls: `slide slide-${i + 1}` });
		slide.style.width = `${100 / totalSlides}%`;

		if (i === 0) {
			slideOne(slide, instance);
		} else if (i === 1) {
			slideTwo(slide, instance);
		} else if (i === 2) {
			slideThree(slide, instance);
		}
	}
};
