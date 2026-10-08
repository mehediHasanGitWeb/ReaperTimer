// Persistence for the TaskStore.
//
// Two on-disk layouts, chosen automatically by size:
//
//  * SINGLE (small data, the original format): everything lives in data.json
//    exactly as before -- tasks inside `category[i].Tasks` and
//    `notCategoriseTasks`. Nothing about the file changes for small vaults.
//
//  * SHARDED (more than SHARD_THRESHOLD tasks): data.json keeps all the
//    non-task settings plus a small manifest (`__taskStore`) listing the
//    chunk files; the tasks themselves live in `tasks/t<N>.json`, one file
//    per chunk. A save only rewrites the chunks that changed. Chunk files are
//    copy-on-write (a rewritten chunk gets a NEW file name; the manifest is
//    swapped in last; replaced files are deleted afterwards), so a crash at
//    any point leaves the previous manifest + its files fully intact.
//
// Saves are debounced/coalesced: many actions in quick succession cause one
// write. On unload / window close a synchronous flush makes sure nothing is
// left unwritten.

import { FileSystemAdapter, normalizePath } from 'obsidian';
import type { Plugin } from 'obsidian';
import type { PluginData } from '../types';
import { state, hooks, writeJsonAtomic } from '../state';
import { store, Chunk } from './taskStore';
import type { Task } from './taskStore';
import { computeMinDur } from './timerParams';

/** Above this many tasks the data moves from one data.json to sharded chunk files. */
export const SHARD_THRESHOLD = 8_000;
const KEY = '__taskStore';
const DIR = 'tasks';
const DEBOUNCE_MS = 600;
const MAX_WAIT_MS = 3_000;

interface ManifestChunk { f: string; n: number; d: number; m: number | null }
interface Manifest { v: 1; nextSeq: number; groups: { name: string; chunks: ManifestChunk[] }[] }

/** The parts of Node's `fs` module this file uses (desktop only). */
export interface NodeFs {
	readFileSync(path: string, encoding: 'utf8'): string;
	writeFileSync(path: string, data: string, encoding: 'utf8'): void;
	renameSync(from: string, to: string): void;
	existsSync(path: string): boolean;
	readdirSync(path: string): string[];
	unlinkSync(path: string): void;
	mkdirSync(path: string, options: { recursive: boolean }): unknown;
	promises: {
		mkdir(path: string, options: { recursive: boolean }): Promise<unknown>;
		writeFile(path: string, data: string, encoding: 'utf8'): Promise<void>;
		stat(path: string): Promise<{ size: number }>;
		rename(from: string, to: string): Promise<void>;
		unlink(path: string): Promise<void>;
	};
}

/** The parts of Node's `path` module this file uses. */
export interface NodePath {
	join(...parts: string[]): string;
}

/** data.json root as persisted, including the sharding manifest key. */
type PersistedRoot = PluginData & { [KEY]?: Manifest };

const yieldToUi = () => new Promise<void>((r) => window.setTimeout(r, 0));

/** UTF-8 byte length of a string (what the file on disk should measure). */
const utf8Length = (text: string): number => new TextEncoder().encode(text).length;

export class Persistence {
	plugin!: Plugin;
	mode: 'single' | 'sharded' = 'single';
	private fs: NodeFs | null = null;
	private path: NodePath | null = null;
	private dirAbs: string | null = null;
	private dirRel = '';
	private nextSeq = 1;
	private rootDirty = false;
	private dirtySince: number | null = null;
	private timer: number | null = null;
	private chain: Promise<void> = Promise.resolve();
	private pendingDelete: string[] = [];
	private disposed = false;
	/** number of completed saves (tests / diagnostics) */
	saves = 0;
	private lastPressure = 0;
	lastSaveMs = 0;

	// -------------------------------------------------------------- setup

	private setupFs(): void {
		this.fs = null;
		this.path = null;
		this.dirAbs = null;
		try {
			// Electron's renderer exposes Node's require on window (desktop only).
			const nodeRequire = (window as unknown as { require?: (id: string) => unknown }).require;
			if (typeof nodeRequire !== 'function') return;
			const fs = nodeRequire('fs') as NodeFs | undefined;
			const path = nodeRequire('path') as NodePath | undefined;
			const adapter = this.plugin?.app?.vault?.adapter;
			const base = adapter instanceof FileSystemAdapter ? adapter.getBasePath() : null;
			if (!fs || !path || !base) return;
			this.fs = fs;
			this.path = path;
			this.dirAbs = path.join(base, this.plugin.manifest.dir ?? '', DIR);
		} catch {
			this.fs = null;
		}
	}

	/** Test hook: use a plain directory instead of an Obsidian vault. */
	configureForTest(plugin: Plugin, fs: NodeFs, path: NodePath, dirAbs: string): void {
		this.plugin = plugin;
		this.fs = fs;
		this.path = path;
		this.dirAbs = dirAbs;
		this.dirRel = DIR;
	}

	/**
	 * Hand the freshly loaded data.json content to the store. Called once from
	 * onload() after loadData(). `raw` may be null on a brand-new install.
	 */
	async attach(plugin: Plugin, raw: unknown): Promise<PluginData> {
		this.plugin = plugin;
		this.disposed = false;
		// Node's fs/path are only loaded once the data is big enough to need sharded
		// storage (see setupFs). Small vaults never touch them, so Obsidian doesn't
		// log its "Attempting to load NodeJS package" error on every startup.
		this.dirRel = normalizePath(`${plugin.manifest.dir}/${DIR}`);
		const root: PersistedRoot = raw && typeof raw === 'object' ? (raw as PersistedRoot) : {};
		const manifest: Manifest | undefined = root[KEY];
		store.adopt(root);
		store.onDirty = () => this.schedule();
		// Memory pressure (everything resident is unsaved): write now, but not more than every 2s.
		store.onPressure = () => {
			const now = Date.now();
			if (now - this.lastPressure < 2_000) return;
			this.lastPressure = now;
			void this.flush();
		};
		if (manifest && manifest.v === 1) {
			this.mode = 'sharded';
			this.nextSeq = manifest.nextSeq || 1;
			delete root[KEY];
			await this.loadShards(manifest);
		} else {
			this.mode = 'single';
		}
		store.structureDirty = false;
		hooks.schedule = () => this.scheduleRoot();
		if (this.mode === 'sharded') {
			window.setTimeout(() => { void this.cleanupOrphans(manifest as Manifest); }, 5_000);
		}
		return root;
	}

	private async loadShards(manifest: Manifest): Promise<void> {
		store.syncStructure();
		if (!this.fs) this.setupFs();
		const lazy = !!(this.fs && this.dirAbs);
		if (lazy) {
			store.storage = { read: (file: string) => this.readChunkSync(file) };
		} else {
			store.storage = null;
		}
		const adapter = this.plugin.app.vault.adapter;
		const groups = manifest.groups || [];
		for (let gi = 0; gi < groups.length; gi++) {
			const g = store.groups[gi];
			if (!g) {
				console.warn('Status Bar Plugin: manifest lists more groups than categories exist; skipping group', gi);
				continue;
			}
			g.chunks = [];
			g.invalidate();
			for (const mc of groups[gi]!.chunks) {
				if (lazy) {
					store.addColdChunk(g, mc.f, mc.n, mc.d, mc.m);
				} else {
					// No synchronous file access (mobile): read everything now.
					try {
						const txt = await adapter.read(normalizePath(`${this.dirRel}/${mc.f}`));
						store.addLoadedChunk(g, JSON.parse(txt) as Task[], mc.f, mc.m);
					} catch (e) {
						console.error('Status Bar Plugin: could not read chunk', mc.f, e);
					}
				}
			}
		}
		store.touch();
	}

	/** Synchronous disk access (desktop), or null when only the vault adapter is available. */
	private disk(): { fs: NodeFs; path: NodePath; dir: string } | null {
		return this.fs && this.path && this.dirAbs ? { fs: this.fs, path: this.path, dir: this.dirAbs } : null;
	}

	private readChunkSync(file: string): Task[] {
		const d = this.disk();
		if (!d) return [];
		const full = d.path.join(d.dir, file);
		try {
			const txt = d.fs.readFileSync(full, 'utf8');
			const parsed: unknown = JSON.parse(txt);
			if (!Array.isArray(parsed)) throw new Error('chunk is not an array');
			return parsed as Task[];
		} catch (e) {
			console.error('Status Bar Plugin: chunk file unreadable, moving it aside:', file, e);
			try { d.fs.renameSync(full, full + '.corrupt'); } catch { /* ignore */ }
			return [];
		}
	}

	private async cleanupOrphans(manifest: Manifest): Promise<void> {
		try {
			const d = this.disk();
			if (!d || !d.fs.existsSync(d.dir)) return;
			const keep = new Set<string>();
			for (const g of store.groups) for (const c of g.chunks) if (c.file) keep.add(c.file);
			for (const g of manifest.groups) for (const c of g.chunks) keep.add(c.f);
			for (const name of d.fs.readdirSync(d.dir)) {
				if (!/^t\d+\.json(\.tmp)?$/.test(name)) continue;
				if (keep.has(name)) continue;
				try { d.fs.unlinkSync(d.path.join(d.dir, name)); } catch { /* ignore */ }
			}
		} catch (e) {
			console.warn('Status Bar Plugin: orphan chunk cleanup skipped', e);
		}
	}

	// --------------------------------------------------------- scheduling

	/** Something in data.json's own (non-task) settings changed. */
	private scheduleRoot(): void {
		this.rootDirty = true;
		this.schedule();
	}

	schedule(): void {
		if (this.disposed || !state.loadedRealData) return;
		const now = Date.now();
		if (this.dirtySince == null) this.dirtySince = now;
		if (this.timer) window.clearTimeout(this.timer);
		const wait = Math.max(0, Math.min(DEBOUNCE_MS, MAX_WAIT_MS - (now - this.dirtySince)));
		this.timer = window.setTimeout(() => { this.timer = null; void this.flush(); }, wait);
	}

	/** Write everything that changed. Resolves when the data is on disk. */
	flush(): Promise<void> {
		if (this.timer) { window.clearTimeout(this.timer); this.timer = null; }
		this.chain = this.chain.then(() => this.saveOnce()).catch((e) => {
			console.error('Status Bar Plugin: save failed', e);
		});
		return this.chain;
	}

	private needsSave(): boolean {
		return this.rootDirty || store.structureDirty || store.dirtyChunks().length > 0;
	}

	private async saveOnce(): Promise<void> {
		if (this.disposed || !state.loadedRealData) return;
		if (!this.needsSave()) return;
		const t0 = Date.now();
		this.dirtySince = null;
		this.rootDirty = false;
		if (this.mode === 'single' && store.totals().total > SHARD_THRESHOLD) {
			await this.convertToSharded();
		}
		if (this.mode === 'single') await this.writeSingle();
		else await this.writeSharded();
		this.saves++;
		this.lastSaveMs = Date.now() - t0;
		if (this.needsSave()) this.schedule();
	}

	// ------------------------------------------------------------- single

	private async writeSingle(): Promise<void> {
		const dirty = store.dirtyChunks().map((c) => [c, c.rev] as const);
		const structRev = store.structureDirty;
		const out: PersistedRoot = store.cloneForWrite((g) => store.flatten(g));
		delete out[KEY];
		const ok = await writeJsonAtomic(this.plugin, JSON.stringify(out));
		if (!ok) { this.rootDirty = true; return; }
		for (const [c, rev] of dirty) if (c.rev === rev) c.dirty = false;
		if (structRev) store.structureDirty = false;
	}

	// ------------------------------------------------------------ sharded

	private async convertToSharded(): Promise<void> {
		const adapter = this.plugin.app.vault.adapter;
		try {
			// One-time safety copy of the single-file data before it stops being the source of truth.
			const src = normalizePath(`${this.plugin.manifest.dir}/data.json`);
			const dst = normalizePath(`${this.plugin.manifest.dir}/data.json.bak-pre-shard`);
			if (typeof adapter.exists === 'function' && await adapter.exists(src) && !(await adapter.exists(dst))) {
				await adapter.copy(src, dst);
			}
		} catch (e) {
			console.warn('Status Bar Plugin: could not make pre-shard backup copy', e);
		}
		this.mode = 'sharded';
		if (!this.fs) this.setupFs();
		for (const g of store.groups) for (const c of g.chunks) { c.dirty = true; c.rev++; }
		store.storage = this.disk() ? { read: (file: string) => this.readChunkSync(file) } : null;
	}

	private async ensureDir(): Promise<void> {
		const d = this.disk();
		if (d) {
			await d.fs.promises.mkdir(d.dir, { recursive: true });
		} else {
			const adapter = this.plugin.app.vault.adapter;
			if (!(await adapter.exists(this.dirRel))) await adapter.mkdir(this.dirRel);
		}
	}

	private async writeChunkFile(name: string, serialized: string): Promise<boolean> {
		const d = this.disk();
		if (d) {
			const fin = d.path.join(d.dir, name);
			const tmp = fin + '.tmp';
			await d.fs.promises.writeFile(tmp, serialized, 'utf8');
			const st = await d.fs.promises.stat(tmp);
			if (st.size !== utf8Length(serialized)) {
				console.error('Status Bar Plugin: chunk write size mismatch, aborting save of', name);
				return false;
			}
			await d.fs.promises.rename(tmp, fin);
			return true;
		}
		const adapter = this.plugin.app.vault.adapter;
		const fin = normalizePath(`${this.dirRel}/${name}`);
		const tmp = fin + '.tmp';
		await adapter.write(tmp, serialized);
		const back = await adapter.read(tmp);
		if (back !== serialized) {
			console.error('Status Bar Plugin: chunk read-back mismatch, aborting save of', name);
			return false;
		}
		await adapter.rename(tmp, fin);
		return true;
	}

	private async deleteChunkFile(name: string): Promise<void> {
		try {
			const d = this.disk();
			if (d) await d.fs.promises.unlink(d.path.join(d.dir, name));
			else await this.plugin.app.vault.adapter.remove(normalizePath(`${this.dirRel}/${name}`));
		} catch { /* already gone */ }
	}

	private buildManifest(): Manifest | null {
		const groups: Manifest['groups'] = [];
		for (const g of store.groups) {
			const chunks: ManifestChunk[] = [];
			for (const c of g.chunks) {
				if (!c.file) return null;
				chunks.push({ f: c.file, n: c.n, d: c.done, m: c.minDur });
			}
			groups.push({ name: g.name, chunks });
		}
		return { v: 1, nextSeq: this.nextSeq, groups };
	}

	private async writeSharded(): Promise<void> {
		await this.ensureDir();
		const dirty: Chunk[] = store.dirtyChunks();
		for (const c of dirty) {
			if (this.disposed) return;
			if (!c.tasks) continue;
			const rev = c.rev;
			const serialized = JSON.stringify(c.tasks);
			const name = `t${this.nextSeq++}.json`;
			const ok = await this.writeChunkFile(name, serialized);
			if (!ok) { this.rootDirty = true; return; }
			if (c.file) this.pendingDelete.push(c.file);
			c.file = name;
			c.minDur = computeMinDur(c.tasks);
			if (c.rev === rev) c.dirty = false;
			await yieldToUi();
		}
		const manifest = this.buildManifest();
		if (!manifest) { console.error('Status Bar Plugin: manifest incomplete, skipping save'); this.rootDirty = true; return; }
		const out: PersistedRoot = store.cloneForWrite(() => []);
		out[KEY] = manifest;
		const ok = await writeJsonAtomic(this.plugin, JSON.stringify(out));
		if (!ok) { this.rootDirty = true; return; }
		store.structureDirty = false;
		const live = new Set<string>();
		for (const g of store.groups) for (const c of g.chunks) if (c.file) live.add(c.file);
		const garbage = [...this.pendingDelete, ...store.garbageFiles];
		this.pendingDelete = [];
		store.garbageFiles = [];
		for (const f of garbage) if (!live.has(f)) await this.deleteChunkFile(f);
	}

	// ----------------------------------------------------- unload / close

	/**
	 * Best-effort synchronous flush for unload / window close, where an
	 * async save would never get to finish. Needs synchronous file access
	 * (desktop); elsewhere it just starts the normal async flush.
	 */
	flushSync(): void {
		if (this.timer) { window.clearTimeout(this.timer); this.timer = null; }
		if (!state.loadedRealData || !this.needsSave()) return;
		const d = this.disk();
		if (!d) { void this.flush(); return; }
		try {
			const fs = d.fs;
			const base = d.path.join(d.dir, '..');
			const dataPath = d.path.join(base, 'data.json');
			const writeAtomic = (full: string, text: string) => {
				const tmp = full + '.tmp';
				fs.writeFileSync(tmp, text, 'utf8');
				fs.renameSync(tmp, full);
			};
			if (this.mode === 'single' && store.totals().total > SHARD_THRESHOLD) {
				// Too big to convert in a hurry -- the debounced path handles conversion; write what we can as single.
				// (Single write below is still correct, just larger.)
			}
			if (this.mode === 'single') {
				const out: PersistedRoot = store.cloneForWrite((g) => store.flatten(g));
				delete out[KEY];
				writeAtomic(dataPath, JSON.stringify(out));
				for (const c of store.dirtyChunks()) c.dirty = false;
				store.structureDirty = false;
			} else {
				fs.mkdirSync(d.dir, { recursive: true });
				const replaced: string[] = [];
				for (const c of store.dirtyChunks()) {
					if (!c.tasks) continue;
					const name = `t${this.nextSeq++}.json`;
					writeAtomic(d.path.join(d.dir, name), JSON.stringify(c.tasks));
					if (c.file) replaced.push(c.file);
					c.file = name;
					c.minDur = computeMinDur(c.tasks);
					c.dirty = false;
				}
				const manifest = this.buildManifest();
				if (!manifest) return;
				const out: PersistedRoot = store.cloneForWrite(() => []);
				out[KEY] = manifest;
				writeAtomic(dataPath, JSON.stringify(out));
				store.structureDirty = false;
				for (const f of replaced) { try { fs.unlinkSync(d.path.join(d.dir, f)); } catch { /* ignore */ } }
			}
			this.rootDirty = false;
		} catch (e) {
			console.error('Status Bar Plugin: synchronous flush failed', e);
		}
	}

	dispose(): void {
		this.flushSync();
		this.disposed = true;
		if (this.timer) { window.clearTimeout(this.timer); this.timer = null; }
		hooks.schedule = null;
		store.onDirty = null;
		store.onPressure = null;
	}
}

export const persistence = new Persistence();
