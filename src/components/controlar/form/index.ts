// "form" component: the +Add Task form embedded in the controlar toolbar.
// Ported verbatim from main.js's `controlarEdit` (lines ~83-332).

import { state, safeSaveData } from '../../../state';
import type { ControlarHost } from '../../../types';
import { flyFormToSlideTwo } from '../index';
import { store } from '../../../store/taskStore';
import { engine } from '../../../store/timerEngine';

// Fields stay visible exactly as before (nothing is hidden/revealed) — the
// only change on typing is that the field itself switches from its resting
// "pressed in" look to a raised/"elevated" look, matching the reference
// screenshot's filled-field style. Only applies to fields the user actually
// types into (text/number/time inputs) — not the <select>s, color picker, or
// checkbox, since those aren't "typed" into.
const bindElevateOnInput = (el: HTMLInputElement) => {
	const sync = () => el.toggleClass('controlar-field-elevated', el.value.trim() !== '');
	el.addEventListener('input', sync);
	sync();
};

// Native <select> popups are rendered by the OS/browser outside the page
// (that's what the plain white "Background: ..." search-in-select list is)
// and can't be restyled with CSS in any theme. This replaces only the
// *visual* layer: the native <select> stays in the DOM (moved inside the
// wrapper, just hidden) so every existing .value read / 'change' listener /
// fillSelect() refill elsewhere in this file keeps working untouched — only
// how it's displayed and picked from changes.
const makeSearchableSelect = (select: HTMLSelectElement) => {
	const wrapper = createDiv({ cls: 'controlar-search-select' });
	select.replaceWith(wrapper);
	wrapper.appendChild(select);
	select.classList.add('controlar-native-select-hidden');

	const trigger = createDiv({ cls: 'controlar-search-select-trigger' });
	trigger.tabIndex = 0;
	wrapper.appendChild(trigger);

	const panel = createDiv({ cls: 'controlar-search-select-panel' });
	wrapper.appendChild(panel);

	const list = createDiv({ cls: 'controlar-search-select-list' });
	panel.appendChild(list);

	const updateTrigger = () => {
		const opt = select.options[select.selectedIndex];
		trigger.textContent = opt ? opt.text : '';
	};

	const closePanel = () => {
		wrapper.classList.remove('is-open');
	};

	const renderOptions = () => {
		list.replaceChildren();
		Array.from(select.options).forEach((opt) => {
			const row = createDiv({ cls: 'controlar-search-select-option' });
			row.textContent = opt.text;
			if (opt.value === select.value) row.classList.add('is-selected');
			row.addEventListener('mousedown', (evt) => {
				evt.preventDefault();
				select.value = opt.value;
				select.dispatchEvent(new Event('change', { bubbles: true }));
				updateTrigger();
				closePanel();
			});
			list.appendChild(row);
		});
	};

	const openPanel = () => {
		wrapper.classList.add('is-open');
		renderOptions();
	};

	trigger.addEventListener('click', () => {
		if (wrapper.classList.contains('is-open')) closePanel();
		else openPanel();
	});
	trigger.addEventListener('keydown', (evt: KeyboardEvent) => {
		if (evt.key === 'Escape') closePanel();
		if (evt.key === 'Enter' || evt.key === ' ') {
			evt.preventDefault();
			if (wrapper.classList.contains('is-open')) closePanel();
			else openPanel();
		}
	});
	wrapper.addEventListener('focusout', (evt: FocusEvent) => {
		const next = evt.relatedTarget as Node | null;
		if (!next || !wrapper.contains(next)) closePanel();
	});

	// Keep the trigger label (and the open list, if it's up) in sync whenever
	// options get refilled out from under us (fillSelect() on load, and again
	// after the async asset rescan below).
	const observer = new MutationObserver(() => {
		updateTrigger();
		if (wrapper.classList.contains('is-open')) renderOptions();
	});
	observer.observe(select, { childList: true });

	updateTrigger();
};

export const controlarEdit = (buttonGroup: HTMLElement, instance: ControlarHost) => {
	// Clear previous form container if it exists
	const existingForm = buttonGroup.querySelector('.controlar-btn-edit');
	if (existingForm) existingForm.remove();

	// Create wrapper container
	const formContainer = buttonGroup.createDiv({ cls: 'controlar-btn-edit' });

	// 1. Task Name Input Field
	const taskInput = formContainer.createEl('input', {
		type: 'text',
		placeholder: 'Task Name...',
		cls: 'controlar-input controlar-input-task',
	});

	bindElevateOnInput(taskInput);

	const taskNameError = formContainer.createDiv({
		cls: 'controlar-error-msg',
		text: 'Task Name is required.',
	});

	// 2. Category Selector
	const rawCategories = state.fileData?.data?.category || state.fileData?.category || [];
	const categories = rawCategories.map((c) => (typeof c === 'string' ? c : c?.Name)).filter((n): n is string => !!n);
	if (!categories.includes('Uncategorized')) {
		categories.unshift('Uncategorized');
	}
	const categorySelect = formContainer.createEl('select', { cls: 'controlar-select' });
	categories.forEach((catName: string) => {
		categorySelect.createEl('option', { text: `Category: ${catName}`, value: catName });
	});
	categorySelect.createEl('option', { text: '＋ custom category...', value: '__custom__' });

	const customCategoryInput = formContainer.createEl('input', {
		type: 'text',
		placeholder: 'New Category Name...',
		cls: 'controlar-input controlar-input-custom-category',
	});
	customCategoryInput.addClass('controlar-error-msg-hidden');
	bindElevateOnInput(customCategoryInput);

	categorySelect.addEventListener('change', () => {
		const isCustom = categorySelect.value === '__custom__';
		customCategoryInput.toggleClass('controlar-error-msg-hidden', !isCustom);
		customCategoryInput.removeClass('controlar-input-error');
		if (isCustom) customCategoryInput.focus();
	});
	makeSearchableSelect(categorySelect);

	// 3. Category / Task Color Picker Container
	const colorPickerWrapper = formContainer.createDiv({ cls: 'controlar-color-picker-wrapper' });
	colorPickerWrapper.createEl('label', { text: 'Category color: ', cls: 'controlar-color-label' });
	const categoryColorInput = colorPickerWrapper.createEl('input', {
		type: 'color',
		value: '#89b4fa',
		cls: 'controlar-color-picker',
	});

	// Alarm / Ambient Sound Selectors.
	// state.fileData's asset lists are only as fresh as the last time
	// populateAssetOptions() ran (normally once, in main.ts's onload()). If
	// files get added or removed from the asset folders while Obsidian stays
	// open, that in-memory list goes stale and the dropdowns keep offering
	// choices for files that no longer exist (or omit ones that now do).
	// Fix: render with whatever's on hand first (so opening the form isn't
	// blocked on disk I/O), then kick off a fresh rescan and refill the three
	// selects when it resolves, preserving the current pick if it's still valid.
	const extractNames = (raw: readonly (string | { Name?: string } | null | undefined)[] | undefined): string[] =>
		(raw || []).map((v) => (typeof v === 'string' ? v : v?.Name)).filter((n): n is string => !!n);

	const fillSelect = (select: HTMLSelectElement, names: string[], prefix: string) => {
		const previousValue = select.value;
		select.empty();
		names.forEach((name: string) => {
			select.createEl('option', { text: `${prefix}: ${name}`, value: name });
		});
		if (names.includes(previousValue)) select.value = previousValue;
	};

	const alarmSoundSelect = formContainer.createEl('select', { cls: 'controlar-select' });
	fillSelect(
		alarmSoundSelect,
		extractNames(state.fileData?.data?.alarmSounds || state.fileData?.alarmSounds || []),
		'Alarm'
	);
	makeSearchableSelect(alarmSoundSelect);

	const ambientSoundsSelect = formContainer.createEl('select', { cls: 'controlar-select' });
	fillSelect(
		ambientSoundsSelect,
		extractNames(state.fileData?.data?.ambientSounds || state.fileData?.ambientSounds || []),
		'Ambient'
	);
	makeSearchableSelect(ambientSoundsSelect);

	// Re-scan the asset folders now so a file added/removed since the plugin
	// last loaded is reflected here without requiring a full Obsidian reload.
	if (instance?.plugin && typeof instance.plugin.populateAssetOptions === 'function') {
		instance.plugin
			.populateAssetOptions()
			.then(() => {
				fillSelect(
					alarmSoundSelect,
					extractNames(state.fileData?.data?.alarmSounds || state.fileData?.alarmSounds || []),
					'Alarm'
				);
				fillSelect(
					ambientSoundsSelect,
					extractNames(state.fileData?.data?.ambientSounds || state.fileData?.ambientSounds || []),
					'Ambient'
				);
			})
			.catch((e: unknown) => console.error('Status Bar Plugin: failed to refresh asset dropdowns', e));
	}

	// 7. Time & Duration Inputs
	const expiryTimeInput = formContainer.createEl('input', {
		type: 'number',
		placeholder: 'Expiry Time (mins)...',
		cls: 'controlar-input',
	});

	const gapInput = formContainer.createEl('input', {
		type: 'number',
		placeholder: 'Gap (mins)...',
		cls: 'controlar-input',
	});

	bindElevateOnInput(expiryTimeInput);
	bindElevateOnInput(gapInput);

	expiryTimeInput.addEventListener('input', () => {
		expiryTimeInput.removeClass('controlar-input-error');
		gapInput.removeClass('controlar-input-error');
		expiryGapError.addClass('controlar-error-msg-hidden');
	});

	gapInput.addEventListener('input', () => {
		expiryTimeInput.removeClass('controlar-input-error');
		gapInput.removeClass('controlar-input-error');
		expiryGapError.addClass('controlar-error-msg-hidden');
	});

	const runtimeGapInput = formContainer.createEl('input', {
		type: 'number',
		placeholder: 'Runtime Gap (mins)...',
		cls: 'controlar-input',
	});

	bindElevateOnInput(runtimeGapInput);

	const timeInput = formContainer.createEl('input', {
		type: 'time',
		cls: 'controlar-input controlar-time-input',
	});

	bindElevateOnInput(timeInput);

	const expiryGapError = formContainer.createDiv({
		cls: 'controlar-error-msg controlar-error-msg-hidden',
		text: 'Fill in Expiry Time or Gap.',
	});

	// 8. Custom Color Toggle Checkbox
	const checkboxLabel = formContainer.createEl('label', { cls: 'controlar-checkbox-label' });
	const selectBox = checkboxLabel.createEl('input', { type: 'checkbox', cls: 'controlar-checkbox' });
	checkboxLabel.createSpan({ text: ' Enable Custom Color' });

	// 9. Save Task Button
	const saveBtn = formContainer.createEl('button', {
		text: 'Save task',
		cls: 'controlar-btn-submit',
	});

	// Click Event Handler
	saveBtn.addEventListener('click', () => { void (async () => {
		// One-shot burst animation (see .controlar-btn-submit-animate in
		// styles.css, themed per body.controlar-theme-*) — restart it even on
		// rapid repeat clicks by removing the class, forcing a reflow, then
		// re-adding it, and clean the class back off once it finishes.
		saveBtn.classList.remove('controlar-btn-submit-animate');
		void saveBtn.offsetWidth;
		saveBtn.classList.add('controlar-btn-submit-animate');
		saveBtn.addEventListener(
			'animationend',
			() => saveBtn.classList.remove('controlar-btn-submit-animate'),
			{ once: true }
		);

		const name = taskInput.value.trim();
		const selectedCategory = categorySelect.value;
		const customCategory = customCategoryInput.value.trim();
		const category = selectedCategory === '__custom__' ? customCategory : selectedCategory;
		const color = categoryColorInput.value;
		const alarmSound = alarmSoundSelect.value;
		const ambientSound = ambientSoundsSelect.value;
		const expiryTime = expiryTimeInput.value;
		const gap = gapInput.value;
		const runtimeGap = runtimeGapInput.value;
		const time = timeInput.value;
		const customColorEnabled = selectBox.checked;

		taskInput.removeClass('controlar-input-error');
		taskNameError.addClass('controlar-error-msg-hidden');
		expiryTimeInput.removeClass('controlar-input-error');
		gapInput.removeClass('controlar-input-error');
		expiryGapError.addClass('controlar-error-msg-hidden');

		if (!name) {
			taskInput.addClass('controlar-input-error');
			taskNameError.removeClass('controlar-error-msg-hidden');
			taskInput.focus();
			return;
		}

		if (!expiryTime && !gap) {
			expiryTimeInput.addClass('controlar-input-error');
			gapInput.addClass('controlar-input-error');
			expiryGapError.removeClass('controlar-error-msg-hidden');
			return;
		}

		if (selectedCategory === '__custom__' && !category) {
			customCategoryInput.addClass('controlar-input-error');
			customCategoryInput.focus();
			return;
		}

		const newTask = {
			id: Date.now().toString(),
			name: name,
			description: name, // Added for compatibility with renderTaskCard
			completed: false,
			category: category,
			color: color,
			alarmSound: alarmSound,
			ambientSound: ambientSound,
			expiryTime: expiryTime ? Number(expiryTime) : null,
			gap: gap ? Number(gap) : null,
			runtimeGap: runtimeGap ? Number(runtimeGap) : null,
			// Was `time || '12:00'` -- every task that didn't get a time typed
			// into the picker silently got stamped with a fake "12:00" that
			// looked like a real value everywhere it's shown (the end
			// timeline's own display code already skips the time row/badge
			// entirely when `task.time` is empty -- see the `if (task?.time)`
			// checks there -- so there's nothing else relying on this being
			// pre-filled). Leaving it as whatever was actually typed (which
			// is '' when nothing was picked) instead of inventing a value.
			time: time,
			customColor: customColorEnabled,
		};

		// New tasks go to the front of their list (same as always), through the
		// chunked store so the add stays O(1) however many tasks exist.
		engine.stampNew(newTask);
		let group = store.groupByName(category);
		if (!group) {
			group = store.createCategory(category, color);
		} else if (group.index !== 0 && group.catObj && typeof group.catObj === 'object') {
			group.catObj.color = color;
		}
		store.addToFront(group, newTask);

		// --- FIX B: Call saveData from plugin instance ---
		if (instance && instance.plugin && typeof instance.plugin.saveData === 'function') {
			await safeSaveData(instance.plugin, null);
		}

		// Detach the form from the controlar and fly it into slide 2's tasks
		// container, then re-render once it lands.
		const flyApplied = flyFormToSlideTwo(formContainer);
		const afterFlight = () => {
			// Re-render Slide Two view if available
			if (instance && typeof instance.refreshSlideTwo === 'function') {
				instance.refreshSlideTwo();
			}
			if (instance && typeof instance.refreshSlideOne === 'function') {
				instance.refreshSlideOne();
			}
		};
		if (flyApplied) {
			window.setTimeout(afterFlight, 780);
		} else {
			afterFlight();
		}

		// Reset input form for next task
		taskInput.value = '';
		expiryTimeInput.value = '';
		gapInput.value = '';
		runtimeGapInput.value = '';
		timeInput.value = '';
		selectBox.checked = false;
		customCategoryInput.value = '';
		customCategoryInput.addClass('controlar-error-msg-hidden');
		customCategoryInput.removeClass('controlar-input-error');
		categorySelect.value = 'Uncategorized';
		// .value = '' above doesn't fire the 'input' event, so the elevated
		// styling has to be cleared explicitly for each field it was bound to.
		[taskInput, customCategoryInput, expiryTimeInput, gapInput, runtimeGapInput, timeInput].forEach((el) =>
			el.removeClass('controlar-field-elevated')
		);
		taskInput.removeClass('controlar-input-error');
		taskNameError.addClass('controlar-error-msg-hidden');
		expiryTimeInput.removeClass('controlar-input-error');
		gapInput.removeClass('controlar-input-error');
		expiryGapError.addClass('controlar-error-msg-hidden');
		taskInput.focus();
	})(); });
};
