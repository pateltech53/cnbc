# CNBC Daily

A simple, readable dashboard of CNBC headlines and stock prices. Built to be
handed to someone who just wants to glance at the markets and the news — big
type, plain words, a text-size control, and a dark mode.

Two ways to run it:

| | What it is | Best for |
|---|---|---|
| **Website** | Static page + two serverless functions, deploys to Vercel | Sharing a link — nothing to install |
| **`dist/CNBC-App.zip`** | One Python file that runs a local copy | Handing someone a file to keep |

Built for a dedicated iPad: large type by default, touch-sized controls,
Playfair Display for the editorial voice and Archivo for the numbers.

## First run

The first time it opens, a full-screen setup asks for a name and a downtime,
then drops you into the dashboard. Its background footage scrubs with
horizontal pointer movement rather than playing, and drifts slowly by itself
when nothing has moved — a touch screen has no hovering pointer. If the video
will not load, the gradient behind it stands in and setup carries on unchanged.
The clip is one constant, `HERO_VIDEO` in `public/app.js`.

Setup is remembered under `cnbcdaily.onboarded`. Clear that key to see it again.

## Display screen

The screen icon, or pressing **D**, opens a single ambient view to leave
running beside other work: the market ticker across the top, a clock and the
sun dial beside it, the watchlist down one side, the live player in the middle
and three headlines that swap for three others every 14 seconds. **Esc** or
**D** leaves it.

The live player is *moved* into this view rather than duplicated, so the stream
keeps playing and the saved crop carries over untouched.

## Clock

The clock icon in the header, or pressing **C**, opens an analogue face with a
sweeping second hand and a large digital readout, in this device's timezone.
`C` is ignored while you are typing or while another dialog is open.

## What it shows

- **Welcome, [name]** — set your name under Settings → Personal; it defaults to
  "Dad" and is remembered on that device.
- **Day progress** — a sun travelling from the start of the day toward your
  downtime, with the time remaining. When downtime arrives a notice appears
  once; dismissing it stamps the date, so it stays gone until tomorrow.
- A scrolling ticker of the major indices, treasuries, oil, gold and bitcoin.
- **My stocks** — an editable watchlist, saved in the browser on that device.
  Type a symbol, press Add; press × to remove one.
- **CNBC live** — an embedded player you can crop visually (see below).
- **News** — CNBC headlines across 13 categories, newest first.
- Settings holds theme and text size; the default size is already sized for a
  tablet at arm's length.

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
else, open **Settings** (the gear in the header) and paste into **Live
stream** — either a plain address or the whole `<iframe …>` embed code a site
hands you. It is saved in the browser on that device, so each person can set
their own; "Use the default" clears it.

Only the `src` is taken out of a pasted snippet; `width`, `style`,
`allowfullscreen` and everything else are discarded, since the panel sizes its
own frame. The snippet is parsed with `DOMParser` into an inert document and is
never inserted into the page as markup, so nothing in a pasted block executes
or loads. The extracted address still has to be `https://` or `http://` —
`javascript:` and `data:` are refused.

Many sites send `X-Frame-Options` or a `frame-ancestors` policy that forbids
embedding; those show a blank panel however valid the address is.

The player is **locked** by default: taps and scrolls land on the dashboard
rather than inside the embedded page, so the crop cannot be dragged out of
frame by accident. Press **Unlocked** in the panel header when you want to use
the player's own controls. The **−** and **+** beside it zoom without opening
Settings at all.

### Cropping the player

Most live-stream pages wrap the video in a page full of other content. Settings
→ CNBC live → **Player crop…** opens a visual editor: drag the page to move it,
drag the eight handles to resize the window, and use the zoom slider. Everything
outside the bright rectangle is dimmed, and what is inside is exactly what the
dashboard shows.

This happens entirely in the parent page. The iframe stays an ordinary iframe —
a viewport clips it, the crop layer is offset, and the iframe is scaled with a
CSS transform. Nothing reads or touches the cross-origin document, and no
access control is bypassed. A transparent shield over the preview captures the
drags so they never reach the embedded page.

The crop is stored under `cnbcdaily.liveCrop` as fractions of a virtual 16:9
stage — position, size and zoom — so it keeps meaning the same thing whatever
size the player is drawn at. **Reset** restores the whole page.

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
