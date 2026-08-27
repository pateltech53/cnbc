# CNBC Daily

A simple, readable dashboard of CNBC headlines and stock prices. Built to be
handed to someone who just wants to glance at the markets and the news — big
type, plain words, a text-size control, and a dark mode.

Two ways to run it:

| | What it is | Best for |
|---|---|---|
| **Website** | Static page + two serverless functions, deploys to Vercel | Sharing a link — nothing to install |
| **`dist/CNBC-App.zip`** | One Python file that runs a local copy | Handing someone a file to keep |

## What it shows

- A scrolling ticker of the major indices, treasuries, oil, gold and bitcoin.
- **My stocks** — an editable watchlist, saved in the browser on that device.
  Type a symbol, press Add; press × to remove one.
- **News** — CNBC headlines across 13 categories, newest first.
- Controls for text size (A / A / A) and light or dark screen.

## Deploy the website to Vercel

The repo is already laid out the way Vercel expects — no framework, no build
step.

```bash
npm i -g vercel     # once
vercel              # preview deploy
vercel --prod       # live
```

Or from the Vercel dashboard: **Add New → Project**, import this repo, and
deploy with the default settings. Leave the framework preset on **Other**;
`public/` is served statically and `api/*.js` become serverless functions.

## Run it locally

```bash
npm run dev                # http://localhost:3000
MOCK=1 npm run dev         # same, with fixture data instead of live CNBC
```

Node 20 or newer. There are no dependencies to install.

## Build the shareable file

```bash
npm run build:standalone
```

Writes `dist/CNBC-App.py` (one self-contained file — the whole front end is
embedded in it) and `dist/CNBC-App.zip`, which adds double-click launchers for
Mac and Windows and a plain-English README. Send someone the zip; they unzip
it and double-click. It needs Python 3.7+ and nothing else.

To change the app, edit the sources in `public/` and
`standalone/server_template.py`, then rebuild — never edit `dist/CNBC-App.py`
by hand, it is generated.

## Where the data comes from

Both CNBC endpoints are the ones cnbc.com's own front end calls. The parameters
came from [`ycnbc`](https://github.com/codestorm-official/ycnbc) (Apache-2.0).

| Purpose | Endpoint |
|---|---|
| Quotes | `quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol` |
| News | `www.cnbc.com/id/<feedId>/device/rss/rss.html` |

This app talks to those endpoints directly rather than depending on `ycnbc`
itself: `ycnbc` is a Python library that scrapes CNBC's HTML with `curl_cffi`
and `lxml`, which breaks whenever CNBC changes a CSS class and is awkward to
run on Vercel. The RSS feeds are a documented, stable format and need no
dependencies at all.

If a symbol comes back empty, the app retries it against Stooq for an
end-of-day price and labels those rows "End-of-day backup price", so one dead
provider does not blank the page.

## When something stops working

```bash
npm run check
```

Tests the quote service and all 13 feeds and prints what each returned,
including how old each feed's newest story is. A feed that answers but has not
been published to in days is the failure mode to watch for — the tab fills with
months-old stories rather than showing an error.

**Known:** as of the last check, `markets` (id `20409666`) is stale — CNBC
answers on it but its newest story was weeks old, while `top` was minutes old.
Run the check to see the current state.

The feed IDs live in `api/_lib/cnbc.js` (`FEEDS`) and are mirrored in
`standalone/server_template.py`. Change one, change both, then rebuild.

## Watching CNBC live

The sidebar embeds a live player, with links to CNBC's own live TV page and
its "where to watch" page underneath.

Out of the box it points at CNBC's official YouTube stream. To show something
else, open **Settings** (the gear in the header) and paste an address into
**Live stream**. It is saved in the browser on that device, so each person can
set their own; "Use the default" clears it. Only `https://` and `http://`
addresses are accepted — anything else is rejected rather than handed to the
iframe. Many sites send `X-Frame-Options` or a `frame-ancestors` policy that
forbids embedding; those will show a blank panel however valid the address is.

The built-in default lives in one constant, `LIVE_CHANNEL_ID` at the top of
`public/app.js`. YouTube's `live_stream` embed takes a channel id rather than
an `@handle`, so that is what the constant holds.

## Layout

```
public/            index.html, styles.css, app.js — the whole front end
api/               quotes.js, news.js — Vercel serverless functions
api/_lib/cnbc.js   shared: quote fetching, RSS parsing, feed list
standalone/        server_template.py — the local Python server
tools/             dev server, standalone build, endpoint checker, fixtures
dist/              generated: CNBC-App.py and CNBC-App.zip
```

## Notes

Not affiliated with, endorsed by, or vetted by CNBC. Prices may be delayed and
are not suitable for trading decisions. Headlines and prices remain the
property of CNBC and its licensors.
