// Shared mutable plugin state.
//
// The original main.js kept these as bare module-level `const`/`let`
// bindings. Splitting the file into ES modules means plain `let` exports
// can't be reassigned from other files, so everything that used to be
// reassigned (fileData, selectedTaskForTimeLine) now lives as a property on
// this single exported `state` object instead. Every component imports
// `state` and reads/writes `state.fileData` / `state.selectedTaskForTimeLine`
// instead of the old bare variable names.

import { normalizePath } from 'obsidian';
import type { Plugin } from 'obsidian';
import type { PluginData, Task } from './types';

export interface PluginState {
	fileData: PluginData;
	selectedTaskIds: Set<string>;
	selectedTaskForTimeLine: Task[] | undefined;
	// True once onload() has confirmed loadData() actually returned real,
	// previously-saved data (not just the in-memory {} default). Every
	// saveData() call in the plugin must check this first -- see
	// safeSaveData() below. Before this flag existed, only ONE of the six
	// call sites that persist state.fileData actually guarded against
	// saving over a load that silently failed (a corrupt/truncated
	// data.json, or a reload racing an in-progress write); the other five
	// (task selection, slider drag, form save, AddTaskModal, ...) would
	// happily write the near-empty in-memory state straight over a good
	// data.json the moment the user touched anything, permanently wiping
	// real saved tasks. That is what actually happened during this
	// project's development.
	loadedRealData: boolean;
}

// Global state for selected tasks and categories
export const state: PluginState = {
	fileData: {},
	selectedTaskIds: new Set<string>(),
	selectedTaskForTimeLine: undefined,
	loadedRealData: false,
};

// Single choke point for every saveData() call in the plugin. Skips the
// write (and warns) whenever state.loadedRealData is false, so a failed or
// racing loadData() can never result in some OTHER, unrelated user action
// (selecting a task, dragging a slider, saving a form) clobbering a good
// data.json with the near-empty in-memory default. Once a load genuinely
// succeeds (main.ts's onload() sets loadedRealData = true), saves proceed
// normally for the rest of the session.
//
// The write itself goes through writeDataAtomic() below instead of the
// plugin API's own saveData() -- see that function's comment for why: a
// plain saveData() (a single non-atomic adapter.write() straight over the
// real data.json) is what let data.json end up truncated mid-write in the
// first place, more than once, always stalling around the same ~512KB
// mark. This never overwrites the real file with anything that hasn't
// first been written elsewhere and read back byte-for-byte intact.
// Chains every writeDataAtomic() call through one shared promise so at
// most one is ever in flight. Without this, two of the (several, often
// un-awaited) safeSaveData() call sites firing close together -- a
// timeline drag tick, a task-card click, a modal save -- can race on the
// single shared data.json.tmp path: call A's adapter.rename(tmp ->
// data.json) can complete an instant before call B's own
// adapter.read(tmp) runs, which then throws ENOENT because the very file
// B just wrote was already moved out from under it by A. That's a benign
// race (the real data.json is never touched when this happens, and one of
// the two saves always succeeds), but it logs a scary-looking aborted-save
// error for no real reason. Serializing removes the race entirely.
// Hooks installed by store/persistence.ts. Saves are no longer written
// inline: safeSaveData() just tells the persistence layer "something changed"
// and the actual write happens debounced/coalesced a moment later (and only
// rewrites the task chunks that actually changed). Before this, EVERY click
// serialized and rewrote the entire data file synchronously, which is what
// made saves take longer and longer as the task list grew.
export const hooks: {
	schedule: (() => void) | null;
} = { schedule: null };

// Chains every writeJsonAtomic() call through one shared promise so at
// most one is ever in flight (see the long comment further down about the
// data.json.tmp race this avoids).
let saveChain: Promise<void> = Promise.resolve();

export const safeSaveData = async (plugin: Plugin, data: unknown): Promise<void> => {
	if (!state.loadedRealData) {
		console.warn(
			'Status Bar Plugin: skipping saveData() -- this session never confirmed a real '
			+ 'loadData() read (data.json may be missing, empty, or failed to parse), so '
			+ 'writing now would overwrite it with near-empty in-memory state and permanently '
			+ 'destroy any existing saved tasks. Reload once data.json is readable again.'
		);
		return;
	}
	if (hooks.schedule) {
		hooks.schedule();
		return;
	}
	// Persistence layer not attached (should not happen after onload): old direct path.
	const serialized = JSON.stringify(data);
	await writeJsonAtomic(plugin, serialized);
};

/** Serialized write of data.json that never leaves a half-written file (see the long comment below). */
export const writeJsonAtomic = (plugin: Plugin, serialized: string): Promise<boolean> => {
	let ok = false;
	const run = async (): Promise<void> => { ok = await writeDataAtomic(plugin, serialized); };
	saveChain = saveChain.then(run, run);
	return saveChain.then(() => ok);
};

// Writes data.json without ever leaving the real file in a half-written
// state, whatever interrupts the write (a crash, antivirus/backup software
// grabbing the file mid-write, the app closing, a flaky network drive,
// etc.):
//   1. Serialize once, write that exact string to a sibling *.tmp file.
//   2. Read the *.tmp file back and compare it byte-for-byte against what
//      was meant to be written, and confirm it's valid JSON. A write that
//      got cut short (like the ~512KB stalls seen during development) is
//      caught right here, on the *.tmp file -- never on data.json itself.
//   3. Only once that's confirmed does the real data.json get replaced,
//      via remove()+rename() so the swap itself is a single filesystem
//      rename rather than a second in-place write.
// Any failure at any step leaves the existing data.json completely
// untouched and logs why, the same way the loadedRealData guard above
// already fails safe rather than risking a bad write.
const writeDataAtomic = async (plugin: Plugin, serialized: string, retried = false): Promise<boolean> => {
	const adapter = plugin.app?.vault?.adapter;
	if (!adapter) {
		console.error('Status Bar Plugin: no vault adapter available, cannot save data.json.');
		return false;
	}

	const dataPath = normalizePath(`${plugin.manifest.dir}/data.json`);
	const tmpPath = normalizePath(`${plugin.manifest.dir}/data.json.tmp`);

	try {
		await adapter.write(tmpPath, serialized);

		const readBack = await adapter.read(tmpPath);
		if (readBack !== serialized) {
			console.error(
				'Status Bar Plugin: aborting save -- data.json.tmp did not read back identical '
				+ `to what was written (wrote ${serialized.length} chars, read back `
				+ `${readBack.length}). The real data.json was left untouched; `
				+ 'data.json.tmp was left in place for inspection.'
			);
			return false;
		}
		try {
			JSON.parse(readBack);
		} catch (parseErr) {
			console.error(
				'Status Bar Plugin: aborting save -- data.json.tmp did not parse as valid JSON '
				+ 'after being written and read back. The real data.json was left untouched; '
				+ 'data.json.tmp was left in place for inspection.',
				parseErr
			);
			return false;
		}

		// Obsidian's adapter.rename() refuses to replace an existing
		// destination file (it throws 'Destination file already exists!'
		// rather than overwriting, unlike a raw filesystem rename) -- so
		// dataPath has to be removed first. That does leave a brief window
		// where neither file has the canonical name if the process is
		// interrupted between the two calls; this is now backstopped by
		// recoverDataJsonIfNeeded() below, which runs on every plugin load
		// and automatically restores data.json from data.json.tmp if exactly
		// that interruption happens, so it can no longer cause real data
		// loss even though the write itself still isn't fully atomic.
		try {
			if (await adapter.exists(dataPath)) {
				await adapter.remove(dataPath);
			}
			await adapter.rename(tmpPath, dataPath);
		} catch (renameErr) {
			// ENOENT here means data.json.tmp vanished between the write and the
			// rename -- another writer (e.g. the synchronous flush on unload /
			// hot-reload) used the same tmp path and already renamed it. Write
			// once more so the newest content is what ends up on disk.
			if (!(renameErr && (renameErr as { code?: string }).code === 'ENOENT') || retried) throw renameErr;
			return await writeDataAtomic(plugin, serialized, true);
		}
		return true;
	} catch (err) {
		console.error(
			'Status Bar Plugin: aborting save -- writing data.json.tmp failed. The real '
			+ 'data.json was left untouched.',
			err
		);
		return false;
	}
};

// Self-healing check run once at plugin startup, BEFORE this.loadData() is
// called. writeDataAtomic() above has to remove() the old data.json before
// rename()-ing the new one into place (Obsidian's adapter.rename() refuses
// to overwrite an existing destination file), which leaves a brief window
// where data.json doesn't exist yet. If the plugin process is interrupted
// during exactly that window (e.g. a hot-reload triggered by a main.js
// redeploy landing mid-save), data.json is left missing while
// data.json.tmp -- the fully-written, already-validated new content --
// is still sitting right there. This function detects that situation and
// automatically restores data.json from data.json.tmp, so the interruption
// window above can no longer cause real, user-visible data loss. It's
// deliberately conservative: it only ever recovers FROM the tmp file INTO
// a missing/corrupt data.json, and only when the tmp file itself parses as
// valid, non-empty JSON; it never touches a data.json that is already
// present and readable.
export const recoverDataJsonIfNeeded = async (plugin: Plugin): Promise<void> => {
	const adapter = plugin.app?.vault?.adapter;
	if (!adapter) return;

	const dataPath = normalizePath(`${plugin.manifest.dir}/data.json`);
	const tmpPath = normalizePath(`${plugin.manifest.dir}/data.json.tmp`);

	// If data.json already exists and reads back as valid, non-empty JSON,
	// there is nothing to recover -- leave everything untouched.
	try {
		if (await adapter.exists(dataPath)) {
			const existing = await adapter.read(dataPath);
			if (existing && existing.trim().length > 0) {
				JSON.parse(existing);
				return;
			}
		}
	} catch (err) {
		console.warn(
			'Status Bar Plugin: data.json exists but failed to read/parse at startup; '
			+ 'checking data.json.tmp for a recoverable copy.',
			err
		);
	}

	// data.json is missing, empty, or corrupt. Only recover if
	// data.json.tmp is present AND itself parses as valid, non-empty JSON
	// -- never overwrite anything with data we can't verify.
	try {
		if (!(await adapter.exists(tmpPath))) return;
		const tmpContent = await adapter.read(tmpPath);
		if (!tmpContent || tmpContent.trim().length === 0) return;
		JSON.parse(tmpContent);

		await adapter.write(dataPath, tmpContent);
		console.warn(
			'Status Bar Plugin: data.json was missing or unreadable at startup -- '
			+ 'automatically recovered it from data.json.tmp (a validated save that had '
			+ 'not finished being renamed into place). No data should have been lost.'
		);
	} catch (err) {
		console.error(
			'Status Bar Plugin: data.json was missing or unreadable at startup, and '
			+ 'automatic recovery from data.json.tmp also failed (it may be missing, '
			+ 'empty, or corrupt too). Manual recovery from data.json.tmp may be needed.',
			err
		);
	}
};

export const PLACE_ID = Object.freeze({
	SILDE_TWO_COMPLPET_TASKS: Symbol('SILDE_TWO_COMPLPET_TASKS'),
	SILDE_TWO_NOT_COMPLPET_TASKS: Symbol('SILDE_TWO_NOT_COMPLPET_TASKS'),
	SILDE_ONE_TIME_LINE: Symbol('SILDE_ONE_TIME_LINE'),
});
