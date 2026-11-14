#!/usr/bin/env node
// Adds Reicon icons to the cassette editor's sticker tray, straight from the Reicon VS Code
// extension's icon data (Reicon is MIT-licensed), so nothing has to be copy-pasted by hand.
//
//   npm run sticker -- gamepad              add the Outline "gamepad" icon
//   npm run sticker -- gamepad --filled     add the Filled version
//   npm run sticker -- gamepad headphone    add several at once
//   npm run sticker -- --search game        list icon names containing "game"
//
// Names are the ones Reicon shows when you hover an icon (also searchable with --search).
// Needs the Reicon extension installed, or REICON_PATH pointing at its folder.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const LIBRARY = path.resolve(here, '../src/components/cassette/stickerLibrary.ts');
const MARKER = '// ── Paste new Reicon stickers below this line ──';

function findExtension() {
  if (process.env.REICON_PATH) return process.env.REICON_PATH;
  const roots = ['.vscode', '.vscode-insiders', '.cursor', '.windsurf'].map((d) => path.join(os.homedir(), d, 'extensions'));
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const hits = fs
      .readdirSync(root)
      .filter((d) => /^devchauhan\.reicon-/i.test(d))
      .sort()
      .reverse();
    if (hits.length) return path.join(root, hits[0]);
  }
  return null;
}

/** Pull the `window.REICON_DATA = {...}` object out of icons.js without executing it. */
function loadIcons(extDir) {
  const text = fs.readFileSync(path.join(extDir, 'dist', 'icons.js'), 'utf8');
  const start = text.indexOf('{', text.indexOf('REICON_DATA'));
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return JSON.parse(text.slice(start, i + 1));
  }
  throw new Error('Could not read Reicon icon data');
}

const titleCase = (name) =>
  name
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');

function main() {
  const args = process.argv.slice(2);
  const filled = args.includes('--filled');
  const searchIdx = args.indexOf('--search');
  const names = args.filter((a, i) => !a.startsWith('--') && (searchIdx === -1 || i !== searchIdx + 1));

  const extDir = findExtension();
  if (!extDir) {
    console.error('Reicon extension not found. Install it in VS Code, or set REICON_PATH to its folder.');
    process.exit(1);
  }
  const icons = loadIcons(extDir);

  if (searchIdx !== -1) {
    const term = (args[searchIdx + 1] ?? '').toLowerCase();
    const matches = Object.keys(icons).filter(
      (k) => k.includes(term) || (icons[k].description ?? []).some((d) => d.toLowerCase().includes(term)),
    );
    console.log(matches.length ? matches.join('\n') : `No icons match "${term}".`);
    return;
  }

  if (!names.length) {
    console.log('Usage: npm run sticker -- <icon-name> [more names] [--filled]   |   npm run sticker -- --search <term>');
    return;
  }

  let source = fs.readFileSync(LIBRARY, 'utf8');
  const markerAt = source.indexOf(MARKER);
  if (markerAt === -1) {
    console.error(`Couldn't find the marker line in stickerLibrary.ts:\n  ${MARKER}`);
    process.exit(1);
  }
  const insertAt = source.indexOf('\n];', markerAt);

  const weight = filled ? 'Filled' : 'Outline';
  let added = '';
  for (const name of names) {
    const icon = icons[name];
    if (!icon) {
      const close = Object.keys(icons).filter((k) => k.includes(name)).slice(0, 8);
      console.warn(`✗ "${name}" not found.${close.length ? ` Did you mean: ${close.join(', ')}?` : ''}`);
      continue;
    }
    const inner = icon.weights?.[weight];
    if (!inner) {
      console.warn(`✗ "${name}" has no ${weight} version.`);
      continue;
    }
    const id = `reicon-${name}${filled ? '-filled' : ''}`;
    if (source.includes(`id: '${id}'`)) {
      console.log(`• ${id} is already in the sticker list.`);
      continue;
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">${inner}</svg>`.replace(
      /[`$\\]/g,
      (c) => `\\${c}`,
    );
    added += `\n  {\n    id: '${id}',\n    label: '${titleCase(name)}${filled ? ' (filled)' : ''}',\n    svg: \`${svg}\`,\n  },`;
    console.log(`✓ added ${id}`);
  }

  if (added) {
    source = source.slice(0, insertAt) + added + source.slice(insertAt);
    fs.writeFileSync(LIBRARY, source);
    console.log(`\nSaved to ${path.relative(process.cwd(), LIBRARY)}`);
  }
}

main();
