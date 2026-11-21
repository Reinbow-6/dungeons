import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE_REPO = '5e-bits/5e-srd-api';
const COMMIT_SHA = '46cbc835870aea499e122c8ae50943677ef71b06';
const SOURCE_PATH = 'packages/5e-database/src/2024/en';
const BASE_URL = `https://raw.githubusercontent.com/${SOURCE_REPO}/${COMMIT_SHA}/${SOURCE_PATH}`;

const FILES = [
  '5e-SRD-Conditions.json',
  '5e-SRD-Skills.json',
  '5e-SRD-Equipment.json',
  '5e-SRD-Spells.json',
  '5e-SRD-Monsters.json',
];

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, '../src/data');

async function main() {
  await mkdir(dataDir, { recursive: true });
  const counts = {};

  for (const filename of FILES) {
    const url = `${BASE_URL}/${filename}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'dungeons-srd-sync' },
    });
    if (!res.ok) {
      throw new Error(`Error descargando ${url}: HTTP ${res.status}`);
    }
    const text = await res.text();
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) {
      throw new Error(`El archivo ${filename} no devolvió un array JSON.`);
    }

    counts[filename] = parsed.length;
    await writeFile(path.join(dataDir, filename), `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
    console.log(`Synced ${filename}: ${parsed.length} registros`);
  }

  const manifest = {
    sourceRepo: SOURCE_REPO,
    sourcePath: SOURCE_PATH,
    commitSha: COMMIT_SHA,
    srdVersion: '5.2.1',
    license: 'CC-BY-4.0',
    counts,
  };

  await writeFile(
    path.join(dataDir, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
  console.log('Synced manifest.json');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
