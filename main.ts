// SOLMAR CITY — make.fun gta6-01 entrypoint (Node 22, no build, no install).
// Copies game/ and screenshots/ next to this file into the output dir, then
// writes /output/dossier.json via the kit's buildDossier (vendor copy).
import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const here = dirname(fileURLToPath(import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Pre-flight: the entry is game/ + screenshots/ next to this file.
if (!existsSync(join(here, 'game', 'index.html'))) {
  throw new Error('game/index.html missing next to main.ts — nothing to hand in');
}
if (readdirSync(join(here, 'screenshots')).filter((f) => /\.(png|jpe?g)$/i.test(f)).length === 0) {
  throw new Error('screenshots/ holds no image — the dossier needs 3–4 renders');
}

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });

const dossier = buildDossier(out, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
});

writeFileSync(join(out, 'dossier.json'), dossier);
const shots = readdirSync(join(out, 'screenshots')).filter((f) => /\.(png|jpe?g)$/i.test(f));
console.log(`SOLMAR CITY dossier written: ${dossier.length} bytes -> ${join(out, 'dossier.json')} (${shots.length} screenshots)`);
