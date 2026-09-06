const SOURCES = [
  { season: '2025/26', url: 'https://www.football-data.co.uk/mmz4281/2526/E0.csv' },
  { season: '2026/27', url: 'https://www.football-data.co.uk/mmz4281/2627/E0.csv' },
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/data') {
      const cache = caches.default;
      const cacheKey = new Request(url.toString(), request);
      const cached = await cache.match(cacheKey);
      if (cached) return cached;

      try {
        const results = await Promise.all(SOURCES.map(async s => {
          const r = await fetch(s.url, { cf: { cacheTtl: 86400, cacheEverything: true } });
          if (!r.ok) throw new Error(`Football-Data HTTP ${r.status}`);
          return { season: s.season, csv: await r.text() };
        }));
        const body = JSON.stringify({ fetchedAt: new Date().toISOString(), sources: results });
        const response = new Response(body, {
          headers: {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'public, max-age=86400, s-maxage=86400',
            'access-control-allow-origin': '*',
          }
        });
        await cache.put(cacheKey, response.clone());
        return response;
      } catch (e) {
        return new Response(JSON.stringify({ error: String(e.message || e) }), {
          status: 502,
          headers: { 'content-type': 'application/json; charset=utf-8' }
        });
      }
    }

    return env.ASSETS.fetch(request);
  }
};
