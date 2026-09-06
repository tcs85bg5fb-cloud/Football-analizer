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

function clean(value) {
  if (value === undefined || value === null) return null;

  const v = String(value).trim();

  if (!v || v === '-' || v === 'NA' || v === 'N/A') {
    return null;
  }

  return v;
}

function num(value) {
  const v = clean(value);

  if (v === null) return null;

  const n = Number(String(v).replace(',', '.'));

  return Number.isFinite(n) ? n : null;
}

function int(value) {
  const n = num(value);

  return n === null ? null : Math.trunc(n);
}

function dateToISO(value) {
  const v = clean(value);

  if (!v) return null;

  // dd/mm/yyyy
  const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);

  if (m) {
    const [, day, month, year] = m;

    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  // yyyy-mm-dd
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    return v;
  }

  // fallback
  const d = new Date(v);

  if (!Number.isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10);
  }

  return null;
}

function getResult(row) {
  const direct = clean(row.FTR);

  if (direct === 'H' || direct === 'D' || direct === 'A') {
    return direct;
  }

  const home = int(row.FTHG);
  const away = int(row.FTAG);

  if (home === null || away === null) return null;

  if (home > away) return 'H';
  if (home < away) return 'A';

  return 'D';
}

function getHTResult(row) {
  const direct = clean(row.HTR);

  if (direct === 'H' || direct === 'D' || direct === 'A') {
    return direct;
  }

  const home = int(row.HTHG);
  const away = int(row.HTAG);

  if (home === null || away === null) return null;

  if (home > away) return 'H';
  if (home < away) return 'A';

  return 'D';
}

function getOdds(row) {
  const odds = {};

  for (const [key, value] of Object.entries(row)) {
    if (
      key.startsWith('B365') ||
      key.startsWith('BW') ||
      key.startsWith('IW') ||
      key.startsWith('PS') ||
      key.startsWith('WH') ||
      key.startsWith('VC') ||
      key.startsWith('Max') ||
      key.startsWith('Avg') ||
      key.startsWith('Pinnacle') ||
      key.startsWith('1XB') ||
      key.startsWith('BFD')
    ) {
      const n = num(value);

      if (n !== null) {
        odds[key] = n;
      }
    }
  }

  return odds;
}

function parseCSV(text) {
  const rows = [];

  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }

      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(cell);
      cell = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') {
        i++;
      }

      row.push(cell);
      cell = '';

      if (row.some(v => String(v).trim() !== '')) {
        rows.push(row);
      }

      row = [];
      continue;
    }

    cell += char;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);

    if (row.some(v => String(v).trim() !== '')) {
      rows.push(row);
    }
  }

  if (rows.length === 0) {
    return [];
  }

  const headers = rows[0].map(h => String(h).trim());

  return rows.slice(1).map(values => {
    const obj = {};

    for (let i = 0; i < headers.length; i++) {
      obj[headers[i]] = values[i] ?? '';
    }

    return obj;
  });
}

async function getLocalCSV(env, request, file) {
  const assetUrl = new URL(file, request.url);

  const assetRequest = new Request(assetUrl.toString(), {
    method: 'GET'
  });

  const response = await env.ASSETS.fetch(assetRequest);

  if (!response.ok) {
    throw new Error(`Local asset HTTP ${response.status} for ${file}`);
  }

  return await response.text();
}

async function getCounts(env) {
  return await env.DB
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
}

async function importSeason(env, request, source) {
  const csv = await getLocalCSV(env, request, source.file);

  const rows = parseCSV(csv);

  if (!rows.length) {
    throw new Error(`No rows found in ${source.file}`);
  }

  // --------------------------------------------------
  // LEAGUE
  // --------------------------------------------------

  await env.DB
    .prepare(`
      INSERT INTO leagues
        (name, country, code, source)
      VALUES
        (?, ?, ?, ?)
      ON CONFLICT(source, code)
      DO UPDATE SET
        name = excluded.name,
        country = excluded.country
    `)
    .bind(
      'Premier League',
      'England',
      'E0',
      'football-data'
    )
    .run();

  const league = await env.DB
    .prepare(`
      SELECT id
      FROM leagues
      WHERE source = ?
        AND code = ?
      LIMIT 1
    `)
    .bind('football-data', 'E0')
    .first();

  if (!league) {
    throw new Error('League was not created/found');
  }

  const leagueId = league.id;

  // --------------------------------------------------
  // SEASON
  // --------------------------------------------------

  const years = source.season.split('/');

  const startYear = Number(`20${years[0]}`);
  const endYear = Number(`20${years[1]}`);

  await env.DB
    .prepare(`
      INSERT INTO seasons
        (league_id, name, start_year, end_year, source)
      VALUES
        (?, ?, ?, ?, ?)
      ON CONFLICT(league_id, name)
      DO UPDATE SET
        start_year = excluded.start_year,
        end_year = excluded.end_year,
        source = excluded.source
    `)
    .bind(
      leagueId,
      source.season,
      startYear,
      endYear,
      'football-data'
    )
    .run();

  const season = await env.DB
    .prepare(`
      SELECT id
      FROM seasons
      WHERE league_id = ?
        AND name = ?
      LIMIT 1
    `)
    .bind(
      leagueId,
      source.season
    )
    .first();

  if (!season) {
    throw new Error(`Season ${source.season} was not created/found`);
  }

  const seasonId = season.id;

  // --------------------------------------------------
  // TEAMS
  // --------------------------------------------------

  const teamNames = new Set();

  for (const row of rows) {
    const home = clean(row.HomeTeam);
    const away = clean(row.AwayTeam);

    if (home) teamNames.add(home);
    if (away) teamNames.add(away);
  }

  for (const teamName of teamNames) {
    await env.DB
      .prepare(`
        INSERT INTO teams
          (name, country, source, source_name)
        VALUES
          (?, ?, ?, ?)
        ON CONFLICT(source, source_name)
        DO UPDATE SET
          name = excluded.name
      `)
      .bind(
        teamName,
        'England',
        'football-data',
        teamName
      )
      .run();
  }

  // --------------------------------------------------
  // REFEREES
  // --------------------------------------------------

  const refereeNames = new Set();

  for (const row of rows) {
    const referee = clean(row.Referee);

    if (referee) {
      refereeNames.add(referee);
    }
  }

  for (const refereeName of refereeNames) {
    await env.DB
      .prepare(`
        INSERT INTO referees
          (name, country, source, source_name)
        VALUES
          (?, ?, ?, ?)
        ON CONFLICT(source, source_name)
        DO UPDATE SET
          name = excluded.name
      `)
      .bind(
        refereeName,
        'England',
        'football-data',
        refereeName
      )
      .run();
  }

  // --------------------------------------------------
  // ID MAPS
  // --------------------------------------------------

  const teamRows = await env.DB
    .prepare(`
      SELECT id, source_name
      FROM teams
      WHERE source = ?
    `)
    .bind('football-data')
    .all();

  const teamMap = new Map();

  for (const team of teamRows.results || []) {
    teamMap.set(team.source_name, team.id);
  }

  const refereeRows = await env.DB
    .prepare(`
      SELECT id, source_name
      FROM referees
      WHERE source = ?
    `)
    .bind('football-data')
    .all();

  const refereeMap = new Map();

  for (const referee of refereeRows.results || []) {
    refereeMap.set(referee.source_name, referee.id);
  }

  // --------------------------------------------------
  // MATCHES
  // --------------------------------------------------

  let imported = 0;

  const batchSize = 50;

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);

    const statements = [];

    for (const row of batch) {
      const date = dateToISO(row.Date);
      const homeTeam = clean(row.HomeTeam);
      const awayTeam = clean(row.AwayTeam);

      if (!date || !homeTeam || !awayTeam) {
        continue;
      }

      const homeTeamId = teamMap.get(homeTeam);
      const awayTeamId = teamMap.get(awayTeam);

      if (!homeTeamId || !awayTeamId) {
        continue;
      }

      const refereeName = clean(row.Referee);
      const refereeId = refereeName
        ? (refereeMap.get(refereeName) ?? null)
        : null;

      const homeGoals = int(row.FTHG);
      const awayGoals = int(row.FTAG);

      const homeHTGoals = int(row.HTHG);
      const awayHTGoals = int(row.HTAG);

      const homeXG = num(row.HxG);
      const awayXG = num(row.AxG);

      const odds = JSON.stringify(getOdds(row));

      const rawData = JSON.stringify(row);

      const sourceMatchId =
        `${source.season}|${date}|${homeTeam}|${awayTeam}`;

      statements.push(
        env.DB
          .prepare(`
            INSERT INTO matches
            (
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

              home_possession,
              away_possession,

              odds_json,
              raw_data_json,

              source,
              source_match_id
            )
            VALUES
            (
              ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
              ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
              ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
            )
            ON CONFLICT(
              source,
              league_id,
              season_id,
              match_date,
              home_team_id,
              away_team_id
            )
            DO UPDATE SET
              referee_id = excluded.referee_id,

              home_goals = excluded.home_goals,
              away_goals = excluded.away_goals,
              result = excluded.result,

              home_ht_goals = excluded.home_ht_goals,
              away_ht_goals = excluded.away_ht_goals,
              ht_result = excluded.ht_result,

              home_shots = excluded.home_shots,
              away_shots = excluded.away_shots,

              home_shots_on_target = excluded.home_shots_on_target,
              away_shots_on_target = excluded.away_shots_on_target,

              home_xg = excluded.home_xg,
              away_xg = excluded.away_xg,

              home_corners = excluded.home_corners,
              away_corners = excluded.away_corners,

              home_fouls = excluded.home_fouls,
              away_fouls = excluded.away_fouls,

              home_yellow_cards = excluded.home_yellow_cards,
              away_yellow_cards = excluded.away_yellow_cards,

              home_red_cards = excluded.home_red_cards,
              away_red_cards = excluded.away_red_cards,

              home_possession = excluded.home_possession,
              away_possession = excluded.away_possession,

              odds_json = excluded.odds_json,
              raw_data_json = excluded.raw_data_json,

              updated_at = CURRENT_TIMESTAMP
          `)
          .bind(
            leagueId,
            seasonId,
            date,
            'finished',

            homeTeamId,
            awayTeamId,
            refereeId,

            homeGoals,
            awayGoals,
            getResult(row),

            homeHTGoals,
            awayHTGoals,
            getHTResult(row),

            int(row.HS),
            int(row.AS),

            int(row.HST),
            int(row.AST),

            homeXG,
            awayXG,

            int(row.HC),
            int(row.AC),

            int(row.HF),
            int(row.AF),

            int(row.HY),
            int(row.AY),

            int(row.HR),
            int(row.AR),

            num(row.HP),
            num(row.AP),

            odds,
            rawData,

            'football-data',
            sourceMatchId
          )
      );

      imported++;
    }

    if (statements.length) {
      await env.DB.batch(statements);
    }
  }

  return {
    season: source.season,
    rows: rows.length,
    imported
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // --------------------------------------------------
    // BASIC TEST
    // --------------------------------------------------

    if (url.pathname === '/api/test') {
      return new Response('WORKER OK', {
        status: 200,
        headers: {
          'content-type': 'text/plain; charset=utf-8'
        }
      });
    }

    // --------------------------------------------------
    // D1 TEST
    // --------------------------------------------------

    if (url.pathname === '/api/db-test') {
      try {
        const counts = await getCounts(env);

        return new Response(
          JSON.stringify({
            ok: true,
            database: 'football-analyzer-db',
            counts
          }),
          {
            status: 200,
            headers: {
              'content-type': 'application/json; charset=utf-8'
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
              'content-type': 'application/json; charset=utf-8'
            }
          }
        );
      }
    }

    // --------------------------------------------------
    // D1 MATCHES API
    // --------------------------------------------------

    if (url.pathname === '/api/matches') {
      try {
        const requestedLimit = Number(
          url.searchParams.get('limit') || '10'
        );

        const requestedOffset = Number(
          url.searchParams.get('offset') || '0'
        );

        const limit = Math.min(
          Math.max(
            Number.isFinite(requestedLimit)
              ? Math.trunc(requestedLimit)
              : 10,
            1
          ),
          1000
        );

        const offset = Math.max(
          Number.isFinite(requestedOffset)
            ? Math.trunc(requestedOffset)
            : 0,
          0
        );

        const result = await env.DB
          .prepare(`
            SELECT
              m.id,
              m.match_date,
              m.status,

              s.name AS season,
              l.name AS league,

              ht.name AS home_team,
              at.name AS away_team,

              r.name AS referee,

              m.home_goals,
              m.away_goals,
              m.result,

              m.home_ht_goals,
              m.away_ht_goals,
              m.ht_result,

              m.home_shots,
              m.away_shots,

              m.home_shots_on_target,
              m.away_shots_on_target,

              m.home_xg,
              m.away_xg,

              m.home_corners,
              m.away_corners,

              m.home_fouls,
              m.away_fouls,

              m.home_yellow_cards,
              m.away_yellow_cards,

              m.home_red_cards,
              m.away_red_cards,

              m.home_possession,
              m.away_possession,

              m.odds_json,
              m.raw_data_json,

              m.source,
              m.source_match_id,

              m.created_at,
              m.updated_at

            FROM matches m

            JOIN leagues l
              ON l.id = m.league_id

            JOIN seasons s
              ON s.id = m.season_id

            JOIN teams ht
              ON ht.id = m.home_team_id

            JOIN teams at
              ON at.id = m.away_team_id

            LEFT JOIN referees r
              ON r.id = m.referee_id

            ORDER BY
              m.match_date DESC,
              m.id DESC

            LIMIT ?
            OFFSET ?
          `)
          .bind(limit, offset)
          .all();

        const counts = await getCounts(env);

        const matches = (result.results || []).map(match => ({
          ...match,

          odds: match.odds_json
            ? JSON.parse(match.odds_json)
            : {},

          raw_data: match.raw_data_json
            ? JSON.parse(match.raw_data_json)
            : {}
        }));

        return new Response(
          JSON.stringify({
            ok: true,
            count: matches.length,
            total_matches: counts.matches,
            limit,
            offset,
            matches
          }),
          {
            status: 200,
            headers: {
              'content-type': 'application/json; charset=utf-8',
              'cache-control': 'public, max-age=300',
              'access-control-allow-origin': '*'
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
              'content-type': 'application/json; charset=utf-8',
              'access-control-allow-origin': '*'
            }
          }
        );
      }
    }

    // --------------------------------------------------
    // OLD CSV API
    // --------------------------------------------------

    if (url.pathname === '/api/data') {
      const cache = caches.default;
      const cacheKey = new Request(url.toString(), request);

      const cached = await cache.match(cacheKey);

      if (cached) {
        return cached;
      }

      try {
        const results = await Promise.all(
          SOURCES.map(async source => {
            const csv = await getLocalCSV(
              env,
              request,
              source.file
            );

            return {
              season: source.season,
              csv
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
            'cache-control':
              'public, max-age=86400, s-maxage=86400',
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

    // --------------------------------------------------
    // ONE-TIME IMPORT
    // --------------------------------------------------

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
              'content-type': 'application/json; charset=utf-8'
            }
          }
        );
      }

      try {
        const results = [];

        for (const source of SOURCES) {
          const result = await importSeason(
            env,
            request,
            source
          );

          results.push(result);
        }

        const counts = await getCounts(env);

        return new Response(
          JSON.stringify({
            ok: true,
            results,
            counts
          }),
          {
            status: 200,
            headers: {
              'content-type': 'application/json; charset=utf-8',
              'access-control-allow-origin': '*'
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
              'content-type': 'application/json; charset=utf-8',
              'access-control-allow-origin': '*'
            }
          }
        );
      }
    }

    // --------------------------------------------------
    // STATIC ASSETS
    // --------------------------------------------------

    return env.ASSETS.fetch(request);
  }
};
