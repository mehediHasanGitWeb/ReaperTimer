// Delete a category (and its tasks) after a confirmation dialog.
// Used by the trash icon on slide two's category banners.

import { App, Modal } from 'obsidian';
import type { ControlarHost } from '../types';
import { safeSaveData } from '../state';
import { store } from '../store/taskStore';

class ConfirmDeleteCategoryModal extends Modal {
	constructor(app: App, private name: string, private taskCount: number, private onConfirm: () => void) {
		super(app);
	}
	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h3', { text: `Delete category "${this.name}"?` });
		contentEl.createEl('p', {
			text: this.taskCount > 0
				? `This will also delete its ${this.taskCount} task(s). This cannot be undone.`
				: 'This category has no tasks. This cannot be undone.',
		});
		const row = contentEl.createDiv({ cls: 'modal-button-container' });
		row.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
		row.createEl('button', { text: 'Delete', cls: 'mod-warning' }).addEventListener('click', () => { this.close(); this.onConfirm(); });
	}
	onClose() { this.contentEl.empty(); }
}

/** Ask, then remove the category named `name`. `instance` is the plugin's view instance. */
export const confirmDeleteCategory = (instance: ControlarHost | undefined, name: string): void => {
	const cat = store.categoryList().find((c) => c && typeof c === 'object' && c.Name === name);
	if (!cat) return;
	const g = store.groups.find((x) => x.catObj === cat);
	const count = g ? g.count('all') : 0;
	const run = () => {
		const list = store.categoryList();
		const idx = list.indexOf(cat);
		if (idx < 0) return;
		list.splice(idx, 1);
		const f = instance?.slideTwoFilter;
		if (f && f.selectedBadgeNames) {
			f.selectedBadgeNames.delete(name);
			if (f.selectedBadgeNames.size === 0) f.activeFilter = 'all';
		}
		store.syncStructure();
		store.touch();
		if (instance?.plugin) void safeSaveData(instance.plugin, null);
		if (typeof instance?.refreshSlideTwo === 'function') instance.refreshSlideTwo();
		if (typeof instance?.refreshSlideOne === 'function') instance.refreshSlideOne();
	};
	const app: App | undefined = instance?.plugin?.app;
	if (app) new ConfirmDeleteCategoryModal(app, name, count, run).open();
	else run();
};
