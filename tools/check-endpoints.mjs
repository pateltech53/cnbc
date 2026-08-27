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

/* A feed that answers but has not been published to in weeks is broken in the
 * way that matters: the tab fills with months-old stories. Age is the check. */
const STALE_AFTER_DAYS = 4;

function newestAgeDays(items) {
  const times = items
    .map((i) => (i.published ? new Date(i.published).getTime() : NaN))
    .filter((t) => Number.isFinite(t));
  if (!times.length) return null;
  return (Date.now() - Math.max(...times)) / 86400000;
}

function describeAge(days) {
  if (days === null) return 'no dates';
  if (days < 1) return `${Math.max(1, Math.round(days * 24))}h old`;
  return `${Math.round(days)}d old`;
}

console.log('\nCNBC RSS feeds');
const stale = [];
for (const slug of Object.keys(FEEDS)) {
  try {
    const { items, warnings } = await getNews(slug, 5);
    const usedFallback = warnings.some((w) => w.includes('showing Top news'));
    const age = newestAgeDays(items);
    const fresh = age !== null && age <= STALE_AFTER_DAYS;
    if (items.length && !usedFallback && !fresh) stale.push(slug);

    report(
      `${slug} (${FEEDS[slug].id})`,
      items.length > 0 && !usedFallback && fresh,
      items.length
        ? `${items.length} stories, newest ${describeAge(age)} - "${items[0].title.slice(0, 34)}"`
        : warnings[0] || 'empty',
    );
  } catch (error) {
    report(`${slug} (${FEEDS[slug].id})`, false, error.message);
  }
}

if (stale.length) {
  console.log(
    `\n  ${stale.join(', ')}: CNBC still answers on these ids but has not ` +
    `published to them in over ${STALE_AFTER_DAYS} days, so the tab shows old\n` +
    '  stories. Find the current id on cnbc.com/rss and update FEEDS in\n' +
    '  api/_lib/cnbc.js and standalone/server_template.py.',
  );
}

console.log(
  failures === 0
    ? '\nEverything is reachable.\n'
    : `\n${failures} check(s) failed. A single failed feed only affects that one tab; ` +
      'if every check fails, the problem is network access rather than the app.\n',
);

process.exit(failures === 0 ? 0 : 1);
