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
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === ',' && !inQuotes) {
      row.push(field);
      field = '';
      continue;
    }

    if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && text[i + 1] === '\n') {
        i++;
      }

      row.push(field);
      field = '';

      if (row.some(v => v !== '')) {
        rows.push(row);
      }

      row = [];
      continue;
    }

    field += ch;
  }

  if (field !== '' || row.length > 0) {
    row.push(field);

    if (row.some(v => v !== '')) {
      rows.push(row);
    }
  }

  if (!rows.length) {
    return [];
  }

  const headers = rows[0].map(h => String(h).trim());

  return rows.slice(1).map(values => {
    const obj = {};

    headers.forEach((header, i) => {
      obj[header] = values[i] ?? '';
    });

    return obj;
  });
}

function clean(value) {
  if (value === undefined || value === null) {
    return '';
  }

  return String(value).trim();
}

function num(value) {
  const s = clean(value);

  if (!s) {
    return null;
  }

  const n = Number(s.replace(',', '.'));

  return Number.isFinite(n) ? n : null;
}

function int(value) {
  const n = num(value);

  return n === null ? null : Math.round(n);
}

function dateToISO(value) {
  const s = clean(value);

  if (!s) {
    return null;
  }

  const parts = s.split('/');

  if (parts.length === 3) {
    let [day, month, year] = parts;

    if (year.length === 2) {
      year = Number(year) >= 90
        ? `19${year}`
        : `20${year}`;
    }

    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  return s;
}

function getResult(row) {
  const result = clean(row.FTR);

  if (result === 'H' || result === 'D' || result === 'A') {
    return result;
  }

  const hg = int(row.FTHG);
  const ag = int(row.FTAG);

  if (hg === null || ag === null) {
    return null;
  }

  if (hg > ag) return 'H';
  if (hg < ag) return 'A';

  return 'D';
}

function getHTResult(row) {
  const result = clean(row.HTR);

  if (result === 'H' || result === 'D' || result === 'A') {
    return result;
  }

  const hg = int(row.HTHG);
  const ag = int(row.HTAG);

  if (hg === null || ag === null) {
    return null;
  }

  if (hg > ag) return 'H';
  if (hg < ag) return 'A';

  return 'D';
}

function getOdds(row) {
  const odds = {};

  for (const [key, value] of Object.entries(row)) {
    if (!value) {
      continue;
    }

    if (
      /^(B365|BW|IW|PS|WH|VC|Max|Avg|Pinnacle|Betway|Marathon|Interwetten|WilliamHill)/i.test(key)
    ) {
      odds[key] = value;
    }
  }

  return odds;
}

async function getLocalCSV(env, request, file, season) {
  const assetUrl = new URL(file, request.url);

  const assetRequest = new Request(assetUrl.toString(), {
    method: 'GET'
  });

  const response = await env.ASSETS.fetch(assetRequest);

  if (!response.ok) {
    throw new Error(
      `Local asset HTTP ${response.status} for ${season}`
    );
  }

  return await response.text();
}

async function getCounts(env) {
  return await env.DB.prepare(`
    SELECT
      (SELECT COUNT(*) FROM leagues) AS leagues,
      (SELECT COUNT(*) FROM seasons) AS seasons,
      (SELECT COUNT(*) FROM teams) AS teams,
      (SELECT COUNT(*) FROM referees) AS referees,
      (SELECT COUNT(*) FROM matches) AS matches,
      (SELECT COUNT(*) FROM fixtures) AS fixtures
  `).first();
}

async function importSeason(env, request, source) {
  const csv = await getLocalCSV(
    env,
    request,
    source.file,
    source.season
  );

  const rows = parseCSV(csv);

  if (!rows.length) {
    return {
      season: source.season,
      rows: 0,
      imported: 0
    };
  }

  const league = await env.DB
    .prepare(`
      INSERT OR IGNORE INTO leagues
        (name, country, code, source)
      VALUES
        (?, ?, ?, ?)
    `)
    .bind(
      'Premier League',
      'England',
      'E0',
      'football-data'
    )
    .run();

  const leagueRow = await env.DB
    .prepare(`
      SELECT id
      FROM leagues
      WHERE source = ?
        AND code = ?
      LIMIT 1
    `)
    .bind(
      'football-data',
      'E0'
    )
    .first();

  if (!leagueRow) {
    throw new Error('Could not find Premier League after insert');
  }

  const leagueId = leagueRow.id;

  const [startYear, endYear] = source.season
    .split('/')
    .map(Number);

  await env.DB
    .prepare(`
      INSERT OR IGNORE INTO seasons
        (
          league_id,
          name,
          start_year,
          end_year,
          source
        )
      VALUES
        (?, ?, ?, ?, ?)
    `)
    .bind(
      leagueId,
      source.season,
      startYear,
      endYear,
      'football-data'
    )
    .run();

  const seasonRow = await env.DB
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

  if (!seasonRow) {
    throw new Error(
      `Could not find season ${source.season} after insert`
    );
  }

  const seasonId = seasonRow.id;

  const teams = new Set();
  const referees = new Set();

  for (const row of rows) {
    const home = clean(row.HomeTeam);
    const away = clean(row.AwayTeam);
    const referee = clean(row.Referee);

    if (home) teams.add(home);
    if (away) teams.add(away);
    if (referee) referees.add(referee);
  }

  for (const team of teams) {
    await env.DB
      .prepare(`
        INSERT OR IGNORE INTO teams
          (
            name,
            country,
            source,
            source_name
          )
        VALUES
          (?, ?, ?, ?)
      `)
      .bind(
        team,
        'England',
        'football-data',
        team
      )
      .run();
  }

  for (const referee of referees) {
    await env.DB
      .prepare(`
        INSERT OR IGNORE INTO referees
          (
            name,
            country,
            source,
            source_name
          )
        VALUES
          (?, ?, ?, ?)
      `)
      .bind(
        referee,
        'England',
        'football-data',
        referee
      )
      .run();
  }

  const teamRows = await env.DB
    .prepare(`
      SELECT id, source_name
      FROM teams
      WHERE source = ?
    `)
    .bind('football-data')
    .all();

  const refereeRows = await env.DB
    .prepare(`
      SELECT id, source_name
      FROM referees
      WHERE source = ?
    `)
    .bind('football-data')
    .all();

  const teamMap = new Map();

  for (const team of teamRows.results || []) {
    teamMap.set(team.source_name, team.id);
  }

  const refereeMap = new Map();

  for (const referee of refereeRows.results || []) {
    refereeMap.set(referee.source_name, referee.id);
  }

  const statements = [];
  let imported = 0;

  for (const row of rows) {
    const homeTeam = clean(row.HomeTeam);
    const awayTeam = clean(row.AwayTeam);
    const date = dateToISO(row.Date);

    if (!homeTeam || !awayTeam || !date) {
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

    const rawData = JSON.stringify(row);
    const odds = JSON.stringify(getOdds(row));

    /*
      IMPORTANT:
      The columns below are exactly 33 columns,
      and the bind() below contains exactly 33 values.
    */

    const sql = `
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
        ?, ?,
        ?, ?,
        ?, ?
      )
      ON CONFLICT
      (
        source,
        league_id,
        season_id,
        match_date,
        home_team_id,
        away_team_id
      )
      DO UPDATE SET
        status = excluded.status,
        referee_id = excluded.referee_id,

        home_goals = excluded.home_goals,
        away_goals = excluded.away_goals,
        result = excluded.result,

        home_ht_goals = excluded.home_ht_goals,
        away_ht_goals = excluded.away_ht_goals,
        ht_result = excluded.ht_result,

        home_shots = excluded.home_shots,
        away_shots = excluded.away_shots,

        home_shots_on_target =
          excluded.home_shots_on_target,
        away_shots_on_target =
          excluded.away_shots_on_target,

        home_xg = excluded.home_xg,
        away_xg = excluded.away_xg,

        home_corners = excluded.home_corners,
        away_corners = excluded.away_corners,

        home_fouls = excluded.home_fouls,
        away_fouls = excluded.away_fouls,

        home_yellow_cards =
          excluded.home_yellow_cards,
        away_yellow_cards =
          excluded.away_yellow_cards,

        home_red_cards =
          excluded.home_red_cards,
        away_red_cards =
          excluded.away_red_cards,

        home_possession =
          excluded.home_possession,
        away_possession =
          excluded.away_possession,

        odds_json = excluded.odds_json,
        raw_data_json = excluded.raw_data_json,

        updated_at = CURRENT_TIMESTAMP
    `;

    const sourceMatchId = [
      source.season,
      date,
      homeTeam,
      awayTeam
    ].join('|');

    statements.push(
      env.DB
        .prepare(sql)
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

    if (statements.length >= 50) {
      await env.DB.batch(statements.splice(0));
    }
  }

  if (statements.length) {
    await env.DB.batch(statements);
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

    /*
      Simple Worker test
    */
    if (url.pathname === '/api/test') {
      return new Response('WORKER OK', {
        status: 200,
        headers: {
          'content-type': 'text/plain; charset=utf-8'
        }
      });
    }

    /*
      D1 connection test
    */
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

    /*
      Existing CSV API.
      Reads the two local CSV assets.
    */
    if (url.pathname === '/api/data') {
      const cache = caches.default;
      const cacheKey = new Request(
        url.toString(),
        request
      );

      const cached = await cache.match(cacheKey);

      if (cached) {
        return cached;
      }

      try {
        const results = await Promise.all(
          SOURCES.map(async (source) => {
            const csv = await getLocalCSV(
              env,
              request,
              source.file,
              source.season
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

    /*
      One-time D1 import.
    */
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
            await importSeason(
              env,
              request,
              source
            )
          );
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

    return env.ASSETS.fetch(request);
  }
};
