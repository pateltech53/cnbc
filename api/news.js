const { getNews, FEEDS } = require('./_lib/cnbc.js');

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=600');

  const url = new URL(req.url, 'http://localhost');
  const category = url.searchParams.get('category') || 'top';
  const limit = url.searchParams.get('limit') || 30;

  try {
    const result = await getNews(category, limit);
    res.statusCode = 200;
    res.end(
      JSON.stringify({
        ok: true,
        updated: new Date().toISOString(),
        categories: Object.entries(FEEDS).map(([slug, f]) => ({ slug, label: f.label })),
        ...result,
      }),
    );
  } catch (error) {
    res.statusCode = 502;
    res.end(JSON.stringify({ ok: false, error: error.message, items: [], warnings: [] }));
  }
};
