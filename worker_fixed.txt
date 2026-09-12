const FOOTBALL_DATA_SOURCE = 'football-data';
const IMPORT_TOKEN = 'FA-IMPORT-2026-09';

const LEAGUES = [
  { code: 'E0',  name: 'Premier League', country: 'England' },
  { code: 'E1',  name: 'Championship', country: 'England' },
  { code: 'E2',  name: 'League One', country: 'England' },
  { code: 'E3',  name: 'League Two', country: 'England' },
  { code: 'EC',  name: 'National League', country: 'England' },

  { code: 'SC0', name: 'Premiership', country: 'Scotland' },
  { code: 'SC1', name: 'Championship', country: 'Scotland' },
  { code: 'SC2', name: 'League One', country: 'Scotland' },
  { code: 'SC3', name: 'League Two', country: 'Scotland' },

  { code: 'D1',  name: 'Bundesliga', country: 'Germany' },
  { code: 'D2',  name: '2. Bundesliga', country: 'Germany' },

  { code: 'I1',  name: 'Serie A', country: 'Italy' },
  { code: 'I2',  name: 'Serie B', country: 'Italy' },

  { code: 'SP1', name: 'La Liga', country: 'Spain' },
  { code: 'SP2', name: 'Segunda División', country: 'Spain' },

  { code: 'F1',  name: 'Ligue 1', country: 'France' },
  { code: 'F2',  name: 'Ligue 2', country: 'France' },

  { code: 'N1',  name: 'Eredivisie', country: 'Netherlands' },
  { code: 'B1',  name: 'Jupiler League', country: 'Belgium' },
  { code: 'P1',  name: 'Liga Portugal', country: 'Portugal' },
  { code: 'T1',  name: 'Süper Lig', country: 'Turkey' },
  { code: 'G1',  name: 'Super League', country: 'Greece' }
];

const SEASONS = [
  '2025/26',
  '2026/27'
];

const CURRENT_SEASON = '2026/27';

/*
 * =========================================================
 * IMPORT LIMITS
 * =========================================================
 */

/*
 * Na darmowym planie Cloudflare
 * bezpiecznie importujemy 3 ligi
 * na jedno wywołanie.
 */
const MASS_IMPORT_CHUNK_SIZE = 3;

/*
 * D1 pozwala na maksymalnie 100 statementów
 * w jednym batchu.
 */
const MATCH_BATCH_SIZE = 100;

/*
 * =========================================================
 * CRON REFRESH PARTS
 * =========================================================
 *
 * 22 ligi podzielone na 8 bezpiecznych paczek.
 *
 * Part 1 -> E0, E1, E2
 * Part 2 -> E3, EC, SC0
 * Part 3 -> SC1, SC2, SC3
 * Part 4 -> D1, D2, I1
 * Part 5 -> I2, SP1, SP2
 * Part 6 -> F1, F2, N1
 * Part 7 -> B1, P1, T1
 * Part 8 -> G1
 *
 * Cron uruchamia się 5 razy dziennie.
 * Każde uruchomienie bierze kolejną paczkę.
 */

const REFRESH_PARTS = [
  ['E0', 'E1', 'E2'],
  ['E3', 'EC', 'SC0'],
  ['SC1', 'SC2', 'SC3'],
  ['D1', 'D2', 'I1'],
  ['I2', 'SP1', 'SP2'],
  ['F1', 'F2', 'N1'],
  ['B1', 'P1', 'T1'],
  ['G1']
];

/*
 * Godziny zgodne z wrangler.json:
 *
 * 03:00 UTC
 * 08:00 UTC
 * 13:00 UTC
 * 18:00 UTC
 * 23:00 UTC
 *
 * Cloudflare cron działa w UTC.
 */
const CRON_HOURS = [
  3,
  8,
  13,
  18,
  23
];

/*
 * =========================================================
 * BASIC HELPERS
 * =========================================================
 */

function clean(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const v = String(value).trim();

  if (!v || v === '-' || v === 'NA' || v === 'N/A') {
    return null;
  }

  return v;
}

function num(value) {
  const v = clean(value);

  if (v === null) {
    return null;
  }

  const n = Number(
    String(v).replace(',', '.')
  );

  return Number.isFinite(n) ? n : null;
}

function int(value) {
  const n = num(value);

  return n === null
    ? null
    : Math.trunc(n);
}

function dateToISO(value) {
  const v = clean(value);

  if (!v) {
    return null;
  }

  const m = v.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/
  );

  if (m) {
    const [, day, month, year] = m;

    return (
      `${year}-` +
      `${month.padStart(2, '0')}-` +
      `${day.padStart(2, '0')}`
    );
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    return v;
  }

  const d = new Date(v);

  if (!Number.isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10);
  }

  return null;
}

function getResult(row) {
  const direct = clean(row.FTR);

  if (
    direct === 'H' ||
    direct === 'D' ||
    direct === 'A'
  ) {
    return direct;
  }

  const home = int(row.FTHG);
  const away = int(row.FTAG);

  if (
    home === null ||
    away === null
  ) {
    return null;
  }

  if (home > away) {
    return 'H';
  }

  if (home < away) {
    return 'A';
  }

  return 'D';
}

function getHTResult(row) {
  const direct = clean(row.HTR);

  if (
    direct === 'H' ||
    direct === 'D' ||
    direct === 'A'
  ) {
    return direct;
  }

  const home = int(row.HTHG);
  const away = int(row.HTAG);

  if (
    home === null ||
    away === null
  ) {
    return null;
  }

  if (home > away) {
    return 'H';
  }

  if (home < away) {
    return 'A';
  }

  return 'D';
}

function getOdds(row) {
  const odds = {};

  for (
    const [key, value]
    of Object.entries(row)
  ) {
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

/*
 * =========================================================
 * CSV PARSER
 * =========================================================
 */

function parseCSV(text) {
  const rows = [];

  let row = [];
  let cell = '';
  let inQuotes = false;

  for (
    let i = 0;
    i < text.length;
    i++
  ) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (
        inQuotes &&
        next === '"'
      ) {
        cell += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }

      continue;
    }

    if (
      char === ',' &&
      !inQuotes
    ) {
      row.push(cell);
      cell = '';
      continue;
    }

    if (
      (
        char === '\n' ||
        char === '\r'
      ) &&
      !inQuotes
    ) {
      if (
        char === '\r' &&
        next === '\n'
      ) {
        i++;
      }

      row.push(cell);
      cell = '';

      if (
        row.some(
          v =>
            String(v).trim() !== ''
        )
      ) {
        rows.push(row);
      }

      row = [];

      continue;
    }

    cell += char;
  }

  if (
    cell.length > 0 ||
    row.length > 0
  ) {
    row.push(cell);

    if (
      row.some(
        v =>
          String(v).trim() !== ''
      )
    ) {
      rows.push(row);
    }
  }

  if (!rows.length) {
    return [];
  }

  const headers =
    rows[0].map(
      h => String(h).trim()
    );

  return rows
    .slice(1)
    .map(values => {
      const obj = {};

      for (
        let i = 0;
        i < headers.length;
        i++
      ) {
        obj[headers[i]] =
          values[i] ?? '';
      }

      return obj;
    });
}

/*
 * =========================================================
 * FOOTBALL-DATA
 * =========================================================
 */

function getLeague(code) {
  return LEAGUES.find(
    league =>
      league.code === code
  );
}

/*
 * Football-Data:
 *
 * 2025/26 -> 2526
 * 2026/27 -> 2627
 */
function getSourceUrl(
  season,
  code
) {
  const [start, end] =
    season.split('/');

  const years =
    start.slice(2) + end;

  return (
    'https://football-data.co.uk/mmz4281/' +
    years +
    '/' +
    code +
    '.csv'
  );
}

async function getRemoteCSV(url) {
  const response =
    await fetch(
      url,
      {
        method: 'GET',

        headers: {
          'User-Agent':
            'Football-Analizer/1.0'
        },

        cf: {
          cacheTtl: 0,
          cacheEverything: false
        }
      }
    );

  if (!response.ok) {
    throw new Error(
      `Remote CSV HTTP ${response.status} for ${url}`
    );
  }

  const text =
    await response.text();

  if (
    !text ||
    text.trim().length < 100
  ) {
    throw new Error(
      'Remote CSV is empty or suspiciously small'
    );
  }

  return text;
}

/*
 * =========================================================
 * COUNTS
 * =========================================================
 */

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

/*
 * =========================================================
 * LEAGUE
 * =========================================================
 */

async function ensureLeague(
  env,
  leagueConfig
) {
  const insert =
    env.DB.prepare(`
      INSERT INTO leagues (
        name,
        country,
        code,
        source
      )
      VALUES (?, ?, ?, ?)
      ON CONFLICT(source, code)
      DO UPDATE SET
        name = excluded.name,
        country = excluded.country
    `).bind(
      leagueConfig.name,
      leagueConfig.country,
      leagueConfig.code,
      FOOTBALL_DATA_SOURCE
    );

  const select =
    env.DB.prepare(`
      SELECT
        id
      FROM leagues
      WHERE source = ?
        AND code = ?
      LIMIT 1
    `).bind(
      FOOTBALL_DATA_SOURCE,
      leagueConfig.code
    );

  const result =
    await env.DB.batch([
      insert,
      select
    ]);

  const rows =
    result[1]?.results || [];

  return rows[0] || null;
}

/*
 * =========================================================
 * SEASON
 * =========================================================
 */

async function ensureSeason(
  env,
  leagueId,
  seasonName
) {
  const years =
    seasonName.split('/');

  const startYear =
    Number(
      `20${years[0]}`
    );

  const endYear =
    Number(
      `20${years[1]}`
    );

  const insert =
    env.DB.prepare(`
      INSERT INTO seasons (
        league_id,
        name,
        start_year,
        end_year,
        source
      )
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(league_id, name)
      DO UPDATE SET
        start_year = excluded.start_year,
        end_year = excluded.end_year,
        source = excluded.source
    `).bind(
      leagueId,
      seasonName,
      startYear,
      endYear,
      FOOTBALL_DATA_SOURCE
    );

  const select =
    env.DB.prepare(`
      SELECT
        id
      FROM seasons
      WHERE league_id = ?
        AND name = ?
      LIMIT 1
    `).bind(
      leagueId,
      seasonName
    );

  const result =
    await env.DB.batch([
      insert,
      select
    ]);

  const rows =
    result[1]?.results || [];

  return rows[0] || null;
}

/*
 * =========================================================
 * IMPORT CSV
 * =========================================================
 */

async function importCSV(
  env,
  leagueConfig,
  seasonName,
  csv
) {
  const rows =
    parseCSV(csv);

  if (!rows.length) {
    throw new Error(
      `No rows found for ${leagueConfig.code} ${seasonName}`
    );
  }

  const league =
    await ensureLeague(
      env,
      leagueConfig
    );

  if (!league) {
    throw new Error(
      `League ${leagueConfig.code} was not created`
    );
  }

  const season =
    await ensureSeason(
      env,
      league.id,
      seasonName
    );

  if (!season) {
    throw new Error(
      `Season ${seasonName} was not created`
    );
  }

  const teamNames =
    new Set();

  const refereeNames =
    new Set();

  for (
    const row
    of rows
  ) {
    const home =
      clean(row.HomeTeam);

    const away =
      clean(row.AwayTeam);

    const referee =
      clean(row.Referee);

    if (home) {
      teamNames.add(home);
    }

    if (away) {
      teamNames.add(away);
    }

    if (referee) {
      refereeNames.add(referee);
    }
  }

  const teamRefStatements = [];

  for (
    const teamName
    of teamNames
  ) {
    teamRefStatements.push(
      env.DB.prepare(`
        INSERT INTO teams (
          name,
          country,
          source,
          source_name
        )
        VALUES (?, ?, ?, ?)
        ON CONFLICT(source, source_name)
        DO UPDATE SET
          name = excluded.name
      `).bind(
        teamName,
        leagueConfig.country,
        FOOTBALL_DATA_SOURCE,
        teamName
      )
    );
  }

  for (
    const refereeName
    of refereeNames
  ) {
    teamRefStatements.push(
      env.DB.prepare(`
        INSERT INTO referees (
          name,
          country,
          source,
          source_name
        )
        VALUES (?, ?, ?, ?)
        ON CONFLICT(source, source_name)
        DO UPDATE SET
          name = excluded.name
      `).bind(
        refereeName,
        leagueConfig.country,
        FOOTBALL_DATA_SOURCE,
        refereeName
      )
    );
  }

  if (
    teamRefStatements.length
  ) {
    await env.DB.batch(
      teamRefStatements
    );
  }

  const teamQuery =
    env.DB.prepare(`
      SELECT
        id,
        source_name
      FROM teams
      WHERE source = ?
    `).bind(
      FOOTBALL_DATA_SOURCE
    );

  const refereeQuery =
    env.DB.prepare(`
      SELECT
        id,
        source_name
      FROM referees
      WHERE source = ?
    `).bind(
      FOOTBALL_DATA_SOURCE
    );

  const maps =
    await env.DB.batch([
      teamQuery,
      refereeQuery
    ]);

  const teamMap =
    new Map();

  for (
    const team
    of maps[0]?.results || []
  ) {
    teamMap.set(
      team.source_name,
      team.id
    );
  }

  const refereeMap =
    new Map();

  for (
    const referee
    of maps[1]?.results || []
  ) {
    refereeMap.set(
      referee.source_name,
      referee.id
    );
  }

  let imported = 0;
  let skipped = 0;

  for (
    let i = 0;
    i < rows.length;
    i += MATCH_BATCH_SIZE
  ) {
    const batch =
      rows.slice(
        i,
        i + MATCH_BATCH_SIZE
      );

    const statements = [];

    for (
      const row
      of batch
    ) {
      const date =
        dateToISO(row.Date);

      const homeTeam =
        clean(row.HomeTeam);

      const awayTeam =
        clean(row.AwayTeam);

      if (
        !date ||
        !homeTeam ||
        !awayTeam
      ) {
        skipped++;
        continue;
      }

      const homeTeamId =
        teamMap.get(
          homeTeam
        );

      const awayTeamId =
        teamMap.get(
          awayTeam
        );

      if (
        !homeTeamId ||
        !awayTeamId
      ) {
        skipped++;
        continue;
      }

      const refereeName =
        clean(row.Referee);

      const refereeId =
        refereeName
          ? (
              refereeMap.get(
                refereeName
              ) ?? null
            )
          : null;

      const homeGoals =
        int(row.FTHG);

      const awayGoals =
        int(row.FTAG);

      const homeHTGoals =
        int(row.HTHG);

      const awayHTGoals =
        int(row.HTAG);

      const homeXG =
        num(row.HxG);

      const awayXG =
        num(row.AxG);

      const odds =
        JSON.stringify(
          getOdds(row)
        );

      const rawData =
        JSON.stringify(row);

      const sourceMatchId =
        `${seasonName}|${date}|${homeTeam}|${awayTeam}`;

      statements.push(
        env.DB.prepare(`
          INSERT INTO matches (
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
          VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
            ?, ?
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
            referee_id =
              excluded.referee_id,
            home_goals =
              excluded.home_goals,
            away_goals =
              excluded.away_goals,
            result =
              excluded.result,
            home_ht_goals =
              excluded.home_ht_goals,
            away_ht_goals =
              excluded.away_ht_goals,
            ht_result =
              excluded.ht_result,
            home_shots =
              excluded.home_shots,
            away_shots =
              excluded.away_shots,
            home_shots_on_target =
              excluded.home_shots_on_target,
            away_shots_on_target =
              excluded.away_shots_on_target,
            home_xg =
              excluded.home_xg,
            away_xg =
              excluded.away_xg,
            home_corners =
              excluded.home_corners,
            away_corners =
              excluded.away_corners,
            home_fouls =
              excluded.home_fouls,
            away_fouls =
              excluded.away_fouls,
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
            odds_json =
              excluded.odds_json,
            raw_data_json =
              excluded.raw_data_json,
            updated_at =
              CURRENT_TIMESTAMP
        `).bind(
          league.id,
          season.id,
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
          FOOTBALL_DATA_SOURCE,
          sourceMatchId
        )
      );

      imported++;
    }

    if (
      statements.length
    ) {
      await env.DB.batch(
        statements
      );
    }
  }

  return {
    league:
      leagueConfig.name,

    country:
      leagueConfig.country,

    code:
      leagueConfig.code,

    season:
      seasonName,

    rows:
      rows.length,

    imported,

    skipped
  };
}

/*
 * =========================================================
 * IMPORT ONE LEAGUE
 * =========================================================
 */

async function importLeagueSeason(
  env,
  leagueCode,
  seasonName
) {
  const league =
    getLeague(
      leagueCode
    );

  if (!league) {
    throw new Error(
      `Unknown league code: ${leagueCode}`
    );
  }

  if (
    !SEASONS.includes(
      seasonName
    )
  ) {
    throw new Error(
      `Unknown season: ${seasonName}`
    );
  }

  const url =
    getSourceUrl(
      seasonName,
      leagueCode
    );

  const csv =
    await getRemoteCSV(
      url
    );

  return await importCSV(
    env,
    league,
    seasonName,
    csv
  );
}

/*
 * =========================================================
 * MASS IMPORT
 * =========================================================
 */

async function importAllLeagues(
  env,
  seasonName,
  part
) {
  const totalParts =
    Math.ceil(
      LEAGUES.length /
      MASS_IMPORT_CHUNK_SIZE
    );

  const safePart =
    Math.min(
      Math.max(
        Number.isFinite(part)
          ? Math.trunc(part)
          : 1,
        1
      ),
      totalParts
    );

  const start =
    (
      safePart - 1
    ) *
    MASS_IMPORT_CHUNK_SIZE;

  const selectedLeagues =
    LEAGUES.slice(
      start,
      start +
        MASS_IMPORT_CHUNK_SIZE
    );

  const results = [];

  let successful = 0;
  let failed = 0;
  let totalImported = 0;
  let totalSkipped = 0;

  for (
    const league
    of selectedLeagues
  ) {
    try {
      console.log(
        `Starting import ${league.code} ${seasonName}`
      );

      const result =
        await importLeagueSeason(
          env,
          league.code,
          seasonName
        );

      results.push({
        ok: true,
        ...result
      });

      successful++;

      totalImported +=
        Number(
          result.imported || 0
        );

      totalSkipped +=
        Number(
          result.skipped || 0
        );

      console.log(
        `Import OK ${league.code}: ${result.imported} matches`
      );
    } catch (e) {
      failed++;

      results.push({
        ok: false,

        league:
          league.name,

        country:
          league.country,

        code:
          league.code,

        season:
          seasonName,

        error:
          String(
            e.message || e
          )
      });

      console.error(
        `Import FAILED ${league.code}:`,
        String(
          e.message || e
        )
      );
    }
  }

  return {
    season:
      seasonName,

    part:
      safePart,

    totalParts,

    requested:
      selectedLeagues.length,

    successful,

    failed,

    totalImported,

    totalSkipped,

    leagues:
      selectedLeagues.map(
        league => ({
          code:
            league.code,

          name:
            league.name,

          country:
            league.country
        })
      ),

    results,

    nextPart:
      safePart <
      totalParts
        ? safePart + 1
        : null
  };
}

/*
 * =========================================================
 * GET LEAGUES
 * =========================================================
 */

async function getLeagueList(
  env
) {
  const result =
    await env.DB.prepare(`
      SELECT
        l.id,
        l.name,
        l.country,
        l.code,
        l.source,
        COUNT(
          DISTINCT m.id
        ) AS matches

      FROM leagues l

      LEFT JOIN matches m
        ON m.league_id =
           l.id

      WHERE
        l.source = ?

      GROUP BY
        l.id,
        l.name,
        l.country,
        l.code,
        l.source

      ORDER BY
        l.country,
        l.name
    `).bind(
      FOOTBALL_DATA_SOURCE
    ).all();

  return (
    result.results || []
  );
}

/*
 * =========================================================
 * GET SEASONS
 * =========================================================
 */

async function getSeasonList(
  env
) {
  const result =
    await env.DB.prepare(`
      SELECT
        s.id,
        s.name,
        s.start_year,
        s.end_year,
        l.name AS league,
        l.code AS league_code,
        l.country

      FROM seasons s

      JOIN leagues l
        ON l.id =
           s.league_id

      WHERE
        s.source = ?

      ORDER BY
        s.start_year DESC,
        l.country,
        l.name
    `).bind(
      FOOTBALL_DATA_SOURCE
    ).all();

  return (
    result.results || []
  );
}

/*
 * =========================================================
 * GET MATCHES
 * =========================================================
 */

async function getMatches(
  env,
  url
) {
  const requestedLimit =
    Number(
      url.searchParams.get(
        'limit'
      ) || '1000'
    );

  const requestedOffset =
    Number(
      url.searchParams.get(
        'offset'
      ) || '0'
    );

  const leagueCode =
    clean(
      url.searchParams.get(
        'league'
      )
    );

  const seasonName =
    clean(
      url.searchParams.get(
        'season'
      )
    );

  const teamName =
    clean(
      url.searchParams.get(
        'team'
      )
    );

  const refereeName =
    clean(
      url.searchParams.get(
        'referee'
      )
    );

  const limit =
    Math.min(
      Math.max(
        Number.isFinite(
          requestedLimit
        )
          ? Math.trunc(
              requestedLimit
            )
          : 1000,
        1
      ),
      2000
    );

  const offset =
    Math.max(
      Number.isFinite(
        requestedOffset
      )
        ? Math.trunc(
            requestedOffset
          )
        : 0,
      0
    );

  const where = [];
  const binds = [];

  if (leagueCode) {
    where.push(
      'l.code = ?'
    );

    binds.push(
      leagueCode
    );
  }

  if (seasonName) {
    where.push(
      's.name = ?'
    );

    binds.push(
      seasonName
    );
  }

  if (teamName) {
    where.push(
      '(ht.name = ? OR at.name = ?)'
    );

    binds.push(
      teamName,
      teamName
    );
  }

  if (refereeName) {
    where.push(
      'r.name = ?'
    );

    binds.push(
      refereeName
    );
  }

  const whereSQL =
    where.length
      ? 'WHERE ' +
        where.join(
          ' AND '
        )
      : '';

  const countResult =
    await env.DB.prepare(`
      SELECT
        COUNT(*) AS total

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

      ${whereSQL}
    `).bind(
      ...binds
    ).first();

  const total =
    Number(
      countResult?.total || 0
    );

  const query = `
    SELECT
      m.*,

      s.name AS season,

      l.name AS league,
      l.country AS league_country,
      l.code AS league_code,

      ht.name AS home_team,
      at.name AS away_team,

      r.name AS referee

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

    ${whereSQL}

    ORDER BY
      m.match_date DESC,
      m.id DESC

    LIMIT ?
    OFFSET ?
  `;

  const result =
    await env.DB
      .prepare(query)
      .bind(
        ...binds,
        limit,
        offset
      )
      .all();

  const matches =
    (
      result.results || []
    ).map(
      match => {
        let odds = {};
        let rawData = {};

        try {
          odds =
            match.odds_json
              ? JSON.parse(
                  match.odds_json
                )
              : {};
        } catch (_) {}

        try {
          rawData =
            match.raw_data_json
              ? JSON.parse(
                  match.raw_data_json
                )
              : {};
        } catch (_) {}

        return {
          ...match,

          odds,

          raw_data:
            rawData
        };
      }
    );

  return {
    ok: true,

    count:
      matches.length,

    total,

    limit,

    offset,

    matches
  };
}

/*
 * =========================================================
 * API-FOOTBALL
 * =========================================================
 */

const API_FOOTBALL_SOURCE = 'api-football';
const API_BASE = 'https://v3.football.api-sports.io';
const API_SEASON = 2026;

/*
 * API-Football free plan has a 10 requests/minute limit.
 * Keep each scheduled batch at <= 5 league requests.
 * The five batches are refreshed on Monday at the existing
 * 03/08/13/18/23 UTC cron slots.
 */
const API_REFRESH_PARTS = [
  ['E0', 'E1', 'E2', 'E3', 'EC'],
  ['SC0', 'SC1', 'SC2', 'SC3', 'D1'],
  ['D2', 'I1', 'I2', 'SP1', 'SP2'],
  ['F1', 'F2', 'N1', 'B1'],
  ['P1', 'T1', 'G1']
];

const API_REFRESH_HOURS = [3, 8, 13, 18, 23];

function apiSeasonFromName(seasonName) {
  const match = String(seasonName || '').match(/^(\d{4})\/\d{2}$/);
  return match ? Number(match[1]) : API_SEASON;
}

const API_LEAGUE_IDS = {
  E0: 39,
  E1: 40,
  E2: 41,
  E3: 42,
  EC: 43,

  SC0: 179,
  SC1: 180,
  SC2: 181,
  SC3: 182,

  D1: 78,
  D2: 79,

  I1: 135,
  I2: 136,

  SP1: 140,
  SP2: 141,

  F1: 61,
  F2: 62,

  N1: 88,
  B1: 144,
  P1: 94,
  T1: 203,
  G1: 197
};

function normalizeTeamName(
  name
) {
  return String(
    name || ''
  )
    .toLowerCase()
    .normalize('NFD')
    .replace(
      /[\u0300-\u036f]/g,
      ''
    )
    .replace(
      /&/g,
      'and'
    )
    .replace(
      /[^a-z0-9]+/g,
      ' '
    )
    .trim()
    .replace(
      /\s+/g,
      ' '
    );
}

const TEAM_ALIASES = {
  'man united':
    'manchester united',

  'man utd':
    'manchester united',

  'manchester utd':
    'manchester united',

  'man city':
    'manchester city',

  'nott m forest':
    'nottingham forest',

  'wolves':
    'wolverhampton wanderers',

  'wolverhampton':
    'wolverhampton wanderers',

  'spurs':
    'tottenham',

  'tottenham hotspur':
    'tottenham',

  'newcastle':
    'newcastle united',

  'west ham':
    'west ham united',

  'brighton and hove albion':
    'brighton',

  'leicester':
    'leicester city',

  'ipswich':
    'ipswich town',

  'qpr':
    'queens park rangers',

  'stoke':
    'stoke city',

  'west brom':
    'west bromwich albion',

  'sheffield utd':
    'sheffield united',

  'sheffield weds':
    'sheffield wednesday',

  'blackburn':
    'blackburn rovers',

  'bolton':
    'bolton wanderers',

  'preston':
    'preston north end',

  'cardiff':
    'cardiff city',

  'swansea':
    'swansea city',

  'birmingham':
    'birmingham city',

  'coventry':
    'coventry city',

  'luton':
    'luton town',

  'derby':
    'derby county',

  'hull':
    'hull city',

  'millwall':
    'millwall',

  'plymouth':
    'plymouth argyle',

  'wigan':
    'wigan athletic',

  'charlton':
    'charlton athletic',

  'exeter':
    'exeter city',

  'wycombe':
    'wycombe wanderers'
};

function teamKey(
  name
) {
  const normalized =
    normalizeTeamName(
      name
    );

  return (
    TEAM_ALIASES[
      normalized
    ] ||
    normalized
  );
}

function similarity(
  a,
  b
) {
  if (!a || !b) {
    return 0;
  }

  if (a === b) {
    return 1;
  }

  if (
    a.includes(b) ||
    b.includes(a)
  ) {
    return (
      Math.min(
        a.length,
        b.length
      ) /
      Math.max(
        a.length,
        b.length
      )
    );
  }

  const aa =
    new Set(
      a.split(' ')
    );

  const bb =
    new Set(
      b.split(' ')
    );

  const intersection =
    [...aa].filter(
      x => bb.has(x)
    ).length;

  const union =
    new Set([
      ...aa,
      ...bb
    ]).size;

  return union
    ? intersection / union
    : 0;
}

async function apiFootball(
  env,
  path,
  params = {}
) {
  if (
    !env.API_FOOTBALL_KEY
  ) {
    throw new Error(
      'Brak sekretu API_FOOTBALL_KEY'
    );
  }

  const url =
    new URL(
      API_BASE + path
    );

  for (
    const [key, value]
    of Object.entries(
      params
    )
  ) {
    if (
      value !== undefined &&
      value !== null &&
      value !== ''
    ) {
      url.searchParams.set(
        key,
        value
      );
    }
  }

  const response =
    await fetch(
      url.toString(),
      {
        method: 'GET',

        headers: {
          'x-apisports-key':
            env.API_FOOTBALL_KEY
        }
      }
    );

  if (!response.ok) {
    throw new Error(
      `API-Football HTTP ${response.status}`
    );
  }

  const data =
    await response.json();

  if (
    data.errors &&
    Object.keys(
      data.errors
    ).length
  ) {
    throw new Error(
      JSON.stringify(
        data.errors
      )
    );
  }

  return data;
}

async function getStatsTeamMap(
  env,
  leagueId,
  seasonId
) {
  const result =
    await env.DB.prepare(`
      SELECT DISTINCT
        t.id,
        t.name

      FROM teams t

      JOIN matches m
        ON (
          m.home_team_id = t.id
          OR
          m.away_team_id = t.id
        )

      WHERE
        m.league_id = ?
        AND
        m.season_id = ?
        AND
        t.source = ?

      ORDER BY
        t.name
    `).bind(
      leagueId,
      seasonId,
      FOOTBALL_DATA_SOURCE
    ).all();

  return (
    result.results || []
  );
}

function resolveStatsTeam(
  statsTeams,
  apiName
) {
  const apiKey =
    teamKey(
      apiName
    );

  const exact =
    statsTeams.filter(
      team =>
        teamKey(
          team.name
        ) === apiKey
    );

  if (
    exact.length === 1
  ) {
    return exact[0];
  }

  if (
    exact.length > 1
  ) {
    return null;
  }

  let best = null;
  let bestScore = 0;
  let secondScore = 0;

  for (
    const team
    of statsTeams
  ) {
    const score =
      similarity(
        apiKey,
        teamKey(
          team.name
        )
      );

    if (
      score > bestScore
    ) {
      secondScore =
        bestScore;

      bestScore =
        score;

      best =
        team;
    } else if (
      score > secondScore
    ) {
      secondScore =
        score;
    }
  }

  if (
    best &&
    bestScore >= 0.75 &&
    bestScore -
      secondScore >= 0.10
  ) {
    return best;
  }

  return null;
}

function fixtureStatus(
  short
) {
  const live = [
    '1H',
    '2H',
    'ET',
    'P',
    'BT',
    'LIVE'
  ];

  if (
    live.includes(
      short
    )
  ) {
    return 'live';
  }

  if (
    short === 'FT' ||
    short === 'AET' ||
    short === 'PEN'
  ) {
    return 'finished';
  }

  if (
    short === 'PST' ||
    short === 'CANC' ||
    short === 'ABD' ||
    short === 'AWD' ||
    short === 'WO'
  ) {
    return 'cancelled';
  }

  if (
    short === 'SUSP'
  ) {
    return 'postponed';
  }

  return 'scheduled';
}

async function importApiLeague(
  env,
  leagueConfig,
  seasonName = CURRENT_SEASON
) {
  const league =
    await env.DB.prepare(`
      SELECT
        id,
        name,
        country,
        code

      FROM leagues

      WHERE
        code = ?
        AND
        source = ?

      LIMIT 1
    `).bind(
      leagueConfig.code,
      FOOTBALL_DATA_SOURCE
    ).first();

  if (!league) {
    return {
      code:
        leagueConfig.code,

      imported: 0,

      skipped: 0,

      reason:
        'Brak ligi w bazie statystycznej'
    };
  }

  const season =
    await env.DB.prepare(`
      SELECT
        id,
        name

      FROM seasons

      WHERE
        league_id = ?
        AND
        name = ?
        AND
        source = ?

      LIMIT 1
    `).bind(
      league.id,
      seasonName,
      FOOTBALL_DATA_SOURCE
    ).first();

  if (!season) {
    return {
      code:
        leagueConfig.code,

      imported: 0,

      skipped: 0,

      reason:
        'Brak sezonu w bazie statystycznej'
    };
  }

  const statsTeams =
    await getStatsTeamMap(
      env,
      league.id,
      season.id
    );

  if (
    !statsTeams.length
  ) {
    return {
      code:
        leagueConfig.code,

      imported: 0,

      skipped: 0,

      reason:
        'Brak drużyn w danych statystycznych'
    };
  }

  const apiLeagueId =
    API_LEAGUE_IDS[
      leagueConfig.code
    ];

  if (!apiLeagueId) {
    return {
      code:
        leagueConfig.code,

      imported: 0,

      skipped: 0,

      reason:
        'Brak API league ID'
    };
  }

  const data =
    await apiFootball(
      env,
      '/fixtures',
      {
        league:
          apiLeagueId,

        season:
          apiSeasonFromName(seasonName)
      }
    );

  const fixtures =
    data.response || [];

  let imported = 0;
  let skipped = 0;

  for (
    const fixture
    of fixtures
  ) {
    const fixtureId =
      fixture.fixture?.id;

    const homeApiName =
      fixture.teams?.home?.name;

    const awayApiName =
      fixture.teams?.away?.name;

    const kickoff =
      fixture.fixture?.date;

    if (
      !fixtureId ||
      !homeApiName ||
      !awayApiName ||
      !kickoff
    ) {
      skipped++;
      continue;
    }

    const homeTeam =
      resolveStatsTeam(
        statsTeams,
        homeApiName
      );

    const awayTeam =
      resolveStatsTeam(
        statsTeams,
        awayApiName
      );

    if (
      !homeTeam ||
      !awayTeam
    ) {
      skipped++;
      continue;
    }

    const kickoffDate =
      new Date(
        kickoff
      );

    if (
      Number.isNaN(
        kickoffDate.getTime()
      )
    ) {
      skipped++;
      continue;
    }

    const matchDate =
      kickoff.slice(
        0,
        10
      );

    const status =
      fixtureStatus(
        fixture.fixture?.status?.short
      );

    const rawData = {
      fixture:
        fixture.fixture || null,

      league:
        fixture.league || null,

      teams:
        fixture.teams || null
    };

    await env.DB.prepare(`
      DELETE FROM fixtures

      WHERE
        source = ?
        AND
        source_match_id = ?
    `).bind(
      API_FOOTBALL_SOURCE,
      String(
        fixtureId
      )
    ).run();

    await env.DB.prepare(`
      INSERT INTO fixtures (
        league_id,
        season_id,
        match_date,
        home_team_id,
        away_team_id,
        referee_id,
        status,
        source,
        source_match_id,
        raw_data_json,
        created_at,
        updated_at
      )

      VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
    `).bind(
      league.id,
      season.id,
      matchDate,
      homeTeam.id,
      awayTeam.id,
      null,
      status,
      API_FOOTBALL_SOURCE,
      String(
        fixtureId
      ),
      JSON.stringify(
        rawData
      )
    ).run();

    imported++;
  }

  return {
    code:
      leagueConfig.code,

    league:
      leagueConfig.name,

    country:
      leagueConfig.country,

    apiId:
      apiLeagueId,

    season:
      seasonName,

    totalApiFixtures:
      fixtures.length,

    imported,

    skipped
  };
}

async function refreshApiFixtures(
  env,
  seasonName = CURRENT_SEASON,
  leagueCodes = null
) {
  const wantedCodes =
    Array.isArray(leagueCodes) && leagueCodes.length
      ? new Set(leagueCodes)
      : null;

  const leagues = wantedCodes
    ? LEAGUES.filter(league => wantedCodes.has(league.code))
    : LEAGUES;

  const results = [];

  for (const league of leagues) {
    try {
      const result = await importApiLeague(
        env,
        league,
        seasonName
      );

      results.push({
        ok: true,
        ...result
      });

      console.log(
        'API-Football OK',
        JSON.stringify(result)
      );
    } catch (e) {
      const error = String(e.message || e);

      results.push({
        ok: false,
        code: league.code,
        league: league.name,
        error
      });

      console.error(
        `API-Football FAILED ${league.code}:`,
        error
      );
    }
  }

  return {
    ok: true,
    source: API_FOOTBALL_SOURCE,
    season: seasonName,
    requestedLeagues: leagues.map(league => league.code),
    results
  };
}

/*
 * =========================================================
 * FIXTURES API
 * =========================================================
 */

async function getFixtures(
  env,
  date
) {
  const result =
    await env.DB.prepare(`
      SELECT
        f.id,
        f.match_date,
        f.status,
        f.source_match_id,

        l.code AS league_code,
        l.name AS league_name,
        l.country AS league_country,

        ht.name AS home_team,
        at.name AS away_team,

        f.raw_data_json

      FROM fixtures f

      JOIN leagues l
        ON l.id = f.league_id

      JOIN teams ht
        ON ht.id = f.home_team_id

      JOIN teams at
        ON at.id = f.away_team_id

      WHERE
        f.source = ?
        AND
        f.match_date = ?

      ORDER BY
        l.country,
        l.name,
        json_extract(
          f.raw_data_json,
          '$.fixture.timestamp'
        ),
        ht.name
    `).bind(
      API_FOOTBALL_SOURCE,
      date
    ).all();

  return (
    result.results || []
  ).map(
    row => {
      let raw = {};

      try {
        raw =
          JSON.parse(
            row.raw_data_json || '{}'
          );
      } catch (_) {
        raw = {};
      }

      const fixture =
        raw.fixture || {};

      return {
        id:
          row.id,

        fixture_id:
          row.source_match_id,

        date:
          row.match_date,

        kickoff:
          fixture.date || null,

        timestamp:
          fixture.timestamp || null,

        status:
          row.status,

        league: {
          code:
            row.league_code,

          name:
            row.league_name,

          country:
            row.league_country
        },

        home_team:
          row.home_team,

        away_team:
          row.away_team,

        venue:
          fixture.venue || null
      };
    }
  );
}

/*
 * =========================================================
 * MAIN WORKER
 * =========================================================
 */

export default {

  async fetch(
    request,
    env,
    ctx
  ) {
    const url =
      new URL(
        request.url
      );

    /*
     * TEST
     */

    if (
      url.pathname ===
      '/api/test'
    ) {
      return new Response(
        'WORKER OK',
        {
          status: 200,

          headers: {
            'content-type':
              'text/plain; charset=utf-8'
          }
        }
      );
    }

    /*
     * API-FOOTBALL TEST
     */

    if (
      url.pathname ===
      '/api/api-football-test'
    ) {
      return json(
        await testApiFootball(
          env
        )
      );
    }

    /*
     * DB TEST
     */

    if (
      url.pathname ===
      '/api/db-test'
    ) {
      try {
        return json({
          ok: true,

          database:
            'football-analyzer-db',

          counts:
            await getCounts(
              env
            )
        });
      } catch (e) {
        return json(
          {
            ok: false,

            error:
              String(
                e.message || e
              )
          },
          500
        );
      }
    }

    /*
     * LEAGUES
     */

    if (
      url.pathname ===
      '/api/leagues'
    ) {
      try {
        return json({
          ok: true,

          available:
            LEAGUES,

          imported:
            await getLeagueList(
              env
            )
        });
      } catch (e) {
        return json(
          {
            ok: false,

            error:
              String(
                e.message || e
              )
          },
          500
        );
      }
    }

    /*
     * SEASONS
     */

    if (
      url.pathname ===
      '/api/seasons'
    ) {
      try {
        return json({
          ok: true,

          seasons:
            await getSeasonList(
              env
            )
        });
      } catch (e) {
        return json(
          {
            ok: false,

            error:
              String(
                e.message || e
              )
          },
          500
        );
      }
    }

    /*
     * MATCHES
     */

    if (
      url.pathname ===
      '/api/matches'
    ) {
      try {
        return json(
          await getMatches(
            env,
            url
          )
        );
      } catch (e) {
        return json(
          {
            ok: false,

            error:
              String(
                e.message || e
              )
          },
          500
        );
      }
    }

    /*
     * FIXTURES
     *
     * /api/fixtures?date=2026-09-12
     */

    if (
      url.pathname ===
      '/api/fixtures'
    ) {
      try {
        const date =
          clean(
            url.searchParams.get(
              'date'
            )
          );

        if (!date) {
          return json(
            {
              ok: false,

              error:
                'Brak parametru date. Użyj /api/fixtures?date=YYYY-MM-DD'
            },
            400
          );
        }

        if (
          !/^\d{4}-\d{2}-\d{2}$/.test(
            date
          )
        ) {
          return json(
            {
              ok: false,

              error:
                'Nieprawidłowy format daty. Użyj YYYY-MM-DD.'
            },
            400
          );
        }

        const fixtures =
          await getFixtures(
            env,
            date
          );

        return json({
          ok: true,

          date,

          count:
            fixtures.length,

          fixtures
        });
      } catch (e) {
        return json(
          {
            ok: false,

            error:
              String(
                e.message || e
              )
          },
          500
        );
      }
    }

    /*
     * API-FOOTBALL REFRESH
     *
     * /api/fixtures-refresh
     * ?token=FA-IMPORT-2026-09
     * &season=2026/27
     */

    if (
      url.pathname ===
      '/api/fixtures-refresh'
    ) {
      const token =
        url.searchParams.get(
          'token'
        );

      if (
        token !==
        IMPORT_TOKEN
      ) {
        return json(
          {
            ok: false,

            error:
              'Unauthorized'
          },
          401
        );
      }

      const season =
        clean(
          url.searchParams.get(
            'season'
          )
        ) ||
        CURRENT_SEASON;

      if (
        !SEASONS.includes(
          season
        )
      ) {
        return json(
          {
            ok: false,

            error:
              `Unknown season: ${season}`,

            available:
              SEASONS
          },
          400
        );
      }

      const partParam =
        clean(
          url.searchParams.get(
            'part'
          )
        );

      let leagueCodes = null;

      if (partParam) {
        const partNumber = Number(partParam);

        if (
          !Number.isInteger(partNumber) ||
          partNumber < 1 ||
          partNumber > API_REFRESH_PARTS.length
        ) {
          return json(
            {
              ok: false,
              error:
                `Unknown part: ${partParam}`,
              availableParts:
                API_REFRESH_PARTS.map((codes, index) => ({
                  part: index + 1,
                  leagues: codes
                }))
            },
            400
          );
        }

        leagueCodes =
          API_REFRESH_PARTS[partNumber - 1];
      }

      const leagueParam =
        clean(
          url.searchParams.get(
            'league'
          )
        );

      if (leagueParam) {
        leagueCodes = [leagueParam.toUpperCase()];
      }

      try {
        return json(
          await refreshApiFixtures(
            env,
            season,
            leagueCodes
          )
        );
      } catch (e) {
        return json(
          {
            ok: false,

            error:
              String(
                e.message || e
              )
          },
          502
        );
      }
    }

    /*
     * IMPORT ONE
     */

    if (
      url.pathname ===
      '/api/import'
    ) {
      const token =
        url.searchParams.get(
          'token'
        );

      if (
        token !==
        IMPORT_TOKEN
      ) {
        return json(
          {
            ok: false,

            error:
              'Unauthorized'
          },
          401
        );
      }

      try {
        const leagueCode =
          clean(
            url.searchParams.get(
              'league'
            )
          );

        const seasonName =
          clean(
            url.searchParams.get(
              'season'
            )
          );

        if (
          !leagueCode ||
          !seasonName
        ) {
          return json(
            {
              ok: false,

              error:
                'Use league=E0&season=2025/26'
            },
            400
          );
        }

        const result =
          await importLeagueSeason(
            env,
            leagueCode,
            seasonName
          );

        return json({
          ok: true,

          result,

          counts:
            await getCounts(
              env
            )
        });
      } catch (e) {
        return json(
          {
            ok: false,

            error:
              String(
                e.message || e
              ),

            note:
              'Existing data was not deleted or cleared.'
          },
          502
        );
      }
    }

    /*
     * IMPORT ALL
     */

    if (
      url.pathname ===
      '/api/import-all'
    ) {
      const token =
        url.searchParams.get(
          'token'
        );

      if (
        token !==
        IMPORT_TOKEN
      ) {
        return json(
          {
            ok: false,

            error:
              'Unauthorized'
          },
          401
        );
      }

      const seasonName =
        clean(
          url.searchParams.get(
            'season'
          )
        ) ||
        '2025/26';

      if (
        !SEASONS.includes(
          seasonName
        )
      ) {
        return json(
          {
            ok: false,

            error:
              `Unknown season: ${seasonName}`,

            available:
              SEASONS
          },
          400
        );
      }

      const part =
        Number(
          url.searchParams.get(
            'part'
          ) || '1'
        );

      try {
        const result =
          await importAllLeagues(
            env,
            seasonName,
            part
          );

        return json({
          ok: true,

          result,

          counts:
            await getCounts(
              env
            )
        });
      } catch (e) {
        return json(
          {
            ok: false,

            error:
              String(
                e.message || e
              ),

            note:
              'Existing data was not deleted or cleared.'
          },
          502
        );
      }
    }

    /*
     * REFRESH ONE LEAGUE
     */

    if (
      url.pathname ===
      '/api/refresh'
    ) {
      const token =
        url.searchParams.get(
          'token'
        );

      if (
        token !==
        IMPORT_TOKEN
      ) {
        return json(
          {
            ok: false,

            error:
              'Unauthorized'
          },
          401
        );
      }

      try {
        const leagueCode =
          clean(
            url.searchParams.get(
              'league'
            )
          );

        if (!leagueCode) {
          return json(
            {
              ok: false,

              error:
                'Use league=E0'
            },
            400
          );
        }

        const result =
          await importLeagueSeason(
            env,
            leagueCode,
            CURRENT_SEASON
          );

        return json({
          ok: true,

          result,

          counts:
            await getCounts(
              env
            )
        });
      } catch (e) {
        return json(
          {
            ok: false,

            error:
              String(
                e.message || e
              )
          },
          502
        );
      }
    }

    return env.ASSETS.fetch(
      request
    );
  },

  async scheduled(
    controller,
    env,
    ctx
  ) {
    const date =
      new Date(
        controller.scheduledTime
      );

    const hour =
      date.getUTCHours();

    const day =
      date.getUTCDay();

    /*
     * API-FOOTBALL:
     * pełny tygodniowy refresh jest dzielony na 5 partii,
     * po jednej na każdy poniedziałkowy slot cron.
     * Dzięki temu nie przekraczamy limitu 10 req/min.
     */

    const apiSlot =
      API_REFRESH_HOURS.indexOf(hour);

    if (
      day === 1 &&
      apiSlot >= 0
    ) {
      const apiLeagues =
        API_REFRESH_PARTS[apiSlot];

      ctx.waitUntil(
        (async () => {
          try {
            const result =
              await refreshApiFixtures(
                env,
                CURRENT_SEASON,
                apiLeagues
              );

            console.log(
              'API-Football weekly batch FINISHED',
              JSON.stringify({
                slot: apiSlot + 1,
                leagues: apiLeagues,
                result
              })
            );
          } catch (e) {
            console.error(
              'API-Football weekly batch FAILED:',
              String(
                e.message || e
              )
            );
          }
        })()
      );
    }

    /*
     * FOOTBALL-DATA:
     * dotychczasowa rotacja.
     */

    const slot =
      CRON_HOURS.indexOf(
        hour
      );

    if (
      slot < 0
    ) {
      return;
    }

    const part =
      getCronRefreshPart(
        controller.scheduledTime
      );

    const leagues =
      REFRESH_PARTS[
        part - 1
      ];

    console.log(
      'Football-Data scheduled refresh START',
      JSON.stringify({
        scheduledTime:
          date.toISOString(),

        part,

        leagues
      })
    );

    ctx.waitUntil(
      (async () => {
        try {
          const results = [];

          for (
            const leagueCode
            of leagues
          ) {
            try {
              const result =
                await importLeagueSeason(
                  env,
                  leagueCode,
                  CURRENT_SEASON
                );

              results.push({
                ok: true,

                ...result
              });
            } catch (e) {
              results.push({
                ok: false,

                code:
                  leagueCode,

                error:
                  String(
                    e.message || e
                  )
              });
            }
          }

          console.log(
            'Football-Data scheduled refresh FINISHED',
            JSON.stringify({
              part,
              leagues,
              results
            })
          );
        } catch (e) {
          console.error(
            'Football-Data scheduled refresh FAILED:',
            String(
              e.message || e
            )
          );
        }
      })()
    );
  }
};

/*
 * =========================================================
 * CRON PART
 * =========================================================
 */

function getCronRefreshPart(
  scheduledTime
) {
  const date =
    new Date(
      scheduledTime
    );

  const hour =
    date.getUTCHours();

  let slot =
    CRON_HOURS.indexOf(
      hour
    );

  if (
    slot < 0
  ) {
    slot = 0;
  }

  const dayNumber =
    Math.floor(
      Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate()
      ) /
      86400000
    );

  const index =
    (
      dayNumber *
      CRON_HOURS.length +
      slot
    ) %
    REFRESH_PARTS.length;

  return index + 1;
}

/*
 * =========================================================
 * API-FOOTBALL TEST
 * =========================================================
 */

async function testApiFootball(
  env
) {
  try {
    const data =
      await apiFootball(
        env,
        '/status'
      );

    return {
      ok: true,
      api: data
    };
  } catch (e) {
    return {
      ok: false,

      error:
        String(
          e.message || e
        )
    };
  }
}

/*
 * =========================================================
 * JSON
 * =========================================================
 */

function json(
  data,
  status = 200
) {
  return new Response(
    JSON.stringify(
      data
    ),
    {
      status,

      headers: {
        'content-type':
          'application/json; charset=utf-8',

        'cache-control':
          'no-store',

        'access-control-allow-origin':
          '*',

        'access-control-allow-methods':
          'GET,POST,OPTIONS',

        'access-control-allow-headers':
          'Content-Type'
      }
    }
  );
}
