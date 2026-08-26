/* Bakes public/ into a single runnable Python file, then zips it with
 * launchers for people who would rather not touch a terminal. */

import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSET_FILES = ['index.html', 'styles.css', 'app.js', 'favicon.svg'];

const assets = {};
for (const name of ASSET_FILES) {
  const bytes = await fs.readFile(path.join(root, 'public', name));
  assets[name] = bytes.toString('base64');
}

const literal =
  '{\n' +
  Object.entries(assets)
    .map(([name, b64]) => `    ${JSON.stringify(name)}: ${JSON.stringify(b64)},`)
    .join('\n') +
  '\n}';

const template = await fs.readFile(path.join(root, 'standalone/server_template.py'), 'utf8');
if (!template.includes('__EMBEDDED_ASSETS__')) {
  throw new Error('server_template.py is missing the __EMBEDDED_ASSETS__ placeholder');
}

const outDir = path.join(root, 'dist');
await fs.mkdir(outDir, { recursive: true });

const appPath = path.join(outDir, 'CNBC-App.py');
await fs.writeFile(appPath, template.replace('__EMBEDDED_ASSETS__', literal));
await fs.chmod(appPath, 0o755);

/* Launchers, so the zip works without anyone opening a terminal. */
const macLauncher = `#!/bin/bash
# Double-click this file on a Mac.
cd "$(dirname "$0")"
exec python3 CNBC-App.py
`;
const winLauncher = `@echo off
REM Double-click this file on Windows.
cd /d "%~dp0"
python CNBC-App.py || py CNBC-App.py
pause
`;

const readme = `CNBC Daily
==========

A simple dashboard of CNBC headlines and stock prices.

To start it
-----------

Mac:      double-click  "Start on Mac.command"
Windows:  double-click  "Start on Windows.bat"

Either one opens the dashboard in your web browser. Leave the small black
window open while you use it - closing that window stops the dashboard.

If double-clicking does nothing, open a terminal (Mac) or Command Prompt
(Windows) in this folder and run:

    python3 CNBC-App.py

You need Python 3.7 or newer. Macs usually have it. On Windows, install it
free from https://www.python.org/downloads/ and tick "Add Python to PATH"
during setup.

Using it
--------

  - The scrolling bar at the top shows the major markets.
  - "My stocks" is your own list. Type a symbol and press Add, or press the
    x to remove one. Your list is remembered on this computer.
  - The A A A buttons make all the text bigger.
  - "Dark" switches to a dark screen for night reading.

Headlines and prices come from CNBC's own public feeds. Prices may be
delayed. Not affiliated with or endorsed by CNBC.
`;

await fs.writeFile(path.join(outDir, 'Start on Mac.command'), macLauncher, { mode: 0o755 });
await fs.writeFile(path.join(outDir, 'Start on Windows.bat'), winLauncher);
await fs.writeFile(path.join(outDir, 'READ ME FIRST.txt'), readme);

const bundled = [
  appPath,
  path.join(outDir, 'Start on Mac.command'),
  path.join(outDir, 'Start on Windows.bat'),
  path.join(outDir, 'READ ME FIRST.txt'),
];

/* Zip archives record each file's mtime, so an unchanged rebuild would still
 * produce different bytes and show up as a git change. Pin the timestamps so
 * the same sources always yield the same archive. */
const EPOCH = new Date('2024-01-01T00:00:00Z');
await Promise.all(bundled.map((file) => fs.utimes(file, EPOCH, EPOCH)));

const zipPath = path.join(outDir, 'CNBC-App.zip');
await fs.rm(zipPath, { force: true });
await run('zip', ['-j', '-q', '-X', zipPath, ...bundled]);

const { size } = await fs.stat(zipPath);
console.log(`dist/CNBC-App.py    ${(await fs.stat(appPath)).size} bytes`);
console.log(`dist/CNBC-App.zip   ${size} bytes`);
