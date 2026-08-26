/* Checks every CNBC endpoint this app depends on, from wherever you run it.
 *
 *   npm run check
 *
 * Use it if headlines or prices stop appearing: it tells you whether CNBC
 * changed something or whether the problem is on your side.
 */

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { FEEDS, TAPE, getQuotes, getNews } = require(path.join(root, 'api/_lib/cnbc.js'));

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';
const PASS = `${GREEN}ok  ${RESET}`;
const FAIL = `${RED}FAIL${RESET}`;

let failures = 0;

function report(label, ok, detail) {
  if (!ok) failures += 1;
  console.log(`  ${ok ? PASS : FAIL}  ${label.padEnd(26)} ${detail}`);
}

console.log('\nCNBC quote service');
try {
  const { quotes, warnings } = await getQuotes(TAPE.map((t) => t.symbol).join('|'));
  const live = quotes.filter((q) => q.source === 'cnbc');
  report('ticker symbols', live.length > 0, `${live.length}/${TAPE.length} returned`);
  if (quotes.length) {
    const sample = quotes[0];
    report('sample value', sample.last !== null, `${sample.symbol} = ${sample.last}`);
  }
  warnings.forEach((w) => console.log(`        note: ${w}`));
} catch (error) {
  report('ticker symbols', false, error.message);
}

try {
  const { quotes, warnings } = await getQuotes('AAPL|MSFT');
  report(
    'equity quotes',
    quotes.length === 2,
    quotes.length
      ? quotes.map((q) => `${q.symbol} ${q.last}`).join(', ')
      : warnings[0] || 'no quotes returned',
  );
} catch (error) {
  report('equity quotes', false, error.message);
}

console.log('\nCNBC RSS feeds');
for (const slug of Object.keys(FEEDS)) {
  try {
    const { items, warnings } = await getNews(slug, 5);
    const usedFallback = warnings.some((w) => w.includes('showing Top news'));
    report(
      `${slug} (${FEEDS[slug].id})`,
      items.length > 0 && !usedFallback,
      items.length
        ? `${items.length} stories - "${items[0].title.slice(0, 44)}"`
        : warnings[0] || 'empty',
    );
  } catch (error) {
    report(`${slug} (${FEEDS[slug].id})`, false, error.message);
  }
}

console.log(
  failures === 0
    ? '\nEverything is reachable.\n'
    : `\n${failures} check(s) failed. A single failed feed only affects that one tab; ` +
      'if every check fails, the problem is network access rather than the app.\n',
);

process.exit(failures === 0 ? 0 : 1);
