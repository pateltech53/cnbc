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

  var QUOTE_INTERVAL = 30000;   // 30 seconds
  var NEWS_INTERVAL = 300000;   // 5 minutes

  var STORE = {
    watchlist: 'cnbcdaily.watchlist',
    theme: 'cnbcdaily.theme',
    size: 'cnbcdaily.size',
    category: 'cnbcdaily.category',
    stream: 'cnbcdaily.stream'
  };

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
    return new Date().toLocaleString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit'
    });
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
    lastQuoteOk: null,
    lastNewsOk: null
  };

  if (!Array.isArray(state.watchlist) || !state.watchlist.length) {
    state.watchlist = DEFAULT_WATCHLIST.slice();
  }

  /* ---------------------------------------------------------------- */
  /* appearance: theme and text size                                   */
  /* ---------------------------------------------------------------- */

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    var button = $('theme-btn');
    button.setAttribute('aria-pressed', String(theme === 'dark'));
    $('theme-label').textContent = theme === 'dark' ? 'Light' : 'Dark';
    writeStore(STORE.theme, theme);
  }

  var SIZES = { 1: '17px', 2: '19.5px', 3: '22px' };

  function applySize(step) {
    var key = SIZES[step] ? step : 1;
    document.documentElement.style.setProperty('--step', SIZES[key]);
    var buttons = document.querySelectorAll('.sizer__btn');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].setAttribute('aria-pressed', String(Number(buttons[i].dataset.size) === Number(key)));
    }
    writeStore(STORE.size, key);
  }

  function initAppearance() {
    var savedTheme = readStore(STORE.theme, null);
    var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(savedTheme || (prefersDark ? 'dark' : 'light'));
    applySize(readStore(STORE.size, 1));

    $('theme-btn').addEventListener('click', function () {
      var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      applyTheme(next);
    });

    var buttons = document.querySelectorAll('.sizer__btn');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].addEventListener('click', function (event) {
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

      var figures = el('div', 'quote__figures');
      figures.appendChild(el('span', 'quote__price', formatPrice(quote.last, quote.symbol)));
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
      renderTape(tape.quotes || []);
    } catch (err) {
      state.lastQuoteOk = false;
    }

    try {
      var mine = await getJSON('/api/quotes?symbols=' + encodeURIComponent(state.watchlist.join('|')));
      renderWatchlist(mine.quotes || []);
      var note = (mine.quotes && mine.quotes.length && mine.quotes[0].marketStatus) || '';
      $('watchlist-note').textContent = note;
      state.lastQuoteOk = true;
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
      renderStories(data.items || []);
      $('news-note').textContent = data.label || '';
      state.lastNewsOk = true;
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
  /* start                                                             */
  /* ---------------------------------------------------------------- */

  /* ---------------------------------------------------------------- */
  /* live player and its setting                                       */
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

  /* The stream loads only once the page is running, so a slow response from
   * whatever is embedded never holds up the prices and headlines. */
  function initLivePlayer() {
    var frame = $('live-frame');
    if (!frame) return;

    var custom = storedStreamUrl();
    var source = custom || (LIVE_CHANNEL_ID ? defaultStreamUrl() : '');
    if (!source) return;

    frame.src = source;

    var note = $('live-note');
    if (note && custom) {
      note.textContent = 'Showing the stream set in Settings. If the panel is ' +
        'blank, that site does not allow being embedded.';
    }
  }

  function initSettings() {
    var dialog = $('settings');
    var openBtn = $('settings-btn');
    if (!dialog || !openBtn || typeof dialog.showModal !== 'function') return;

    var input = $('stream-source');
    var message = $('stream-msg');

    function say(text, tone) {
      message.textContent = text || '';
      if (tone) message.setAttribute('data-tone', tone);
      else message.removeAttribute('data-tone');
    }

    openBtn.addEventListener('click', function () {
      input.value = storedStreamUrl();
      say('');
      dialog.showModal();
      input.focus();
    });

    function close() {
      dialog.close();
      openBtn.focus();
    }

    $('settings-close').addEventListener('click', close);

    $('settings-save').addEventListener('click', function () {
      var result = normalizeStreamUrl(input.value);
      if (!result.ok) {
        say(result.reason, 'error');
        return;
      }
      writeStore(STORE.stream, result.url);
      initLivePlayer();
      if (!result.url) {
        say('Saved. Back to the default stream.');
      } else if (result.fromEmbed) {
        say('Saved. Using the address from that embed code.');
      } else {
        say('Saved. The panel now shows your stream.');
      }
    });

    $('stream-reset').addEventListener('click', function () {
      input.value = '';
      writeStore(STORE.stream, '');
      var note = $('live-note');
      if (note) {
        note.textContent = "The player shows CNBC's stream when the channel is live. " +
          'If it is blank, CNBC is off air on that channel right now — use a link below.';
      }
      initLivePlayer();
      say('Back to the default stream.');
    });
  }

  function start() {
    initAppearance();
    initAdder();
    initSettings();
    initLivePlayer();

    $('clock').textContent = clockText();
    setInterval(function () { $('clock').textContent = clockText(); }, 30000);

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
      if (document.visibilityState === 'visible') refreshAll();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
