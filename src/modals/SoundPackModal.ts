// Asks before downloading the sound pack (Obsidian's developer policies
// require network use to be disclosed and agreed to, not done silently).

import { Modal } from 'obsidian';
import type { TimerPlugin } from '../types';
import { SOUND_PACK_REPO, SOUND_PACK_SIZE_LABEL, declineSoundPack, downloadSoundPack } from '../sounds/soundPack';

export class SoundPackModal extends Modal {
	constructor(private readonly plugin: TimerPlugin) {
		super(plugin.app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		this.setTitle('Download alarm and ambient sounds?');

		contentEl.createEl('p', {
			text: `The alarm and ambient sounds are not included in the plugin install. `
				+ `They can be downloaded once (${SOUND_PACK_SIZE_LABEL}) from the plugin's GitHub page `
				+ `(github.com/${SOUND_PACK_REPO}) and are saved inside the plugin's own folder.`,
		});
		contentEl.createEl('p', {
			text: 'Nothing else is downloaded or sent. You can do this later from the command palette: Download sound pack.',
		});

		const row = contentEl.createDiv({ cls: 'modal-button-container' });
		row.createEl('button', { text: 'Not now' }).addEventListener('click', () => {
			this.close();
			void declineSoundPack(this.plugin);
		});
		row.createEl('button', { text: 'Download', cls: 'mod-cta' }).addEventListener('click', () => {
			this.close();
			void downloadSoundPack(this.plugin);
		});
	}

	onClose() {
		this.contentEl.empty();
	}
}
