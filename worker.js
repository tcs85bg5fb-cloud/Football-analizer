const SOURCES = [
  {
    season: '2025/26',
    file: '/E0_2025-26.csv'
  },
  {
    season: '2026/27',
    file: '/E0_2026-27.csv'
  }
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Test: sprawdza, czy żądanie trafia do Workera
    if (url.pathname === '/api/test') {
      return new Response('WORKER OK', {
        status: 200,
        headers: {
          'content-type': 'text/plain; charset=utf-8'
        }
      });
    }

    // Dane meczowe są przechowywane lokalnie jako Static Assets.
    // Dzięki temu aplikacja nie zależy od chwilowej dostępności Football-Data.
    if (url.pathname === '/api/data') {
      const cache = caches.default;
      const cacheKey = new Request(url.toString(), request);

      const cached = await cache.match(cacheKey);
      if (cached) {
        return cached;
      }

      try {
        const results = await Promise.all(
          SOURCES.map(async (s) => {
            const assetUrl = new URL(s.file, request.url);
            const assetRequest = new Request(assetUrl.toString(), {
              method: 'GET'
            });

            const r = await env.ASSETS.fetch(assetRequest);

            if (!r.ok) {
              throw new Error(`Local asset HTTP ${r.status} for ${s.season}`);
            }

            return {
              season: s.season,
              csv: await r.text()
            };
          })
        );

        const body = JSON.stringify({
          fetchedAt: new Date().toISOString(),
          source: 'local-static-assets',
          sources: results
        });

        const response = new Response(body, {
          status: 200,
          headers: {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'public, max-age=86400, s-maxage=86400',
            'access-control-allow-origin': '*'
          }
        });

        await cache.put(cacheKey, response.clone());
        return response;
      } catch (e) {
        return new Response(
          JSON.stringify({
            error: String(e.message || e)
          }),
          {
            status: 502,
            headers: {
              'content-type': 'application/json; charset=utf-8',
              'access-control-allow-origin': '*'
            }
          }
        );
      }
    }

    return env.ASSETS.fetch(request);
  }
};
