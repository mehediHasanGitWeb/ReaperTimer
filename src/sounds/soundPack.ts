// Sound pack: the alarm / ambient sounds are not part of the plugin download.
//
// Obsidian only installs main.js, manifest.json and styles.css, so the audio
// files (~21 MB) are published separately as one zip on a GitHub release and
// downloaded the first time they are needed -- only after the user agrees.
// They are unpacked into this plugin's own folder:
//
//   <vault>/.obsidian/plugins/<plugin-id>/asset/audio/alarm/...
//   <vault>/.obsidian/plugins/<plugin-id>/asset/audio/background/...
//
// which is exactly where the plugin already looks for them (see
// populateAssetOptions in main.ts), so nothing else has to change.
//
// To publish a new pack: run `npm run pack-audio`, then upload the
// resulting audio-pack.zip to a GitHub release tagged SOUND_PACK_TAG.

import { Notice, normalizePath, requestUrl } from 'obsidian';
import type { DataAdapter } from 'obsidian';
import { unzipSync } from 'fflate';
import { state, safeSaveData } from '../state';
import type { TimerPlugin } from '../types';

/** GitHub "owner/repo" that hosts the sound pack release. */
export const SOUND_PACK_REPO = 'mehediHasanGitWeb/ReaperTimer';
/** Release tag the zip is attached to. Bump it (and re-upload) when the sounds change. */
export const SOUND_PACK_TAG = 'sound-pack-1';
/** File name of the zip on that release. */
export const SOUND_PACK_FILE = 'audio-pack.zip';
/** Rough size shown to the user before they agree to download. */
export const SOUND_PACK_SIZE_LABEL = 'about 21 MB';

export const SOUND_PACK_URL = `https://github.com/${SOUND_PACK_REPO}/releases/download/${SOUND_PACK_TAG}/${SOUND_PACK_FILE}`;

/** Refuse anything unreasonably large (protects against a wrong or tampered URL). */
const MAX_ZIP_BYTES = 80 * 1024 * 1024;
/** Only these paths are ever written: alarm/<file> or background/<file>, audio files only. */
const ALLOWED_ENTRY = /^(alarm|background)\/([^/\\]+\.(?:mp3|ogg|wav|m4a|flac|aac|webm))$/i;

const AUDIO_DIR = 'asset/audio';
const SUBFOLDERS = ['alarm', 'background'] as const;
/** Written after a successful install; holds the tag so a newer pack can be detected. */
const MARKER_FILE = '.sound-pack';

interface SoundPackState {
	/** user chose "Not now" -- don't ask again on startup (the command still works) */
	declined?: boolean;
	/** tag of the pack that was installed */
	installed?: string;
}

const pluginDir = (plugin: TimerPlugin): string => plugin.manifest.dir ?? `.obsidian/plugins/${plugin.manifest.id}`;
const audioPath = (plugin: TimerPlugin, ...parts: string[]): string =>
	normalizePath([pluginDir(plugin), AUDIO_DIR, ...parts].join('/'));

/** Where the sound-pack choice is remembered (same place as the other settings in data.json). */
const packState = (): SoundPackState => {
	const host = state.fileData.data ?? state.fileData;
	const current = host.soundPack;
	if (current && typeof current === 'object') return current;
	const fresh: SoundPackState = {};
	host.soundPack = fresh;
	return fresh;
};

const countFiles = async (adapter: DataAdapter, dir: string): Promise<number> => {
	try {
		if (!(await adapter.exists(dir))) return 0;
		const listed = await adapter.list(dir);
		return listed.files.length;
	} catch {
		return 0;
	}
};

/** True when any sounds are already in place (installed pack, or files copied in by hand). */
export const hasSounds = async (plugin: TimerPlugin): Promise<boolean> => {
	const adapter = plugin.app.vault.adapter;
	for (const sub of SUBFOLDERS) {
		if ((await countFiles(adapter, audioPath(plugin, sub))) > 0) return true;
	}
	return false;
};

const ensureFolder = async (adapter: DataAdapter, dir: string): Promise<void> => {
	if (await adapter.exists(dir)) return;
	// mkdir in Obsidian's adapter creates missing parents as needed
	await adapter.mkdir(dir);
};

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
	bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

let downloading = false;

/**
 * Download the zip, unpack the audio files into the plugin folder and refresh
 * the sound lists. Returns the number of files written (0 on failure).
 */
export const downloadSoundPack = async (plugin: TimerPlugin): Promise<number> => {
	if (downloading) {
		new Notice('The sound pack is already downloading.');
		return 0;
	}
	downloading = true;
	const progress = new Notice(`Downloading sound pack (${SOUND_PACK_SIZE_LABEL})…`, 0);
	try {
		const res = await requestUrl({ url: SOUND_PACK_URL, method: 'GET', throw: false });
		if (res.status !== 200) {
			throw new Error(`the server answered with status ${res.status}`);
		}
		const zipBytes = new Uint8Array(res.arrayBuffer);
		if (zipBytes.byteLength === 0 || zipBytes.byteLength > MAX_ZIP_BYTES) {
			throw new Error(`unexpected download size (${zipBytes.byteLength} bytes)`);
		}

		progress.setMessage('Unpacking sounds…');
		// Only unpack the entries we would actually write.
		const entries = unzipSync(zipBytes, { filter: (file) => ALLOWED_ENTRY.test(file.name) });

		const adapter = plugin.app.vault.adapter;
		for (const sub of SUBFOLDERS) await ensureFolder(adapter, audioPath(plugin, sub));

		let written = 0;
		for (const [name, data] of Object.entries(entries)) {
			const m = ALLOWED_ENTRY.exec(name);
			if (!m || !m[1] || !m[2]) continue;
			await adapter.writeBinary(audioPath(plugin, m[1].toLowerCase(), m[2]), toArrayBuffer(data));
			written++;
		}
		if (written === 0) throw new Error('the download did not contain any sounds');

		await adapter.write(audioPath(plugin, MARKER_FILE), SOUND_PACK_TAG);
		const ps = packState();
		ps.installed = SOUND_PACK_TAG;
		ps.declined = false;

		// Re-read the folders so the dropdowns offer the new sounds right away.
		await plugin.populateAssetOptions();
		await safeSaveData(plugin, state.fileData);

		progress.hide();
		new Notice(`Sound pack installed (${written} sounds).`);
		return written;
	} catch (e) {
		progress.hide();
		console.error('Sound pack download failed', e);
		new Notice(`Could not download the sound pack: ${e instanceof Error ? e.message : String(e)}`);
		return 0;
	} finally {
		downloading = false;
	}
};

/** Remember that the user said "Not now" so startup doesn't keep asking. */
export const declineSoundPack = async (plugin: TimerPlugin): Promise<void> => {
	packState().declined = true;
	await safeSaveData(plugin, state.fileData);
};

/** Should the "download sounds?" question be shown at startup? */
export const shouldOfferSoundPack = async (plugin: TimerPlugin): Promise<boolean> => {
	const ps = packState();
	if (ps.declined) return false;
	return !(await hasSounds(plugin));
};
