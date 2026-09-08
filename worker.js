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

  /*
   * =======================================================
   * TEAMS + REFEREES
   * =======================================================
   */

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

  /*
   * =======================================================
   * MAPY TEAM / REFEREE
   * =======================================================
   */

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

  /*
   * =======================================================
   * MATCHES
   * =======================================================
   */

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
 * LEAGUES API
 * =========================================================
 */

async function getLeagueList(env) {
  const result =
    await env.DB
      .prepare(`
        SELECT
          l.id,
          l.name,
          l.country,
          l.code,
          COUNT(DISTINCT m.id) AS matches
        FROM leagues l
        LEFT JOIN matches m
          ON m.league_id = l.id
        GROUP BY
          l.id,
          l.name,
          l.country,
          l.code
        ORDER BY
          l.country,
          l.name
      `)
      .all();

  return (
    result.results || []
  );
}

/*
 * =========================================================
 * SEASONS API
 * =========================================================
 */

async function getSeasonList(env) {
  const result =
    await env.DB
      .prepare(`
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
          ON l.id = s.league_id
        ORDER BY
          s.start_year DESC,
          l.country,
          l.name
      `)
      .all();

  return (
    result.results || []
  );
}

/*
 * =========================================================
 * CRON - WYBÓR PACZKI
 * =========================================================
 *
 * Na podstawie daty i godziny wyliczamy,
 * którą paczkę należy odświeżyć.
 *
 * Dzięki temu nie potrzebujemy dodatkowej
 * tabeli w D1 do przechowywania stanu.
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

  /*
   * Zabezpieczenie:
   * jeżeli Cloudflare poda godzinę,
   * której nie ma w konfiguracji,
   * używamy 0.
   */
  if (slot < 0) {
    slot = 0;
  }

  /*
   * Liczba dni od epoki.
   */
  const dayNumber =
    Math.floor(
      Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate()
      ) /
      86400000
    );

  /*
   * Każdy dzień ma 5 slotów.
   *
   * 5 slotów x kolejne dni
   * daje ciągłą rotację 1..8.
   */
  const index =
    (
      dayNumber * CRON_HOURS.length +
      slot
    ) %
    REFRESH_PARTS.length;

  return index + 1;
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
      new URL(request.url);

    /*
     * ================================
     * TEST
     * ================================
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
     * ================================
     * DB TEST
     * ================================
     */

    if (
      url.pathname ===
      '/api/db-test'
    ) {
      try {
        const counts =
          await getCounts(
            env
          );

        return json({
          ok: true,

          database:
            'football-analyzer-db',

          counts
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
     * ================================
     * LEAGUES API
     * ================================
     */

    if (
      url.pathname ===
      '/api/leagues'
    ) {
      try {
        const leagues =
          await getLeagueList(
            env
          );

        return json({
          ok: true,

          available:
            LEAGUES,

          imported:
            leagues
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
     * ================================
     * SEASONS API
     * ================================
     */

    if (
      url.pathname ===
      '/api/seasons'
    ) {
      try {
        const seasons =
          await getSeasonList(
            env
          );

        return json({
          ok: true,
          seasons
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
     * ================================
     * MATCHES API
     * ================================
     */

    if (
      url.pathname ===
      '/api/matches'
    ) {
      try {
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

        const whereSQL =
          where.length
            ? 'WHERE ' +
              where.join(
                ' AND '
              )
            : '';

        const query = `
          SELECT
            m.id,
            m.match_date,
            m.status,

            s.name AS season,

            l.name AS league,
            l.country AS league_country,
            l.code AS league_code,

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

          ${whereSQL}

          ORDER BY
            m.match_date DESC,
            m.id DESC

          LIMIT ?
          OFFSET ?
        `;

        binds.push(
          limit,
          offset
        );

        const result =
          await env.DB
            .prepare(query)
            .bind(...binds)
            .all();

        const matches =
          (
            result.results || []
          ).map(
            match => ({
              ...match,

              odds:
                match.odds_json
                  ? JSON.parse(
                      match.odds_json
                    )
                  : {},

              raw_data:
                match.raw_data_json
                  ? JSON.parse(
                      match.raw_data_json
                    )
                  : {}
            })
          );

        return json({
          ok: true,

          count:
            matches.length,

          limit,

          offset,

          matches
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
     * ================================
     * IMPORT ONE LEAGUE / SEASON
     * ================================
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

        const counts =
          await getCounts(
            env
          );

        return json({
          ok: true,

          result,

          counts
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
     * ================================
     * MASS IMPORT
     * ================================
     *
     * part=1 -> E0, E1, E2
     * part=2 -> E3, EC, SC0
     * part=3 -> SC1, SC2, SC3
     * part=4 -> D1, D2, I1
     * part=5 -> I2, SP1, SP2
     * part=6 -> F1, F2, N1
     * part=7 -> B1, P1, T1
     * part=8 -> G1
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
        ) || '2025/26';

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

      const requestedPart =
        Number(
          url.searchParams.get(
            'part'
          ) || '1'
        );

      const part =
        Number.isFinite(
          requestedPart
        )
          ? Math.trunc(
              requestedPart
            )
          : 1;

      try {
        const result =
          await importAllLeagues(
            env,
            seasonName,
            part
          );

        const counts =
          await getCounts(
            env
          );

        return json({
          ok: true,

          message:
            'Mass league import part finished.',

          result,

          counts
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
     * ================================
     * CURRENT SEASON REFRESH
     * ================================
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
            '2026/27'
          );

        const counts =
          await getCounts(
            env
          );

        return json({
          ok: true,

          result,

          counts
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
     * ================================
     * STATIC ASSETS
     * ================================
     */

    return env.ASSETS.fetch(
      request
    );
  },

  /*
   * ========================================================
   * CRON
   * ========================================================
   */

  async scheduled(
    controller,
    env,
    ctx
  ) {
    const scheduledTime =
      controller.scheduledTime;

    const part =
      getCronRefreshPart(
        scheduledTime
      );

    const leagues =
      REFRESH_PARTS[
        part - 1
      ];

    console.log(
      'Football-Data scheduled refresh START',
      JSON.stringify({
        scheduledTime:
          new Date(
            scheduledTime
          ).toISOString(),

        part,

        totalParts:
          REFRESH_PARTS.length,

        leagues
      })
    );

    ctx.waitUntil(
      (async () => {
        try {
          /*
           * Cron zawsze odświeża
           * bieżący sezon 2026/27.
           */
          const results = [];

          for (
            const leagueCode
            of leagues
          ) {
            try {
              console.log(
                `Cron import START ${leagueCode} 2026/27`
              );

              const result =
                await importLeagueSeason(
                  env,
                  leagueCode,
                  '2026/27'
                );

              results.push({
                ok: true,
                ...result
              });

              console.log(
                `Cron import OK ${leagueCode}: ${result.imported} matches`
              );
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

              console.error(
                `Cron import FAILED ${leagueCode}:`,
                String(
                  e.message || e
                )
              );
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
 * JSON RESPONSE
 * =========================================================
 */

function json(
  data,
  status = 200
) {
  return new Response(
    JSON.stringify(data),
    {
      status,

      headers: {
        'content-type':
          'application/json; charset=utf-8',

        'cache-control':
          'no-store',

        'access-control-allow-origin':
          '*'
      }
    }
  );
}
