// SOLMAR CITY — make.fun gta6-01 entrypoint.
// Copies game/ and screenshots/ into the output dir, then writes dossier.json
// with the bounty scorer's own buildDossier (vendor/makefun-game.ts).
// v3 rebuild: same entrypoint, visuals upgraded (sky, lighting, effects).
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const root = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(out, { recursive: true });
const gameDir = join(root, 'game');
const shotsDir = join(root, 'screenshots');
if (!existsSync(gameDir)) throw new Error(`game/ not found next to main.ts (looked in ${root})`);
if (!existsSync(shotsDir)) throw new Error(`screenshots/ not found next to main.ts (looked in ${root})`);
cpSync(gameDir, join(out, 'game'), { recursive: true });
cpSync(shotsDir, join(out, 'screenshots'), { recursive: true });

const dossier = buildDossier(out, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
});
const dossierPath = join(out, 'dossier.json');
writeFileSync(dossierPath, dossier);
// Validasi balik: dossier harus JSON valid dengan skema + gambar yang benar.
const parsed = JSON.parse(readFileSync(dossierPath, 'utf8'));
if (parsed.schema !== 'makefun/dossier/v1') throw new Error(`dossier schema unexpected: ${parsed.schema}`);
if (!Array.isArray(parsed.images) || parsed.images.length === 0) throw new Error('dossier holds no screenshots');
console.log(`SOLMAR CITY dossier written to ${dossierPath} (${dossier.length} bytes, ${parsed.images.length} screenshots, text ${parsed.text.length} bytes)`);
