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

const IMPORT_TOKEN = 'FA-IMPORT-2026-09';

function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let insideQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (insideQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        insideQuotes = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      insideQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  if (!rows.length) {
    return [];
  }

  const headers = rows[0].map((h) => h.trim());

  return rows
    .slice(1)
    .filter((r) => r.some((v) => String(v || '').trim() !== ''))
    .map((r) => {
      const obj = {};

      headers.forEach((header, index) => {
        obj[header] = r[index] ?? '';
      });

      return obj;
    });
}

function clean(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const text = String(value).trim();

  return text === '' ? null : text;
}

function numberOrNull(value) {
  const v = clean(value);

  if (v === null) {
    return null;
  }

  const n = Number(v);

  return Number.isFinite(n) ? n : null;
}

function integerOrNull(value) {
  const n = numberOrNull(value);

  return n === null ? null : Math.round(n);
}

function dateToISO(value) {
  const v = clean(value);

  if (!v) {
    return null;
  }

  const parts = v.split('/');

  if (parts.length === 3) {
    const [day, month, year] = parts;

    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  return v;
}

function buildRawData(row) {
  return JSON.stringify(row);
}

function buildOdds(row) {
  const odds = {};

  for (const [key, value] of Object.entries(row)) {
    if (
      key.startsWith('B365') ||
      key.startsWith('BFD') ||
      key.startsWith('BMGM') ||
      key.startsWith('BV') ||
      key.startsWith('BW') ||
      key.startsWith('CL') ||
      key.startsWith('LB') ||
      key.startsWith('PS') ||
      key.startsWith('Max') ||
      key.startsWith('Avg') ||
      key.startsWith('BFE') ||
      key.startsWith('P') ||
      key.startsWith('SKB')
    ) {
      const cleaned = clean(value);

      if (cleaned !== null) {
        odds[key] = numberOrNull(cleaned);
      }
    }
  }

  return JSON.stringify(odds);
}

async function importSource(env, source) {
  const assetUrl = new URL(source.file, 'https://football-analyzer.local');

  const assetRequest = new Request(assetUrl.toString(), {
    method: 'GET'
  });

  const response = await env.ASSETS.fetch(assetRequest);

  if (!response.ok) {
    throw new Error(
      `Nie można odczytać ${source.file}: HTTP ${response.status}`
    );
  }

  const csv = await response.text();
  const rows = parseCSV(csv);

  if (!rows.length) {
    throw new Error(`Brak danych w ${source.file}`);
  }

  const leagueName = 'Premier League';
  const leagueCountry = 'England';
  const leagueCode = 'E0';
  const sourceName = 'football-data';

  // ---------------------------------------------------------
  // LEAGUE
  // ---------------------------------------------------------

  await env.DB
    .prepare(`
      INSERT OR IGNORE INTO leagues
      (name, country, code, source)
      VALUES (?, ?, ?, ?)
    `)
    .bind(
      leagueName,
      leagueCountry,
      leagueCode,
      sourceName
    )
    .run();

  const league = await env.DB
    .prepare(`
      SELECT id
      FROM leagues
      WHERE source = ? AND code = ?
    `)
    .bind(sourceName, leagueCode)
    .first();

  if (!league) {
    throw new Error('Nie udało się znaleźć ligi po utworzeniu.');
  }

  // ---------------------------------------------------------
  // SEASON
  // ---------------------------------------------------------

  const [startYear, endYear] = source.season
    .split('/')
    .map(Number);

  await env.DB
    .prepare(`
      INSERT OR IGNORE INTO seasons
      (league_id, name, start_year, end_year, source)
      VALUES (?, ?, ?, ?, ?)
    `)
    .bind(
      league.id,
      source.season,
      startYear,
      2000 + endYear,
      sourceName
    )
    .run();

  const season = await env.DB
    .prepare(`
      SELECT id
      FROM seasons
      WHERE league_id = ? AND name = ?
    `)
    .bind(
      league.id,
      source.season
    )
    .first();

  if (!season) {
    throw new Error(
      `Nie udało się znaleźć sezonu ${source.season}.`
    );
  }

  // ---------------------------------------------------------
  // UNIQUE TEAMS
  // ---------------------------------------------------------

  const teamNames = [
    ...new Set(
      rows
        .flatMap((r) => [
          clean(r.HomeTeam),
          clean(r.AwayTeam)
        ])
        .filter(Boolean)
    )
  ];

  const teamStatements = teamNames.map((team) =>
    env.DB
      .prepare(`
        INSERT OR IGNORE INTO teams
        (name, country, source, source_name)
        VALUES (?, ?, ?, ?)
      `)
      .bind(
        team,
        'England',
        sourceName,
        team
      )
  );

  for (let i = 0; i < teamStatements.length; i += 100) {
    await env.DB.batch(
      teamStatements.slice(i, i + 100)
    );
  }

  // ---------------------------------------------------------
  // UNIQUE REFEREES
  // ---------------------------------------------------------

  const refereeNames = [
    ...new Set(
      rows
        .map((r) => clean(r.Referee))
        .filter(Boolean)
    )
  ];

  const refereeStatements = refereeNames.map((referee) =>
    env.DB
      .prepare(`
        INSERT OR IGNORE INTO referees
        (name, country, source, source_name)
        VALUES (?, ?, ?, ?)
      `)
      .bind(
        referee,
        'England',
        sourceName,
        referee
      )
  );

  for (let i = 0; i < refereeStatements.length; i += 100) {
    await env.DB.batch(
      refereeStatements.slice(i, i + 100)
    );
  }

  // ---------------------------------------------------------
  // ID MAPS
  // ---------------------------------------------------------

  const teamResult = await env.DB
    .prepare(`
      SELECT id, source_name
      FROM teams
      WHERE source = ?
    `)
    .bind(sourceName)
    .all();

  const teamMap = new Map();

  for (const team of teamResult.results || []) {
    teamMap.set(team.source_name, team.id);
  }

  const refereeResult = await env.DB
    .prepare(`
      SELECT id, source_name
      FROM referees
      WHERE source = ?
    `)
    .bind(sourceName)
    .all();

  const refereeMap = new Map();

  for (const referee of refereeResult.results || []) {
    refereeMap.set(
      referee.source_name,
      referee.id
    );
  }

  // ---------------------------------------------------------
  // MATCHES
  // ---------------------------------------------------------

  const matchStatements = [];

  for (const row of rows) {
    const homeTeam = clean(row.HomeTeam);
    const awayTeam = clean(row.AwayTeam);
    const matchDate = dateToISO(row.Date);

    if (!homeTeam || !awayTeam || !matchDate) {
      continue;
    }

    const homeTeamId = teamMap.get(homeTeam);
    const awayTeamId = teamMap.get(awayTeam);

    if (!homeTeamId || !awayTeamId) {
      throw new Error(
        `Brak ID drużyny dla meczu ${homeTeam} - ${awayTeam}.`
      );
    }

    const referee = clean(row.Referee);
    const refereeId = referee
      ? (refereeMap.get(referee) || null)
      : null;

    const homeGoals = integerOrNull(row.FTHG);
    const awayGoals = integerOrNull(row.FTAG);

    const sourceMatchId =
      `${matchDate}|${homeTeam}|${awayTeam}`;

    matchStatements.push(
      env.DB
        .prepare(`
          INSERT OR IGNORE INTO matches (
            league_id,
            season_id,
            match_date,
            status,

            home_team_id,
            away_team_id,
            referee_id,

            home_goals,
            away_goals,
            result,

            home_ht_goals,
            away_ht_goals,
            ht_result,

            home_shots,
            away_shots,

            home_shots_on_target,
            away_shots_on_target,

            home_xg,
            away_xg,

            home_corners,
            away_corners,

            home_fouls,
            away_fouls,

            home_yellow_cards,
            away_yellow_cards,

            home_red_cards,
            away_red_cards,

            odds_json,
            raw_data_json,

            source,
            source_match_id
          )
          VALUES (
            ?, ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?,
            ?, ?,
            ?, ?,
            ?, ?,
            ?, ?,
            ?, ?,
            ?, ?,
            ?, ?,
            ?, ?,
            ?, ?,
            ?, ?,
            ?, ?
          )
        `)
        .bind(
          league.id,
          season.id,
          matchDate,
          'finished',

          homeTeamId,
          awayTeamId,
          refereeId,

          homeGoals,
          awayGoals,
          clean(row.FTR),

          integerOrNull(row.HTHG),
          integerOrNull(row.HTAG),
          clean(row.HTR),

          integerOrNull(row.HS),
          integerOrNull(row.AS),

          integerOrNull(row.HST),
          integerOrNull(row.AST),

          numberOrNull(row.HxG),
          numberOrNull(row.AxG),

          integerOrNull(row.HC),
          integerOrNull(row.AC),

          integerOrNull(row.HF),
          integerOrNull(row.AF),

          integerOrNull(row.HY),
          integerOrNull(row.AY),

          integerOrNull(row.HR),
          integerOrNull(row.AR),

          buildOdds(row),
          buildRawData(row),

          sourceName,
          sourceMatchId
        )
    );
  }

  let inserted = 0;

  for (let i = 0; i < matchStatements.length; i += 100) {
    const batch = matchStatements.slice(i, i + 100);

    await env.DB.batch(batch);

    inserted += batch.length;
  }

  return {
    season: source.season,
    rowsInCSV: rows.length,
    matchStatements: matchStatements.length,
    processed: inserted
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // =========================================================
    // TEST WORKERA
    // =========================================================

    if (url.pathname === '/api/test') {
      return new Response('WORKER OK', {
        status: 200,
        headers: {
          'content-type': 'text/plain; charset=utf-8'
        }
      });
    }

    // =========================================================
    // TEST D1
    // =========================================================

    if (url.pathname === '/api/db-test') {
      try {
        const result = await env.DB
          .prepare(`
            SELECT
              (SELECT COUNT(*) FROM leagues) AS leagues,
              (SELECT COUNT(*) FROM seasons) AS seasons,
              (SELECT COUNT(*) FROM teams) AS teams,
              (SELECT COUNT(*) FROM referees) AS referees,
              (SELECT COUNT(*) FROM matches) AS matches,
              (SELECT COUNT(*) FROM fixtures) AS fixtures
          `)
          .first();

        return new Response(
          JSON.stringify({
            ok: true,
            database: 'football-analyzer-db',
            counts: result
          }),
          {
            status: 200,
            headers: {
              'content-type':
                'application/json; charset=utf-8'
            }
          }
        );

      } catch (e) {
        return new Response(
          JSON.stringify({
            ok: false,
            error: String(e.message || e)
          }),
          {
            status: 500,
            headers: {
              'content-type':
                'application/json; charset=utf-8'
            }
          }
        );
      }
    }

    // =========================================================
    // JEDNORAZOWY IMPORT CSV → D1
    // =========================================================

    if (url.pathname === '/api/import') {
      const token = url.searchParams.get('token');

      if (token !== IMPORT_TOKEN) {
        return new Response(
          JSON.stringify({
            ok: false,
            error: 'Unauthorized'
          }),
          {
            status: 401,
            headers: {
              'content-type':
                'application/json; charset=utf-8'
            }
          }
        );
      }

      try {
        const results = [];

        for (const source of SOURCES) {
          results.push(
            await importSource(env, source)
          );
        }

        const counts = await env.DB
          .prepare(`
            SELECT
              (SELECT COUNT(*) FROM leagues) AS leagues,
              (SELECT COUNT(*) FROM seasons) AS seasons,
              (SELECT COUNT(*) FROM teams) AS teams,
              (SELECT COUNT(*) FROM referees) AS referees,
              (SELECT COUNT(*) FROM matches) AS matches,
              (SELECT COUNT(*) FROM fixtures) AS fixtures
          `)
          .first();

        return new Response(
          JSON.stringify({
            ok: true,
            message: 'Import zakończony',
            results,
            counts
          }),
          {
            status: 200,
            headers: {
              'content-type':
                'application/json; charset=utf-8'
            }
          }
        );

      } catch (e) {
        return new Response(
          JSON.stringify({
            ok: false,
            error: String(e.message || e)
          }),
          {
            status: 500,
            headers: {
              'content-type':
                'application/json; charset=utf-8'
            }
          }
        );
      }
    }

    // =========================================================
    // OBECNE API DATA
    // =========================================================

    if (url.pathname === '/api/data') {
      const cache = caches.default;
      const cacheKey =
        new Request(url.toString(), request);

      const cached = await cache.match(cacheKey);

      if (cached) {
        return cached;
      }

      try {
        const results = await Promise.all(
          SOURCES.map(async (s) => {
            const assetUrl =
              new URL(s.file, request.url);

            const assetRequest =
              new Request(assetUrl.toString(), {
                method: 'GET'
              });

            const r =
              await env.ASSETS.fetch(assetRequest);

            if (!r.ok) {
              throw new Error(
                `Local asset HTTP ${r.status} for ${s.season}`
              );
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
            'content-type':
              'application/json; charset=utf-8',
            'cache-control':
              'public, max-age=86400, s-maxage=86400',
            'access-control-allow-origin': '*'
          }
        });

        await cache.put(
          cacheKey,
          response.clone()
        );

        return response;

      } catch (e) {
        return new Response(
          JSON.stringify({
            error: String(e.message || e)
          }),
          {
            status: 502,
            headers: {
              'content-type':
                'application/json; charset=utf-8',
              'access-control-allow-origin': '*'
            }
          }
        );
      }
    }

    return env.ASSETS.fetch(request);
  }
};
