// Builds audio-pack.zip from asset/audio/alarm and asset/audio/background.
// Upload the result to the GitHub release named in src/sounds/soundPack.ts
// (SOUND_PACK_TAG) -- the plugin downloads it from there on first run.
//
//   npm run pack-audio
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { zipSync } from 'fflate';

const AUDIO = /\.(mp3|ogg|wav|m4a|flac|aac|webm)$/i;
const root = path.resolve('asset/audio');
const files = {};
let count = 0;
for (const sub of ['alarm', 'background']) {
	const dir = path.join(root, sub);
	let names = [];
	try { names = readdirSync(dir); } catch { continue; }
	for (const name of names) {
		const full = path.join(dir, name);
		if (!AUDIO.test(name) || !statSync(full).isFile()) continue;
		// level 0: audio is already compressed, so just store it
		files[`${sub}/${name}`] = [readFileSync(full), { level: 0 }];
		count++;
	}
}
if (count === 0) {
	console.error('No audio files found under asset/audio/alarm or asset/audio/background.');
	process.exit(1);
}
const zip = zipSync(files);
writeFileSync('audio-pack.zip', zip);
console.log(`audio-pack.zip: ${count} files, ${(zip.byteLength / 1048576).toFixed(1)} MB`);
