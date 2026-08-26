const { getQuotes, TAPE, DEFAULT_WATCHLIST } = require('./_lib/cnbc.js');

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  // Quotes move constantly; a short shared cache keeps CNBC from seeing one
  // request per reader while the page still feels live.
  res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=60');

  const url = new URL(req.url, 'http://localhost');
  const requested =
    url.searchParams.get('symbols') ||
    (url.searchParams.get('set') === 'tape'
      ? TAPE.map((t) => t.symbol).join('|')
      : DEFAULT_WATCHLIST.join('|'));

  try {
    const { quotes, warnings } = await getQuotes(requested);
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true, updated: new Date().toISOString(), quotes, warnings }));
  } catch (error) {
    res.statusCode = 502;
    res.end(JSON.stringify({ ok: false, error: error.message, quotes: [], warnings: [] }));
  }
};
