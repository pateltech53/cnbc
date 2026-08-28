/* CNBC Daily — front end.
 * No framework, no build step. All text is written with textContent so a
 * headline can never inject markup into the page. */

(function () {
  'use strict';

  /* ---------------------------------------------------------------- */
  /* configuration                                                     */
  /* ---------------------------------------------------------------- */

  // Display names for the ticker, keyed to the symbols api/quotes.js sends
  // for `?set=tape`. CNBC's own names ("Dow Jones Industrial Average") are
  // too long to read at ticker speed.
  var TAPE_NAMES = {
    '.DJI': 'Dow',
    '.SPX': 'S&P 500',
    '.IXIC': 'Nasdaq',
    '.RUT': 'Russell 2000',
    '.VIX': 'VIX',
    'US10Y': '10-yr Treasury',
    '@CL.1': 'Crude oil',
    '@GC.1': 'Gold',
    'BTC.CM=': 'Bitcoin',
    'EUR=': 'Euro'
  };

  // CNBC's own YouTube channel, which is where CNBC publishes its free live
  // stream. YouTube's live_stream embed takes a channel id, not an @handle.
  // To point the player at a different channel, change this one value.
  var LIVE_CHANNEL_ID = 'UCrp_UI8XtuYfpiqluWLD7Lw';   // CNBC Television

  var DEFAULT_WATCHLIST = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'JPM', 'JNJ', 'KO'];
  var SYMBOL_PATTERN = /^[A-Z0-9.\-=@^:&]{1,16}$/;

  var QUOTE_INTERVAL = 30000;    // 30 seconds
  var NEWS_INTERVAL = 300000;    // 5 minutes
  var CLOCK_INTERVAL = 20000;    // clock, sun progress and downtime check

  var DEFAULT_NAME = 'Dad';
  var DEFAULT_DOWNTIME = '18:30';
  var DAY_START_HOUR = 7;        // the indicator tracks the waking day, not midnight

  /* The embedded page is laid out at a fixed logical size so the crop means
   * the same thing in the editor and in the dashboard, whatever the screen. */
  var FRAME_W = 1280;
  var FRAME_H = 1800;
  var STAGE_RATIO = 3 / 4;       // editor stage and default player are 4:3
  var MIN_CROP = 0.12;
  var MIN_ZOOM = 0.25;
  var MAX_ZOOM = 4;
  var ZOOM_STEP = 0.1;

  /* The frame is 4:3 rather than 16:9 so roughly half the embedded page shows
   * instead of its top 40%. Zoom stays at 1.0 by default: below that the page
   * stops filling the frame width and leaves bars down each side. */
  var DEFAULT_ZOOM = 1;
  var DEFAULT_CROP = {
    scale: DEFAULT_ZOOM, offsetX: 0, offsetY: 0,
    cropX: 0, cropY: 0, cropW: 1, cropH: 1
  };
  var LIVE_ZOOM_STEP = 0.08;

  var STORE = {
    watchlist: 'cnbcdaily.watchlist',
    theme: 'cnbcdaily.theme',
    size: 'cnbcdaily.size',
    category: 'cnbcdaily.category',
    stream: 'cnbcdaily.stream',
    name: 'cnbcdaily.name',
    downtime: 'cnbcdaily.downtime',
    downtimeSeen: 'cnbcdaily.downtimeSeen',
    liveCrop: 'cnbcdaily.liveCrop',
    onboarded: 'cnbcdaily.onboarded'
  };

  /* Background footage for the first-run screen. If it will not load, the
   * gradient behind it stands in and onboarding carries on unchanged. */
  var HERO_VIDEO = 'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260530_042513_df96a13b-6155-4f6e-8b93-c9dee66fba08.mp4';
  var SCRUB_SENSITIVITY = 0.8;
  var HERO_LINE = 'Glad you stopped in. Let us get the markets set up the way you like them.';

  // Printed on the clock dial. One string, change it to anything you like.
  var CLOCK_BRAND = 'Patek Philippe';

  /* ---------------------------------------------------------------- */
  /* small helpers                                                     */
  /* ---------------------------------------------------------------- */

  var $ = function (id) { return document.getElementById(id); };

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function clamp(value, low, high) {
    return Math.min(high, Math.max(low, value));
  }

  function readStore(key, fallback) {
    try {
      var raw = window.localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (err) {
      return fallback;
    }
  }

  function writeStore(key, value) {
    try { window.localStorage.setItem(key, JSON.stringify(value)); } catch (err) { /* private mode */ }
  }

  /* Decimals are chosen from the price, not from the number being printed, so
   * a price and its change always line up: 232.14 / +1.84, never 232.14 / +0.440. */
  function decimalsFor(price, symbol) {
    if (/^US\d+[MY]$/.test(symbol)) return 3;                       // treasury yields
    if (price !== null && price !== undefined && Math.abs(price) > 0 && Math.abs(price) < 1) {
      return 4;                                                     // FX pairs
    }
    return 2;
  }

  function formatPrice(value, symbol) {
    if (value === null || value === undefined) return '—';
    var decimals = decimalsFor(value, symbol);
    return value.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  }

  function formatSigned(value, decimals) {
    if (value === null || value === undefined) return '—';
    var text = Math.abs(value).toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
    return (value > 0 ? '+' : value < 0 ? '−' : '') + text;
  }

  /* Direction is always carried by a glyph and a sign as well as colour,
   * so it still reads correctly without colour vision. */
  function direction(quote) {
    var basis = quote.changePct !== null && quote.changePct !== undefined
      ? quote.changePct
      : quote.change;
    if (basis === null || basis === undefined) return { klass: 'is-flat', glyph: '' };
    if (basis > 0) return { klass: 'is-up', glyph: '▲' };
    if (basis < 0) return { klass: 'is-down', glyph: '▼' };
    return { klass: 'is-flat', glyph: '■' };
  }

  function moveText(quote, priceForScale, symbol) {
    var dir = direction(quote);
    if (dir.klass === 'is-flat' && dir.glyph) {
      return { klass: dir.klass, text: 'Unchanged' };
    }

    var decimals = decimalsFor(
      priceForScale === undefined ? quote.last : priceForScale,
      symbol || quote.symbol
    );
    var parts = [];
    if (dir.glyph) parts.push(dir.glyph);
    if (quote.change !== null && quote.change !== undefined) {
      parts.push(formatSigned(quote.change, decimals));
    }
    if (quote.changePct !== null && quote.changePct !== undefined) {
      parts.push('(' + formatSigned(quote.changePct, 2) + '%)');
    }
    return { klass: dir.klass, text: parts.join(' ') || '—' };
  }

  function timeAgo(iso) {
    if (!iso) return '';
    var then = new Date(iso);
    if (isNaN(then.getTime())) return '';
    var minutes = Math.round((Date.now() - then.getTime()) / 60000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return minutes + ' min ago';
    var hours = Math.round(minutes / 60);
    if (hours < 24) return hours + (hours === 1 ? ' hour ago' : ' hours ago');
    return then.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function clockText() {
    var now = new Date();
    return now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) +
      '  ·  ' + now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  async function getJSON(url) {
    var response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('Request failed (' + response.status + ')');
    return response.json();
  }

  /* ---------------------------------------------------------------- */
  /* state                                                             */
  /* ---------------------------------------------------------------- */

  var state = {
    watchlist: readStore(STORE.watchlist, DEFAULT_WATCHLIST),
    category: readStore(STORE.category, 'top'),
    crop: DEFAULT_CROP,
    draftCrop: DEFAULT_CROP,
    lastTape: [],
    lastQuotes: [],
    lastNews: [],
    lastQuoteOk: null,
    lastNewsOk: null
  };

  if (!Array.isArray(state.watchlist) || !state.watchlist.length) {
    state.watchlist = DEFAULT_WATCHLIST.slice();
  }

  /* ---------------------------------------------------------------- */
  /* greeting                                                          */
  /* ---------------------------------------------------------------- */

  function readName() {
    var saved = readStore(STORE.name, '');
    saved = typeof saved === 'string' ? saved.trim() : '';
    return saved || DEFAULT_NAME;
  }

  function renderGreeting() {
    var target = $('greeting-name');
    if (target) target.textContent = readName();
  }

  /* ---------------------------------------------------------------- */
  /* downtime and the day-progress indicator                           */
  /* ---------------------------------------------------------------- */

  function readDowntime() {
    var saved = readStore(STORE.downtime, DEFAULT_DOWNTIME);
    return (typeof saved === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(saved))
      ? saved
      : DEFAULT_DOWNTIME;
  }

  function downtimeMinutes() {
    var parts = readDowntime().split(':');
    return Number(parts[0]) * 60 + Number(parts[1]);
  }

  function formatTimeOfDay(minutes) {
    var when = new Date();
    when.setHours(Math.floor(minutes / 60), Math.round(minutes % 60), 0, 0);
    return when.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  function formatDuration(minutes) {
    var total = Math.max(0, Math.round(minutes));
    var hours = Math.floor(total / 60);
    var rest = total % 60;
    if (hours && rest) return hours + 'h ' + rest + 'm';
    if (hours) return hours + 'h';
    return rest + 'm';
  }

  /* The bar runs from the start of the waking day to downtime. A downtime set
   * earlier than the usual start still gets a sane span rather than dividing
   * by zero. */
  function daySpan() {
    var end = downtimeMinutes();
    var start = DAY_START_HOUR * 60;
    if (end <= start) start = Math.max(0, end - 60);
    return { start: start, end: end };
  }

  function minutesNow() {
    var now = new Date();
    return now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  }

  function updateDayProgress() {
    var fill = $('sun-fill');
    var orb = $('sun-orb');
    if (!fill || !orb) return;

    var span = daySpan();
    var total = span.end - span.start;
    var now = minutesNow();
    var progress = total > 0 ? clamp((now - span.start) / total, 0, 1) : 1;

    fill.style.width = (progress * 100) + '%';
    orb.style.left = (progress * 100) + '%';

    var track = $('sun-track');
    if (track) {
      track.setAttribute('role', 'progressbar');
      track.setAttribute('aria-valuemin', '0');
      track.setAttribute('aria-valuemax', '100');
      track.setAttribute('aria-valuenow', String(Math.round(progress * 100)));
    }

    var remaining = span.end - now;
    var label;
    if (now < span.start) label = 'Your day begins at ' + formatTimeOfDay(span.start);
    else if (remaining <= 0) label = 'Downtime has passed';
    else label = formatDuration(remaining) + ' until downtime';

    $('sun-remaining').textContent = label;
    $('sun-target').textContent = 'Downtime ' + formatTimeOfDay(span.end);
  }

  function todayKey() {
    var now = new Date();
    return now.getFullYear() + '-' +
      String(now.getMonth() + 1).padStart(2, '0') + '-' +
      String(now.getDate()).padStart(2, '0');
  }

  /* Shown once a day at most: the dismissal is stamped with the date, so it
   * stays gone until tomorrow rather than reappearing on every tick. */
  function maybeShowDowntimeNotice() {
    var dialog = $('downtime-notice');
    if (!dialog || dialog.open || typeof dialog.showModal !== 'function') return;
    if ($('settings') && $('settings').open) return;      // don't interrupt editing
    if ($('onboard')) return;                            // nor first-run setup
    if (minutesNow() < downtimeMinutes()) return;
    if (readStore(STORE.downtimeSeen, '') === todayKey()) return;

    $('downtime-meta').textContent = 'You set downtime for ' + formatTimeOfDay(downtimeMinutes());
    dialog.showModal();
  }

  function dismissDowntimeNotice() {
    writeStore(STORE.downtimeSeen, todayKey());
    var dialog = $('downtime-notice');
    if (dialog && dialog.open) dialog.close();
  }

  function initDowntimeNotice() {
    var dialog = $('downtime-notice');
    if (!dialog) return;

    $('downtime-continue').addEventListener('click', dismissDowntimeNotice);

    $('downtime-change').addEventListener('click', function () {
      dismissDowntimeNotice();
      openSettings('downtime-input');
    });

    // Esc counts as dismissing it for today, so it does not bounce straight back.
    dialog.addEventListener('cancel', function (event) {
      event.preventDefault();
      dismissDowntimeNotice();
    });
  }

  /* ---------------------------------------------------------------- */
  /* appearance: theme and text size                                   */
  /* ---------------------------------------------------------------- */

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    var buttons = document.querySelectorAll('[data-theme-choice]');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].setAttribute('aria-pressed', String(buttons[i].dataset.themeChoice === theme));
    }
    writeStore(STORE.theme, theme);
  }

  // Sized for a tablet at arm's length; step 1 is already comfortable.
  var SIZES = { 1: '21px', 2: '24px', 3: '27px' };

  function applySize(step) {
    var key = SIZES[step] ? step : 1;
    document.documentElement.style.setProperty('--step', SIZES[key]);
    var buttons = document.querySelectorAll('.sizer__btn');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].setAttribute('aria-pressed', String(Number(buttons[i].dataset.size) === Number(key)));
    }
    writeStore(STORE.size, key);
    applyCropToPlayer();      // the player's box moves with the type scale
  }

  function initAppearance() {
    var savedTheme = readStore(STORE.theme, null);
    var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(savedTheme || (prefersDark ? 'dark' : 'light'));
    applySize(readStore(STORE.size, 1));

    var themeButtons = document.querySelectorAll('[data-theme-choice]');
    for (var i = 0; i < themeButtons.length; i++) {
      themeButtons[i].addEventListener('click', function (event) {
        applyTheme(event.currentTarget.dataset.themeChoice);
      });
    }

    var sizeButtons = document.querySelectorAll('.sizer__btn');
    for (var j = 0; j < sizeButtons.length; j++) {
      sizeButtons[j].addEventListener('click', function (event) {
        applySize(Number(event.currentTarget.dataset.size));
      });
    }
  }

  /* ---------------------------------------------------------------- */
  /* ticker tape                                                       */
  /* ---------------------------------------------------------------- */

  function buildTapeGroup(quotes, isClone) {
    var group = el('div', 'tape__group');
    group.dataset.clone = String(Boolean(isClone));
    if (isClone) group.setAttribute('aria-hidden', 'true');

    quotes.forEach(function (quote) {
      var item = el('div', 'tape__item');
      item.appendChild(el('span', 'tape__name', TAPE_NAMES[quote.symbol] || quote.name || quote.symbol));
      item.appendChild(el('span', 'tape__price', formatPrice(quote.last, quote.symbol)));
      var move = moveText(quote);
      item.appendChild(el('span', 'tape__move ' + move.klass, move.text));
      group.appendChild(item);
    });
    return group;
  }

  function renderTape(quotes) {
    var track = $('tape-track');
    track.textContent = '';
    if (!quotes.length) {
      track.appendChild(el('span', 'tape__loading', 'Market data unavailable right now.'));
      return;
    }
    track.appendChild(buildTapeGroup(quotes, false));
    track.appendChild(buildTapeGroup(quotes, true));
  }

  /* ---------------------------------------------------------------- */
  /* watchlist                                                         */
  /* ---------------------------------------------------------------- */

  function renderWatchlist(quotes) {
    var list = $('watchlist');
    list.textContent = '';

    if (!quotes.length) {
      list.appendChild(el('li', 'empty', 'No prices to show. Tap Refresh to try again.'));
      return;
    }

    quotes.forEach(function (quote) {
      var row = el('li', 'quote');

      var id = el('div', 'quote__id');
      id.appendChild(el('span', 'quote__symbol', quote.symbol));
      id.appendChild(el('p', 'quote__name', quote.name || quote.symbol));
      row.appendChild(id);

      // Only plain US equities get a dollar sign; indices, futures and FX
      // pairs would be wrong with one ("$6,012.18" for the S&P).
      var isUsdEquity = /^[A-Z][A-Z0-9.\-]{0,9}$/.test(quote.symbol) &&
        !/^[.@]/.test(quote.symbol) && quote.currency === 'USD';

      var figures = el('div', 'quote__figures');
      figures.appendChild(el(
        'span',
        'quote__price' + (isUsdEquity ? ' quote__price--usd' : ''),
        formatPrice(quote.last, quote.symbol)
      ));
      var move = moveText(quote);
      figures.appendChild(el('span', 'quote__move ' + move.klass, move.text));

      row.appendChild(figures);

      // The extra line is a direct grid child so it spans its own row; nested
      // inside .quote__figures it would widen that column and crush the name.
      if (quote.extended) {
        var extended = moveText(quote.extended, quote.last, quote.symbol);
        row.appendChild(el(
          'span',
          'quote__extra',
          quote.extended.label + ' ' + formatPrice(quote.extended.last, quote.symbol) + ' ' + extended.text
        ));
      } else if (quote.source === 'stooq') {
        row.appendChild(el('span', 'quote__extra', 'End-of-day backup price'));
      }

      var remove = el('button', 'quote__remove', '×');
      remove.type = 'button';
      remove.setAttribute('aria-label', 'Remove ' + quote.symbol + ' from my stocks');
      remove.addEventListener('click', function () { removeSymbol(quote.symbol); });
      row.appendChild(remove);

      list.appendChild(row);
    });
  }

  function removeSymbol(symbol) {
    state.watchlist = state.watchlist.filter(function (s) { return s !== symbol; });
    if (!state.watchlist.length) state.watchlist = DEFAULT_WATCHLIST.slice();
    writeStore(STORE.watchlist, state.watchlist);
    loadQuotes();
  }

  function initAdder() {
    $('add-form').addEventListener('submit', function (event) {
      event.preventDefault();
      var input = $('add-input');
      var message = $('add-msg');
      var symbol = input.value.trim().toUpperCase();

      if (!symbol) return;
      if (!SYMBOL_PATTERN.test(symbol)) {
        message.textContent = 'That does not look like a stock symbol. Try letters and numbers, like TSLA.';
        return;
      }
      if (state.watchlist.indexOf(symbol) !== -1) {
        message.textContent = symbol + ' is already on the list.';
        input.value = '';
        return;
      }

      state.watchlist.push(symbol);
      writeStore(STORE.watchlist, state.watchlist);
      input.value = '';
      message.textContent = 'Added ' + symbol + '.';
      loadQuotes();
    });
  }

  /* ---------------------------------------------------------------- */
  /* news                                                              */
  /* ---------------------------------------------------------------- */

  function renderCategories(categories) {
    var nav = $('categories');
    if (nav.childElementCount === categories.length) return; // built already
    nav.textContent = '';

    categories.forEach(function (category) {
      var chip = el('button', 'chip', category.label);
      chip.type = 'button';
      chip.setAttribute('aria-current', String(category.slug === state.category));
      chip.addEventListener('click', function () {
        state.category = category.slug;
        writeStore(STORE.category, category.slug);
        markCurrentChip();
        loadNews();
      });
      chip.dataset.slug = category.slug;
      nav.appendChild(chip);
    });
  }

  function markCurrentChip() {
    var chips = $('categories').querySelectorAll('.chip');
    for (var i = 0; i < chips.length; i++) {
      chips[i].setAttribute('aria-current', String(chips[i].dataset.slug === state.category));
    }
  }

  function renderStories(items) {
    var list = $('news');
    list.textContent = '';

    if (!items.length) {
      list.appendChild(el('li', 'empty', 'No headlines loaded. Check your connection and tap Refresh.'));
      return;
    }

    items.forEach(function (item) {
      var story = el('li', 'story');
      var link = el('a', 'story__link');
      link.href = item.link;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';

      link.appendChild(el('h3', 'story__title', item.title));
      if (item.summary) link.appendChild(el('p', 'story__summary', item.summary));
      var when = timeAgo(item.published);
      if (when) link.appendChild(el('span', 'story__time', when));

      story.appendChild(link);
      list.appendChild(story);
    });
  }

  /* ---------------------------------------------------------------- */
  /* loading                                                           */
  /* ---------------------------------------------------------------- */

  function setStatus() {
    var parts = [];
    if (state.lastQuoteOk === false || state.lastNewsOk === false) {
      parts.push('Could not update — will keep trying');
    } else if (state.lastQuoteOk === null && state.lastNewsOk === null) {
      parts.push('Loading');
    } else {
      parts.push('Updated ' + new Date().toLocaleTimeString('en-US', {
        hour: 'numeric', minute: '2-digit'
      }));
    }
    $('status').textContent = parts.join(' ');
  }

  async function loadQuotes() {
    try {
      var tape = await getJSON('/api/quotes?set=tape');
      state.lastTape = tape.quotes || [];
      renderTape(state.lastTape);
    } catch (err) {
      state.lastQuoteOk = false;
    }

    try {
      var mine = await getJSON('/api/quotes?symbols=' + encodeURIComponent(state.watchlist.join('|')));
      state.lastQuotes = mine.quotes || [];
      renderWatchlist(state.lastQuotes);
      var note = (mine.quotes && mine.quotes.length && mine.quotes[0].marketStatus) || '';
      $('watchlist-note').textContent = note;
      state.lastQuoteOk = true;
      renderScreen();
    } catch (err) {
      state.lastQuoteOk = false;
      $('watchlist-note').textContent = '';
    }
    setStatus();
  }

  async function loadNews() {
    try {
      var data = await getJSON('/api/news?category=' + encodeURIComponent(state.category) + '&limit=30');
      if (data.categories) renderCategories(data.categories);
      state.lastNews = data.items || [];
      state.lastNewsLabel = data.label || '';
      renderStories(state.lastNews);
      $('news-note').textContent = data.label || '';
      state.lastNewsOk = true;
      renderScreen();
    } catch (err) {
      state.lastNewsOk = false;
      $('news-note').textContent = '';
    }
    setStatus();
  }

  async function refreshAll() {
    var button = $('refresh-btn');
    button.setAttribute('aria-busy', 'true');
    try {
      await Promise.all([loadQuotes(), loadNews()]);
    } finally {
      button.removeAttribute('aria-busy');
    }
  }

  /* ---------------------------------------------------------------- */
  /* live player: source                                               */
  /* ---------------------------------------------------------------- */

  function defaultStreamUrl() {
    return 'https://www.youtube.com/embed/live_stream?channel=' +
      encodeURIComponent(LIVE_CHANNEL_ID);
  }

  /* Sites hand out embed code, not bare addresses, so accept either. Only the
   * src is taken from a pasted snippet — width, style, sandbox and the rest are
   * discarded, because the panel controls its own frame. The snippet is never
   * inserted into the page as markup. */
  function extractSource(value) {
    var raw = String(value || '').trim();
    if (!raw || raw.indexOf('<') === -1) return raw;

    // DOMParser builds an inert document: no browsing context, so nothing in
    // the pasted markup executes, loads, or is attached to this page.
    try {
      var parsed = new DOMParser().parseFromString(raw, 'text/html');
      var node = parsed.querySelector('[src]');
      if (node) return (node.getAttribute('src') || '').trim();
    } catch (err) {
      /* fall through to the textual match below */
    }

    var match = raw.match(/\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    return match ? (match[1] || match[2] || match[3] || '').trim() : '';
  }

  /* Only http(s) addresses reach the iframe. Anything else — javascript:,
   * data:, a bare word someone typed — is rejected rather than assigned. */
  function normalizeStreamUrl(value) {
    var raw = String(value || '').trim();
    if (!raw) return { ok: true, url: '', fromEmbed: false };   // empty means "use the default"

    var candidate = extractSource(raw);
    var fromEmbed = raw.indexOf('<') !== -1;

    if (!candidate) {
      return {
        ok: false,
        reason: 'No address found in that. Paste a link, or embed code containing src="…".'
      };
    }
    // Embed codes are often protocol-relative: src="//player.example.com/x".
    if (candidate.slice(0, 2) === '//') candidate = 'https:' + candidate;

    var parsed;
    try {
      parsed = new URL(candidate);
    } catch (err) {
      return { ok: false, reason: 'That is not a complete web address. It should start with https://' };
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return { ok: false, reason: 'Only https:// and http:// addresses can be shown here.' };
    }
    return { ok: true, url: parsed.href, fromEmbed: fromEmbed };
  }

  function storedStreamUrl() {
    var saved = normalizeStreamUrl(readStore(STORE.stream, ''));
    return saved.ok ? saved.url : '';
  }

  function activeStreamUrl() {
    return storedStreamUrl() || (LIVE_CHANNEL_ID ? defaultStreamUrl() : '');
  }

  /* The stream loads only once the page is running, so a slow response from
   * whatever is embedded never holds up the prices and headlines. */
  function initLivePlayer() {
    var frame = $('live-frame');
    if (!frame) return;

    var custom = storedStreamUrl();
    var source = activeStreamUrl();
    if (source) frame.src = source;

    var tag = $('live-note-tag');
    if (tag) tag.textContent = custom ? 'Custom source' : '';

    var note = $('live-note');
    if (note) {
      note.textContent = custom
        ? 'Showing the stream set in Settings. If the panel is blank, that site does not allow being embedded.'
        : "The player shows CNBC's stream when the channel is live. If it is blank, " +
          'CNBC is off air on that channel right now — use a link below.';
    }

    applyCropToPlayer();
  }

  /* ---------------------------------------------------------------- */
  /* live player: crop                                                 */
  /* ---------------------------------------------------------------- */

  function sanitizeCrop(value) {
    var crop = {
      scale: DEFAULT_CROP.scale,
      offsetX: DEFAULT_CROP.offsetX, offsetY: DEFAULT_CROP.offsetY,
      cropX: DEFAULT_CROP.cropX, cropY: DEFAULT_CROP.cropY,
      cropW: DEFAULT_CROP.cropW, cropH: DEFAULT_CROP.cropH
    };
    if (value && typeof value === 'object') {
      Object.keys(crop).forEach(function (key) {
        var num = Number(value[key]);
        if (isFinite(num)) crop[key] = num;
      });
    }
    crop.scale = clamp(crop.scale, MIN_ZOOM, MAX_ZOOM);
    crop.cropW = clamp(crop.cropW, MIN_CROP, 1);
    crop.cropH = clamp(crop.cropH, MIN_CROP, 1);
    crop.cropX = clamp(crop.cropX, 0, 1 - crop.cropW);
    crop.cropY = clamp(crop.cropY, 0, 1 - crop.cropH);
    crop.offsetX = clamp(crop.offsetX, -10, 10);
    crop.offsetY = clamp(crop.offsetY, -10, 10);
    return crop;
  }

  function copyCrop(crop) { return sanitizeCrop(crop); }

  /* Everything is stored as a fraction of a virtual 16:9 stage, so a saved
   * crop keeps meaning the same thing at any player size. */
  function applyCropToPlayer() {
    var player = $('live-player');
    var cropEl = $('live-crop');
    var frame = $('live-frame');
    if (!player || !cropEl || !frame) return;

    var crop = state.crop;
    var ratio = ((crop.cropW * 4) / (crop.cropH * 3)).toFixed(4);
    if (player.dataset.ratio !== ratio) {          // guarded: writing this resizes the box
      player.dataset.ratio = ratio;
      player.style.aspectRatio = ratio;
    }

    var viewportWidth = player.clientWidth;
    if (!viewportWidth) return;

    var stageWidth = viewportWidth / crop.cropW;
    var stageHeight = stageWidth * STAGE_RATIO;

    frame.style.width = FRAME_W + 'px';
    frame.style.height = FRAME_H + 'px';
    frame.style.transform = 'scale(' + ((crop.scale * stageWidth) / FRAME_W) + ')';

    cropEl.style.left = ((crop.offsetX - crop.cropX) * stageWidth) + 'px';
    cropEl.style.top = ((crop.offsetY - crop.cropY) * stageHeight) + 'px';
  }

  function renderCropEditor() {
    var stage = $('crop-stage');
    var page = $('crop-page');
    var frame = $('crop-frame');
    var rect = $('crop-rect');
    var dim = $('crop-dim');
    if (!stage || !page || !frame || !rect || !dim) return;

    var crop = state.draftCrop;
    var stageWidth = stage.clientWidth;
    if (!stageWidth) return;
    var stageHeight = stageWidth * STAGE_RATIO;

    frame.style.width = FRAME_W + 'px';
    frame.style.height = FRAME_H + 'px';
    frame.style.transform = 'scale(' + ((crop.scale * stageWidth) / FRAME_W) + ')';

    page.style.left = (crop.offsetX * stageWidth) + 'px';
    page.style.top = (crop.offsetY * stageHeight) + 'px';

    // outline and dimming mask track the same rectangle, in two layers
    [rect, dim].forEach(function (layer) {
      layer.style.left = (crop.cropX * 100) + '%';
      layer.style.top = (crop.cropY * 100) + '%';
      layer.style.width = (crop.cropW * 100) + '%';
      layer.style.height = (crop.cropH * 100) + '%';
    });

    $('crop-zoom').value = String(crop.scale);
    $('crop-zoom-out').textContent = Math.round(crop.scale * 100) + '%';
  }

  function initCropEditor() {
    var dialog = $('crop-editor');
    var stage = $('crop-stage');
    if (!dialog || !stage || typeof dialog.showModal !== 'function') return;

    var message = $('crop-msg');
    function say(text, tone) {
      message.textContent = text || '';
      if (tone) message.setAttribute('data-tone', tone);
      else message.removeAttribute('data-tone');
    }

    function closeEditor() {
      $('crop-frame').removeAttribute('src');       // stop the second stream
      dialog.close();
      if ($('settings') && $('settings').open) $('crop-open').focus();
    }

    /* One pointer gesture at a time: either panning the page underneath, or
     * dragging one handle of the crop window. Pointer events cover mouse,
     * pen and touch with the same code. */
    var drag = null;

    function stageMetrics() {
      var width = stage.clientWidth;
      return { width: width, height: width * STAGE_RATIO };
    }

    function beginDrag(event, handle) {
      var size = stageMetrics();
      if (!size.width) return;
      drag = {
        handle: handle,
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        size: size,
        origin: copyCrop(state.draftCrop)
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
    }

    function moveDrag(event) {
      if (!drag || event.pointerId !== drag.pointerId) return;
      var dx = (event.clientX - drag.startClientX) / drag.size.width;
      var dy = (event.clientY - drag.startClientY) / drag.size.height;
      var origin = drag.origin;
      var crop = state.draftCrop;

      if (drag.handle === 'pan') {
        crop.offsetX = clamp(origin.offsetX + dx, -10, 10);
        crop.offsetY = clamp(origin.offsetY + dy, -10, 10);
      } else {
        var handle = drag.handle;
        if (handle.indexOf('w') !== -1) {
          var left = clamp(origin.cropX + dx, 0, origin.cropX + origin.cropW - MIN_CROP);
          crop.cropX = left;
          crop.cropW = origin.cropX + origin.cropW - left;
        }
        if (handle.indexOf('e') !== -1) {
          crop.cropW = clamp(origin.cropW + dx, MIN_CROP, 1 - crop.cropX);
        }
        if (handle.indexOf('n') !== -1) {
          var top = clamp(origin.cropY + dy, 0, origin.cropY + origin.cropH - MIN_CROP);
          crop.cropY = top;
          crop.cropH = origin.cropY + origin.cropH - top;
        }
        if (handle.indexOf('s') !== -1) {
          crop.cropH = clamp(origin.cropH + dy, MIN_CROP, 1 - crop.cropY);
        }
      }

      renderCropEditor();
      event.preventDefault();
    }

    function endDrag(event) {
      if (!drag || event.pointerId !== drag.pointerId) return;
      try { event.currentTarget.releasePointerCapture(event.pointerId); } catch (err) { /* already gone */ }
      drag = null;
    }

    var shield = $('crop-shield');
    shield.addEventListener('pointerdown', function (event) { beginDrag(event, 'pan'); });
    shield.addEventListener('pointermove', moveDrag);
    shield.addEventListener('pointerup', endDrag);
    shield.addEventListener('pointercancel', endDrag);

    var handles = stage.querySelectorAll('.crop__handle');
    for (var i = 0; i < handles.length; i++) {
      handles[i].addEventListener('pointerdown', function (event) {
        event.stopPropagation();
        beginDrag(event, event.currentTarget.dataset.handle);
      });
      handles[i].addEventListener('pointermove', moveDrag);
      handles[i].addEventListener('pointerup', endDrag);
      handles[i].addEventListener('pointercancel', endDrag);
    }

    function setZoom(value) {
      state.draftCrop.scale = clamp(value, MIN_ZOOM, MAX_ZOOM);
      renderCropEditor();
    }

    $('crop-zoom').addEventListener('input', function (event) {
      setZoom(Number(event.target.value) || 1);
    });
    $('crop-zoom-down').addEventListener('click', function () {
      setZoom(state.draftCrop.scale - ZOOM_STEP);
    });
    $('crop-zoom-up').addEventListener('click', function () {
      setZoom(state.draftCrop.scale + ZOOM_STEP);
    });

    $('crop-save').addEventListener('click', function () {
      state.crop = copyCrop(state.draftCrop);
      writeStore(STORE.liveCrop, state.crop);
      applyCropToPlayer();
      // Close straight away: the result is behind this dialog, and staying put
      // made it look as though nothing had happened.
      closeEditor();
      settingsSay('Player crop saved.', 'ok');
    });

    $('crop-reset').addEventListener('click', function () {
      state.draftCrop = copyCrop(DEFAULT_CROP);
      state.crop = copyCrop(DEFAULT_CROP);
      writeStore(STORE.liveCrop, state.crop);
      renderCropEditor();
      applyCropToPlayer();
      say('Reset to the whole page.');
    });

    $('crop-close').addEventListener('click', closeEditor);
    dialog.addEventListener('cancel', function (event) {
      event.preventDefault();
      closeEditor();
    });

    $('crop-open').addEventListener('click', function () {
      var source = activeStreamUrl();
      state.draftCrop = copyCrop(state.crop);
      say('');
      dialog.showModal();
      if (source) $('crop-frame').src = source;
      // Wait for layout so the stage has a measurable width.
      requestAnimationFrame(function () {
        requestAnimationFrame(renderCropEditor);
      });
    });

    window.addEventListener('resize', function () {
      if (dialog.open) renderCropEditor();
    });
  }

  /* ---------------------------------------------------------------- */
  /* first-run onboarding                                              */
  /* ---------------------------------------------------------------- */

  function reduceMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /* The footage scrubs with horizontal pointer movement rather than playing:
   * seeks are queued one at a time so a fast sweep cannot flood the decoder. */
  function initHeroVideo() {
    var video = $('onboard-video');
    if (!video || !HERO_VIDEO) return function () {};

    var ready = false;
    var target = 0;
    var seeking = false;
    var lastX = null;
    var lastMove = 0;

    function seek() {
      if (!ready || seeking) return;
      if (Math.abs(video.currentTime - target) < 0.02) return;
      seeking = true;
      try { video.currentTime = target; } catch (err) { seeking = false; }
    }

    video.addEventListener('seeked', function () { seeking = false; seek(); });

    video.addEventListener('loadeddata', function () {
      if (isFinite(video.duration) && video.duration > 0) {
        ready = true;
        video.classList.add('is-ready');
      }
    });

    video.addEventListener('error', function () {
      ready = false;
      video.classList.remove('is-ready');   // the gradient carries the screen
    });

    function onMove(event) {
      if (!ready) return;
      var x = event.clientX;
      if (lastX !== null) {
        var delta = (x - lastX) / window.innerWidth;
        target = clamp(target + delta * SCRUB_SENSITIVITY * video.duration, 0, video.duration);
        seek();
      }
      lastX = x;
      lastMove = Date.now();
    }

    window.addEventListener('pointermove', onMove, { passive: true });

    /* A touch screen has no hovering pointer, so with nothing to scrub the
     * scene drifts by itself instead of sitting frozen on one frame. */
    var drift = setInterval(function () {
      if (!ready || document.hidden || reduceMotion()) return;
      if (Date.now() - lastMove < 1800) return;
      target = target + 0.08 >= video.duration ? 0 : target + 0.08;
      seek();
    }, 110);

    video.src = HERO_VIDEO;
    try { video.load(); } catch (err) { /* nothing to do */ }

    return function stop() {
      clearInterval(drift);
      window.removeEventListener('pointermove', onMove);
      video.removeAttribute('src');
      try { video.load(); } catch (err) { /* nothing to do */ }
    };
  }

  function typewriter(node, text, speed, startDelay) {
    node.textContent = '';
    var caret = el('span', 'onboard__caret');
    node.appendChild(caret);

    if (reduceMotion()) {
      caret.remove();
      node.textContent = text;
      return function () {};
    }

    var index = 0;
    var timer = setTimeout(function tick() {
      if (index >= text.length) {
        caret.remove();
        return;
      }
      caret.insertAdjacentText('beforebegin', text.charAt(index));
      index += 1;
      timer = setTimeout(tick, speed);
    }, startDelay);

    return function () { clearTimeout(timer); };
  }

  function initOnboarding() {
    var panel = $('onboard');
    if (!panel) return;

    if (readStore(STORE.onboarded, false) === true) {
      panel.remove();
      return;
    }

    panel.hidden = false;
    document.body.style.overflow = 'hidden';

    var stopVideo = initHeroVideo();
    var stopTyping = typewriter($('onboard-type'), HERO_LINE, 38, 600);

    $('onboard-name').value = readStore(STORE.name, '') || '';
    $('onboard-downtime').value = readDowntime();

    function showPane(step) {
      var panes = panel.querySelectorAll('.onboard__pane');
      for (var i = 0; i < panes.length; i++) {
        panes[i].classList.toggle('is-active', panes[i].dataset.step === String(step));
      }
      var field = panel.querySelector('.onboard__pane.is-active .onboard__input');
      if (field) setTimeout(function () { field.focus(); }, 80);
    }

    var jumps = panel.querySelectorAll('[data-goto]');
    for (var j = 0; j < jumps.length; j++) {
      jumps[j].addEventListener('click', function (event) {
        showPane(event.currentTarget.dataset.goto);
      });
    }

    // Enter on the name field moves on rather than doing nothing.
    $('onboard-name').addEventListener('keydown', function (event) {
      if (event.key === 'Enter') { event.preventDefault(); showPane(2); }
    });

    function finish(save) {
      if (save) {
        writeStore(STORE.name, $('onboard-name').value.trim().slice(0, 32));
        var chosen = $('onboard-downtime').value;
        if (/^([01]\d|2[0-3]):[0-5]\d$/.test(chosen)) {
          writeStore(STORE.downtime, chosen);
          // If they set a time that has already gone by, don't greet them with
          // the wind-down notice the second setup finishes — start tomorrow.
          var passed = minutesNow() >= (Number(chosen.slice(0, 2)) * 60 + Number(chosen.slice(3)));
          writeStore(STORE.downtimeSeen, passed ? todayKey() : '');
        }
      }
      writeStore(STORE.onboarded, true);
      renderGreeting();
      updateDayProgress();

      stopTyping();
      stopVideo();
      document.body.style.overflow = '';
      panel.classList.add('is-leaving');
      setTimeout(function () { panel.remove(); }, 460);
    }

    $('onboard-finish').addEventListener('click', function () { finish(true); });
    $('onboard-skip').addEventListener('click', function () { finish(false); });
  }

  /* ---------------------------------------------------------------- */
  /* display screen                                                    */
  /* ---------------------------------------------------------------- */

  var screenState = { open: false, home: null, rotate: null, shown: [] };

  function screenIsOpen() { return screenState.open; }

  function shuffled(list) {
    var copy = list.slice();
    for (var i = copy.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var swap = copy[i]; copy[i] = copy[j]; copy[j] = swap;
    }
    return copy;
  }

  function renderScreenTape() {
    var track = $('screen-tape-track');
    if (!track) return;
    track.textContent = '';
    if (!state.lastTape.length) {
      track.appendChild(el('span', 'tape__loading', 'Market data unavailable right now.'));
      return;
    }
    track.appendChild(buildTapeGroup(state.lastTape, false));
    track.appendChild(buildTapeGroup(state.lastTape, true));
  }

  function renderScreenStocks() {
    var list = $('screen-stocks');
    if (!list) return;
    list.textContent = '';

    state.lastQuotes.forEach(function (quote) {
      var row = el('li', 'screen__stock');
      row.appendChild(el('span', 'screen__sym', quote.symbol));

      var figures = el('div', 'screen__figs');
      figures.appendChild(el('span', 'screen__last', formatPrice(quote.last, quote.symbol)));

      // Percentage only: the absolute change wrapped onto a third line in a
      // column this narrow, and percent is what carries at a glance.
      var dir = direction(quote);
      var pct = quote.changePct === null || quote.changePct === undefined
        ? 'Unchanged'
        : (dir.glyph ? dir.glyph + ' ' : '') + formatSigned(quote.changePct, 2) + '%';
      figures.appendChild(el('span', 'screen__chg ' + dir.klass, pct));
      row.appendChild(figures);

      list.appendChild(row);
    });
  }

  /* Three headlines at a time, swapped for three others on a timer, so the
   * screen keeps moving without anyone touching it. */
  function renderScreenHeadlines(fresh) {
    var list = $('screen-news');
    if (!list) return;

    if (fresh || !screenState.shown.length) {
      // Prefer stories that are not on screen already, so a rotation always
      // looks like something happened. Falls back to the whole list once the
      // feed is too short to avoid repeats.
      var showing = screenState.shown.map(function (item) { return item.id; });
      var unseen = state.lastNews.filter(function (item) {
        return showing.indexOf(item.id) === -1;
      });
      var pool = unseen.length >= 3 ? unseen : state.lastNews;
      screenState.shown = shuffled(pool).slice(0, 3);
    }

    list.textContent = '';
    $('screen-news-note').textContent = state.lastNewsLabel || '';

    if (!screenState.shown.length) {
      list.appendChild(el('li', 'screen__story', 'Headlines will appear once they load.'));
      return;
    }

    screenState.shown.forEach(function (item) {
      var story = el('li', 'screen__story');
      story.appendChild(el('p', 'screen__headline', item.title));
      var when = timeAgo(item.published);
      story.appendChild(el('span', 'screen__meta', when || 'CNBC'));
      list.appendChild(story);
    });
  }

  function renderScreenClock() {
    if (!screenState.open) return;
    var now = new Date();
    $('screen-time').textContent = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    $('screen-date').textContent = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

    var span = daySpan();
    var total = span.end - span.start;
    var progress = total > 0 ? clamp((minutesNow() - span.start) / total, 0, 1) : 1;
    $('screen-dayfill').style.width = (progress * 100) + '%';
    $('screen-dayorb').style.left = (progress * 100) + '%';

    var remaining = span.end - minutesNow();
    $('screen-remaining').textContent = remaining > 0
      ? formatDuration(remaining) + ' left'
      : 'Past downtime';
  }

  function renderScreen() {
    if (!screenState.open) return;
    renderScreenTape();
    renderScreenStocks();
    renderScreenHeadlines(false);
    renderScreenClock();
  }

  function openScreen() {
    var panel = $('screen');
    var player = $('live-player');
    if (!panel || screenState.open) return;

    // Move the live player rather than building a second one: the stream keeps
    // playing and the saved crop carries over untouched.
    screenState.home = { parent: player.parentNode, next: player.nextSibling };
    $('screen-player').appendChild(player);

    panel.hidden = false;
    screenState.open = true;
    document.body.style.overflow = 'hidden';

    renderScreen();
    renderScreenHeadlines(true);
    applyCropToPlayer();

    screenState.rotate = setInterval(function () {
      var stories = $('screen-news').querySelectorAll('.screen__story');
      for (var i = 0; i < stories.length; i++) stories[i].classList.add('is-out');
      setTimeout(function () { renderScreenHeadlines(true); }, 340);
    }, 14000);
  }

  function closeScreen() {
    var panel = $('screen');
    var player = $('live-player');
    if (!panel || !screenState.open) return;

    if (screenState.rotate) { clearInterval(screenState.rotate); screenState.rotate = null; }
    if (screenState.home) {
      screenState.home.parent.insertBefore(player, screenState.home.next);
      screenState.home = null;
    }

    panel.hidden = true;
    screenState.open = false;
    document.body.style.overflow = '';
    applyCropToPlayer();
    $('display-btn').focus();
  }

  function initScreen() {
    var button = $('display-btn');
    if (!button || !$('screen')) return;

    button.addEventListener('click', function () {
      if (screenState.open) closeScreen(); else openScreen();
    });
    $('screen-close').addEventListener('click', closeScreen);

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && screenState.open) {
        event.preventDefault();
        closeScreen();
        return;
      }
      if (event.key !== 'd' && event.key !== 'D') return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      var node = document.activeElement;
      if (node && /^(INPUT|TEXTAREA|SELECT)$/.test(node.tagName)) return;
      if ($('onboard')) return;
      if ($('settings').open || $('crop-editor').open || $('clock-dialog').open) return;
      event.preventDefault();
      if (screenState.open) closeScreen(); else openScreen();
    });
  }

  /* ---------------------------------------------------------------- */
  /* clock                                                             */
  /* ---------------------------------------------------------------- */

  function buildClockFace() {
    var marks = $('clock-marks');
    if (!marks || marks.childElementCount) return;

    for (var i = 0; i < 60; i++) {
      var angle = (i * 6 * Math.PI) / 180;
      if (i % 5 === 0) {
        var hour = i / 5;
        var number = el('div', 'clock__num', String(hour === 0 ? 12 : hour));
        number.style.left = (50 + Math.sin(angle) * 38) + '%';
        number.style.top = (50 - Math.cos(angle) * 38) + '%';
        marks.appendChild(number);
      } else {
        var tick = el('div', 'clock__tick');
        tick.style.transform = 'rotate(' + (i * 6) + 'deg)';
        marks.appendChild(tick);
      }
    }
  }

  function initClock() {
    var dialog = $('clock-dialog');
    var button = $('clock-btn');
    if (!dialog || !button || typeof dialog.showModal !== 'function') return;

    var frame = null;

    function paint() {
      var now = new Date();
      var ms = now.getMilliseconds();
      var seconds = now.getSeconds() + ms / 1000;
      var minutes = now.getMinutes() + seconds / 60;
      var hours = (now.getHours() % 12) + minutes / 60;

      $('clock-hour').style.transform = 'rotate(' + (hours * 30) + 'deg)';
      $('clock-minute').style.transform = 'rotate(' + (minutes * 6) + 'deg)';
      $('clock-second').style.transform = 'rotate(' + (seconds * 6) + 'deg)';

      $('clock-digital').textContent = now.toLocaleTimeString('en-US', {
        hour: 'numeric', minute: '2-digit', second: '2-digit'
      });
      $('clock-date').textContent = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      $('clock-brand').textContent = CLOCK_BRAND;

      var zone = '';
      try {
        zone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      } catch (err) { /* older engines */ }
      $('clock-zone').textContent = zone ? zone.split('/').pop().replace(/_/g, ' ') : 'Local';

      frame = requestAnimationFrame(paint);
    }

    function open() {
      buildClockFace();
      dialog.showModal();
      if (frame === null) paint();
    }

    function close() {
      if (frame !== null) { cancelAnimationFrame(frame); frame = null; }
      dialog.close();
      button.focus();
    }

    button.addEventListener('click', function () {
      if (dialog.open) close(); else open();
    });
    $('clock-close').addEventListener('click', close);
    dialog.addEventListener('cancel', function (event) {
      event.preventDefault();
      close();
    });

    document.addEventListener('keydown', function (event) {
      if (event.key !== 'c' && event.key !== 'C') return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      var node = document.activeElement;
      if (node && /^(INPUT|TEXTAREA|SELECT)$/.test(node.tagName)) return;
      if ($('onboard')) return;                       // not during first run
      if ($('settings').open || $('crop-editor').open) return;
      if (screenIsOpen()) return;
      event.preventDefault();
      if (dialog.open) close(); else open();
    });
  }

  /* ---------------------------------------------------------------- */
  /* settings                                                          */
  /* ---------------------------------------------------------------- */

  function openSettings(focusId) {
    var dialog = $('settings');
    if (!dialog || typeof dialog.showModal !== 'function' || dialog.open) return;

    $('name-input').value = readStore(STORE.name, '') || '';
    $('downtime-input').value = readDowntime();
    $('stream-source').value = storedStreamUrl();
    settingsSay('');

    dialog.showModal();
    var target = $(focusId || 'name-input');
    if (target) target.focus();
  }

  function settingsSay(text, tone) {
    var message = $('settings-msg');
    if (!message) return;
    message.textContent = text || '';
    if (tone) message.setAttribute('data-tone', tone);
    else message.removeAttribute('data-tone');
  }

  /* Player controls that live on the dashboard rather than in the editor:
   * a lock so the embedded page cannot be scrolled by accident, and zoom in
   * and out without opening Settings at all. */
  function initLiveControls() {
    var player = $('live-player');
    var lock = $('live-lock');
    if (!player || !lock) return;

    function setLocked(locked) {
      player.classList.toggle('is-unlocked', !locked);
      lock.setAttribute('aria-pressed', String(locked));
      lock.textContent = locked ? 'Locked' : 'Unlocked';
      lock.setAttribute('title', locked
        ? 'Taps and scrolls go to the dashboard, not the embedded page.'
        : 'The embedded page takes taps and scrolls. Lock it to protect the crop.');
    }

    lock.addEventListener('click', function () {
      setLocked(player.classList.contains('is-unlocked'));
    });

    // Unlocking from the shield itself keeps it to two taps — one to enable,
    // one to press play — rather than sending anyone up to the header first.
    var shield = $('live-shield');
    if (shield) shield.addEventListener('click', function () { setLocked(false); });

    function nudgeZoom(by) {
      state.crop = sanitizeCrop({
        scale: state.crop.scale + by,
        offsetX: state.crop.offsetX, offsetY: state.crop.offsetY,
        cropX: state.crop.cropX, cropY: state.crop.cropY,
        cropW: state.crop.cropW, cropH: state.crop.cropH
      });
      writeStore(STORE.liveCrop, state.crop);
      applyCropToPlayer();
    }

    $('live-zoom-out').addEventListener('click', function () { nudgeZoom(-LIVE_ZOOM_STEP); });
    $('live-zoom-in').addEventListener('click', function () { nudgeZoom(LIVE_ZOOM_STEP); });
  }

  function initSettings() {
    var dialog = $('settings');
    var openBtn = $('settings-btn');
    if (!dialog || !openBtn || typeof dialog.showModal !== 'function') return;

    openBtn.addEventListener('click', function () { openSettings(); });

    function close() {
      dialog.close();
      openBtn.focus();
    }
    $('settings-close').addEventListener('click', close);

    $('settings-save').addEventListener('click', function () {
      // Stream is validated first: a bad address should not silently discard
      // the rest of the form.
      var stream = normalizeStreamUrl($('stream-source').value);
      if (!stream.ok) {
        settingsSay(stream.reason, 'error');
        $('stream-source').focus();
        return;
      }

      var name = $('name-input').value.trim().slice(0, 32);
      writeStore(STORE.name, name);
      renderGreeting();

      var previousDowntime = readDowntime();
      var downtime = $('downtime-input').value;
      if (/^([01]\d|2[0-3]):[0-5]\d$/.test(downtime)) {
        writeStore(STORE.downtime, downtime);
        // A changed downtime makes today's notice eligible again.
        if (downtime !== previousDowntime) writeStore(STORE.downtimeSeen, '');
      }
      updateDayProgress();

      writeStore(STORE.stream, stream.url);
      initLivePlayer();

      var note = 'Saved.';
      if (stream.url && stream.fromEmbed) note = 'Saved. Using the address from that embed code.';
      else if (!stream.url) note = 'Saved. The player is back on the default stream.';
      settingsSay(note, 'ok');
    });

    $('stream-reset').addEventListener('click', function () {
      $('stream-source').value = '';
      writeStore(STORE.stream, '');
      initLivePlayer();
      settingsSay('Back to the default stream.');
    });
  }

  /* ---------------------------------------------------------------- */
  /* start                                                             */
  /* ---------------------------------------------------------------- */

  function tick() {
    $('clock').textContent = clockText();
    updateDayProgress();
    renderScreenClock();
    maybeShowDowntimeNotice();
  }

  function start() {
    state.crop = sanitizeCrop(readStore(STORE.liveCrop, null));
    state.draftCrop = copyCrop(state.crop);

    renderGreeting();
    initOnboarding();
    initClock();
    initScreen();
    initAppearance();
    initAdder();
    initSettings();
    initLiveControls();
    initCropEditor();
    initDowntimeNotice();
    initLivePlayer();

    tick();
    setInterval(tick, CLOCK_INTERVAL);

    $('refresh-btn').addEventListener('click', refreshAll);

    loadQuotes();
    loadNews();

    // Only poll while the page is actually being looked at.
    setInterval(function () {
      if (document.visibilityState === 'visible') loadQuotes();
    }, QUOTE_INTERVAL);

    setInterval(function () {
      if (document.visibilityState === 'visible') loadNews();
    }, NEWS_INTERVAL);

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') {
        tick();
        refreshAll();
      }
    });

    // The player's box changes with orientation and the text-size control.
    if (window.ResizeObserver) {
      new ResizeObserver(applyCropToPlayer).observe($('live-player'));
    } else {
      window.addEventListener('resize', applyCropToPlayer);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
