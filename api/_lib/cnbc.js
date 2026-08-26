/**
 * Shared CNBC data layer.
 *
 * Two public data sources are used, both of them the ones CNBC's own site calls:
 *   - quote.cnbc.com/quote-html-webservice  -> JSON quotes
 *   - www.cnbc.com/id/<feedId>/device/rss   -> RSS news
 *
 * Endpoint shapes were taken from the `ycnbc` library (Apache-2.0), which
 * documents the same query parameters CNBC's front end uses.
 */

const QUOTE_URL =
  'https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol';

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, text/html, */*',
  'Accept-Language': 'en-US,en;q=0.9',
};

/** CNBC RSS feed ids, keyed by the slug the front end sends. */
const FEEDS = {
  top: { id: '100003114', label: 'Top news' },
  markets: { id: '20409666', label: 'Markets' },
  business: { id: '10001147', label: 'Business' },
  economy: { id: '20910258', label: 'Economy' },
  tech: { id: '19854910', label: 'Technology' },
  finance: { id: '10000664', label: 'Finance' },
  earnings: { id: '15839135', label: 'Earnings' },
  investing: { id: '15839069', label: 'Investing' },
  politics: { id: '10000113', label: 'Politics' },
  world: { id: '100727362', label: 'World' },
  health: { id: '10000108', label: 'Health' },
  realestate: { id: '10000115', label: 'Real estate' },
  energy: { id: '19836768', label: 'Energy' },
};

/** Symbols shown in the ticker tape, in order, with short display names. */
const TAPE = [
  { symbol: '.DJI', name: 'Dow' },
  { symbol: '.SPX', name: 'S&P 500' },
  { symbol: '.IXIC', name: 'Nasdaq' },
  { symbol: '.RUT', name: 'Russell 2000' },
  { symbol: '.VIX', name: 'VIX' },
  { symbol: 'US10Y', name: '10-yr Treasury' },
  { symbol: '@CL.1', name: 'Crude oil' },
  { symbol: '@GC.1', name: 'Gold' },
  { symbol: 'BTC.CM=', name: 'Bitcoin' },
  { symbol: 'EUR=', name: 'Euro' },
];

const DEFAULT_WATCHLIST = [
  'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'JPM', 'JNJ', 'KO',
];

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

/**
 * CNBC returns numbers as display strings: "1,234.56", "+0.42", "0.80%",
 * "UNCH" (unchanged) or "N/A". Turn them into real numbers.
 */
function num(value) {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^unch$/i.test(raw)) return 0;
  if (/^(n\/?a|--|-)$/i.test(raw)) return null;
  const cleaned = raw.replace(/[,%\s+]/g, '');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

/** CNBC's market-status codes, in words a human recognises. */
function marketStatusLabel(code) {
  switch (String(code || '').toUpperCase()) {
    case 'REG_MKT': return 'Market open';
    case 'PRE_MKT': return 'Pre-market';
    case 'POST_MKT': return 'After hours';
    case 'MKT_CLOSED': return 'Market closed';
    default: return '';
  }
}

/**
 * Only forward symbols that look like symbols. CNBC's own tickers use dots,
 * carets, at-signs, equals and colons (".SPX", "@CL.1", "EUR=", "BTC.CM="),
 * so the set is wider than A-Z but still strictly bounded — this stops the
 * endpoint being used as an open proxy.
 */
function sanitizeSymbols(input, limit = 40) {
  const list = String(input || '')
    .split(/[|,]/)
    .map((s) => s.trim().toUpperCase())
    .filter((s) => s.length > 0 && s.length <= 16 && /^[A-Z0-9.\-=@^:&]+$/.test(s));
  return [...new Set(list)].slice(0, limit);
}

async function fetchWithTimeout(url, { timeout = 12000, headers } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { headers, signal: controller.signal, redirect: 'follow' });
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ */
/* quotes                                                              */
/* ------------------------------------------------------------------ */

function normalizeQuote(raw) {
  const extendedRaw = raw.ExtendedMktQuote || null;
  const extended =
    extendedRaw && num(extendedRaw.last) !== null
      ? {
          last: num(extendedRaw.last),
          change: num(extendedRaw.change),
          changePct: num(extendedRaw.change_pct),
          label: marketStatusLabel(extendedRaw.type) || 'Extended hours',
        }
      : null;

  return {
    symbol: raw.symbol || raw.issue_id || '',
    name: raw.name || raw.shortName || raw.symbol || '',
    last: num(raw.last),
    change: num(raw.change),
    changePct: num(raw.change_pct),
    prevClose: num(raw.previous_day_closing),
    open: num(raw.open),
    high: num(raw.high),
    low: num(raw.low),
    volume: num(raw.volume),
    currency: raw.currencyCode || null,
    marketStatus: marketStatusLabel(raw.curmktstatus),
    asOf: raw.last_timedate || raw.last_time || null,
    extended,
    source: 'cnbc',
  };
}

/**
 * Fetch quotes from CNBC. Returns [] rather than throwing on an empty
 * result so a caller can fall through to the backup provider.
 */
async function fetchCnbcQuotes(symbols) {
  if (!symbols.length) return [];
  const params = new URLSearchParams({
    symbols: symbols.join('|'),
    requestMethod: 'itv',
    noform: '1',
    partnerId: '2',
    fund: '1',
    exthrs: '1',
    output: 'json',
    events: '1',
  });

  const response = await fetchWithTimeout(`${QUOTE_URL}?${params}`, {
    headers: BROWSER_HEADERS,
  });
  if (!response.ok) {
    throw new Error(`CNBC quote service returned ${response.status}`);
  }

  const body = await response.json();
  const result = body?.FormattedQuoteResult?.FormattedQuote;
  if (!result) return [];
  // A single-symbol request comes back as an object, not an array.
  const list = Array.isArray(result) ? result : [result];
  return list.filter((q) => q && q.symbol).map(normalizeQuote);
}

/**
 * Backup provider: Stooq daily CSV. Only covers ordinary listed equities and
 * ETFs, and the data is end-of-day, so it is clearly marked as such in the UI.
 */
async function fetchStooqQuote(symbol) {
  if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol)) return null;
  const stooqSymbol = `${symbol.toLowerCase().replace(/\./g, '-')}.us`;
  const response = await fetchWithTimeout(
    `https://stooq.com/q/d/l/?s=${encodeURIComponent(stooqSymbol)}&i=d`,
    { headers: { 'User-Agent': BROWSER_HEADERS['User-Agent'] }, timeout: 8000 },
  );
  if (!response.ok) return null;

  const rows = (await response.text()).trim().split('\n');
  if (rows.length < 3) return null; // header + at least two sessions

  const cols = (line) => line.split(',');
  const latest = cols(rows[rows.length - 1]);
  const previous = cols(rows[rows.length - 2]);
  const close = Number(latest[4]);
  const prevClose = Number(previous[4]);
  if (!Number.isFinite(close) || !Number.isFinite(prevClose) || prevClose === 0) {
    return null;
  }

  const change = close - prevClose;
  return {
    symbol,
    name: symbol,
    last: close,
    change,
    changePct: (change / prevClose) * 100,
    prevClose,
    open: Number(latest[1]) || null,
    high: Number(latest[2]) || null,
    low: Number(latest[3]) || null,
    volume: Number(latest[5]) || null,
    currency: 'USD',
    marketStatus: 'End of day',
    asOf: latest[0] || null,
    extended: null,
    source: 'stooq',
  };
}

/**
 * Quotes for a list of symbols. CNBC first; anything it did not return is
 * retried against the backup so one dead provider does not empty the page.
 */
async function getQuotes(symbols) {
  const wanted = sanitizeSymbols(symbols);
  if (!wanted.length) return { quotes: [], warnings: ['No valid symbols requested.'] };

  const warnings = [];
  let quotes = [];

  try {
    quotes = await fetchCnbcQuotes(wanted);
  } catch (error) {
    warnings.push(`CNBC quotes unavailable (${error.message}).`);
  }

  const found = new Set(quotes.map((q) => q.symbol.toUpperCase()));
  const missing = wanted.filter((s) => !found.has(s));

  if (missing.length) {
    const backups = await Promise.all(
      missing.slice(0, 25).map((s) => fetchStooqQuote(s).catch(() => null)),
    );
    const usable = backups.filter(Boolean);
    if (usable.length) {
      quotes = quotes.concat(usable);
      warnings.push(`Showing end-of-day backup prices for ${usable.length} symbol(s).`);
    }
  }

  // Preserve the caller's ordering.
  const order = new Map(wanted.map((s, i) => [s, i]));
  quotes.sort(
    (a, b) =>
      (order.get(a.symbol.toUpperCase()) ?? 999) -
      (order.get(b.symbol.toUpperCase()) ?? 999),
  );

  return { quotes, warnings };
}

/* ------------------------------------------------------------------ */
/* news                                                                */
/* ------------------------------------------------------------------ */

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”',
  mdash: '—', ndash: '–', hellip: '…', trade: '™',
};

function decodeEntities(text) {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, code) => {
    if (code[0] === '#') {
      const value =
        code[1] === 'x' || code[1] === 'X'
          ? parseInt(code.slice(2), 16)
          : parseInt(code.slice(1), 10);
      return Number.isFinite(value) ? String.fromCodePoint(value) : match;
    }
    const named = NAMED_ENTITIES[code.toLowerCase()];
    return named === undefined ? match : named;
  });
}

function tagText(block, tag) {
  const match = block.match(
    new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i'),
  );
  if (!match) return '';
  let value = match[1].trim();
  const cdata = value.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  if (cdata) value = cdata[1];
  return decodeEntities(value.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
}

function parseRss(xml) {
  const items = [];
  const itemPattern = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemPattern.exec(xml)) !== null) {
    const block = match[1];
    const title = tagText(block, 'title');
    const link = tagText(block, 'link');
    if (!title || !/^https?:\/\//i.test(link)) continue;

    const published = tagText(block, 'pubDate');
    const parsedDate = published ? new Date(published) : null;

    items.push({
      id: tagText(block, 'guid') || link,
      title,
      link,
      summary: tagText(block, 'description').slice(0, 400),
      published:
        parsedDate && !Number.isNaN(parsedDate.getTime())
          ? parsedDate.toISOString()
          : null,
    });
  }
  return items;
}

async function fetchFeed(slug) {
  const feed = FEEDS[slug];
  if (!feed) throw new Error(`Unknown news category "${slug}".`);
  const response = await fetchWithTimeout(
    `https://www.cnbc.com/id/${feed.id}/device/rss/rss.html`,
    { headers: BROWSER_HEADERS },
  );
  if (!response.ok) {
    throw new Error(`CNBC feed "${slug}" returned ${response.status}`);
  }
  return parseRss(await response.text());
}

/**
 * News for one category. If a category feed fails or comes back empty we fall
 * back to Top news rather than showing the reader an empty page.
 */
async function getNews(slug, limit = 30) {
  const category = FEEDS[slug] ? slug : 'top';
  const warnings = [];
  let items = [];
  let used = category;

  try {
    items = await fetchFeed(category);
  } catch (error) {
    warnings.push(error.message);
  }

  if (!items.length && category !== 'top') {
    warnings.push(`No stories in ${FEEDS[category].label}; showing Top news.`);
    used = 'top';
    try {
      items = await fetchFeed('top');
    } catch (error) {
      warnings.push(error.message);
    }
  }

  return {
    category: used,
    label: FEEDS[used].label,
    items: items.slice(0, Math.min(Math.max(Number(limit) || 30, 1), 60)),
    warnings,
  };
}

module.exports = {
  FEEDS,
  TAPE,
  DEFAULT_WATCHLIST,
  getQuotes,
  getNews,
  parseRss,
  sanitizeSymbols,
  num,
};
