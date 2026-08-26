/* Stubs global fetch with realistic CNBC payloads so the UI and the parsing
 * layer can be exercised without touching the network. Shapes match the
 * responses documented by the ycnbc library. */

function quote(symbol, name, last, change, pct, extra = {}) {
  return {
    symbol, name, shortName: name,
    last, change, change_pct: pct,
    previous_day_closing: last, open: last, high: last, low: last,
    volume: '52,341,200', currencyCode: 'USD', curmktstatus: 'REG_MKT',
    last_timedate: '8:04 PM EDT', ...extra,
  };
}

const QUOTES = {
  '.DJI': quote('.DJI', 'Dow Jones Industrial Average', '44,102.56', '186.34', '0.42%'),
  '.SPX': quote('.SPX', 'S&P 500 Index', '6,012.18', '-18.91', '-0.31%'),
  '.IXIC': quote('.IXIC', 'NASDAQ Composite', '19,884.02', '92.10', '0.47%'),
  '.RUT': quote('.RUT', 'Russell 2000', '2,284.71', 'UNCH', 'UNCH'),
  '.VIX': quote('.VIX', 'CBOE Volatility Index', '14.62', '-0.38', '-2.53%'),
  'US10Y': quote('US10Y', 'U.S. 10 Year Treasury', '4.281', '0.024', '0.56%'),
  '@CL.1': quote('@CL.1', 'Crude Oil Futures', '71.44', '-0.63', '-0.87%'),
  '@GC.1': quote('@GC.1', 'Gold Futures', '2,614.30', '11.80', '0.45%'),
  'BTC.CM=': quote('BTC.CM=', 'Bitcoin USD', '97,412.55', '1,204.11', '1.25%'),
  'EUR=': quote('EUR=', 'Euro/US Dollar', '0.9184', '-0.0012', '-0.13%'),
  AAPL: quote('AAPL', 'Apple Inc.', '232.14', '1.84', '0.80%', {
    ExtendedMktQuote: { type: 'POST_MKT', last: '232.90', change: '0.76', change_pct: '0.33%' },
  }),
  MSFT: quote('MSFT', 'Microsoft Corp.', '441.06', '-3.22', '-0.72%'),
  NVDA: quote('NVDA', 'NVIDIA Corp.', '138.25', '4.11', '3.06%'),
  AMZN: quote('AMZN', 'Amazon.com Inc.', '228.90', '0.44', '0.19%'),
  GOOGL: quote('GOOGL', 'Alphabet Inc.', '191.33', '-1.07', '-0.56%'),
  JPM: quote('JPM', 'JPMorgan Chase & Co.', '248.71', '2.05', '0.83%'),
  JNJ: quote('JNJ', 'Johnson & Johnson', '146.02', 'UNCH', 'UNCH'),
  KO: quote('KO', 'Coca-Cola Co.', '62.88', '-0.31', '-0.49%'),
};

const HEADLINES = [
  ['Fed holds rates steady but signals two cuts next year', 'The central bank left its benchmark rate unchanged & pointed to a slower path of easing.', 12],
  ['Nvidia tops estimates as data-center revenue climbs 94%', 'Shares rose in extended trading after the chipmaker beat on the top and bottom line.', 47],
  ['Oil slips as OPEC+ weighs an output increase', 'Brent crude fell for a third session on signs the group may add barrels in the spring.', 96],
  ['Retail sales rise more than expected in August', 'Consumers kept spending despite higher borrowing costs, the Commerce Department said.', 180],
  ['Housing starts fall to a four-month low', 'Builders pulled back as mortgage rates hovered near 6.5%.', 320],
  ['Boeing wins a 40-plane order from a European carrier', 'The deal is the planemaker’s largest since the start of the year.', 600],
];

function rss() {
  const items = HEADLINES.map(([title, summary, minsAgo], i) => {
    const when = new Date(Date.now() - minsAgo * 60000).toUTCString();
    return `<item>
      <title><![CDATA[${title}]]></title>
      <link>https://www.cnbc.com/2026/08/26/story-${i}.html</link>
      <description><![CDATA[<p>${summary}</p>]]></description>
      <pubDate>${when}</pubDate>
      <guid isPermaLink="false">10000${i}</guid>
    </item>`;
  }).join('');
  return `<?xml version="1.0" encoding="utf-8"?><rss version="2.0"><channel><title>CNBC</title>${items}</channel></rss>`;
}

export function installMockFetch() {
  globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.includes('quote.cnbc.com')) {
      const symbols = decodeURIComponent(new URL(href).searchParams.get('symbols') || '').split('|');
      const found = symbols.map((s) => QUOTES[s]).filter(Boolean);
      return new Response(
        JSON.stringify({ FormattedQuoteResult: { FormattedQuote: found } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (href.includes('cnbc.com/id/')) {
      return new Response(rss(), { status: 200, headers: { 'content-type': 'text/xml' } });
    }
    return new Response('not found', { status: 404 });
  };
}
