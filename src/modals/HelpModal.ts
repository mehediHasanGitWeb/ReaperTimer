// --- HELP MODAL COMPONENT ---
// Ported verbatim from main.js (lines ~1913-1950).

import { App, Modal } from 'obsidian';

export class HelpModal extends Modal {
	constructor(app: App) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('pomodoro-help-modal');

		contentEl.createEl('h2', { text: 'Pomodoro plugin guide', cls: 'pomodoro-help-title' });

		const helpContainer = contentEl.createDiv({ cls: 'pomodoro-help-accordion-list' });

		const item1 = helpContainer.createEl('details', { cls: 'pomodoro-help-item' });
		item1.createEl('summary', { text: '📌 Overview & dashboard' });
		const body1 = item1.createDiv({ cls: 'pomodoro-help-content' });
		body1.createEl('p', { text: 'Use the top action bar to toggle options or navigate across 3 slides containing your analytics, running timers, and workflow history.' });

		const item2 = helpContainer.createEl('details', { cls: 'pomodoro-help-item' });
		item2.createEl('summary', { text: '⚡ Mouse shortcuts' });
		const body2 = item2.createDiv({ cls: 'pomodoro-help-content' });
		const list2 = body2.createEl('ul');
		list2.createEl('li', { text: 'Left click (status bar): Pause or resume the running countdown.' });
		list2.createEl('li', { text: 'Right click (status bar): Open main dashboard modal.' });
		list2.createEl('li', { text: 'Middle click (status bar): Cycle forward through duration presets.' });

		const item3 = helpContainer.createEl('details', { cls: 'pomodoro-help-item' });
		item3.createEl('summary', { text: '⏱ Live timers and timeline charts' });
		const body3 = item3.createDiv({ cls: 'pomodoro-help-content' });
		body3.createEl('p', { text: 'The timeline charts update in real time every second to track active categories and interval runtimes.' });
	}

	onClose() {
		this.contentEl.empty();
	}
}
