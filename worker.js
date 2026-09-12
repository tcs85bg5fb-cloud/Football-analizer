const FOOTBALL_DATA_SOURCE = 'football-data';
const FIXTURE_SOURCE = 'sofascore';
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

const MASS_IMPORT_CHUNK_SIZE = 3;
const MATCH_BATCH_SIZE = 100;

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
  if (
    value === undefined ||
    value === null
  ) {
    return null;
  }

  const v =
    String(value).trim();

  if (
    !v ||
    v === '-' ||
    v === 'NA' ||
    v === 'N/A'
  ) {
    return null;
  }

  return v;
}

function num(value) {
  const v =
    clean(value);

  if (v === null) {
    return null;
  }

  const n =
    Number(
      String(v).replace(',', '.')
    );

  return Number.isFinite(n)
    ? n
    : null;
}

function int(value) {
  const n =
    num(value);

  return n === null
    ? null
    : Math.trunc(n);
}

function dateToISO(value) {
  const v =
    clean(value);

  if (!v) {
    return null;
  }

  const m =
    v.match(
      /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/
    );

  if (m) {
    const [
      ,
      day,
      month,
      year
    ] = m;

    return (
      `${year}-` +
      `${month.padStart(2, '0')}-` +
      `${day.padStart(2, '0')}`
    );
  }

  if (
    /^\d{4}-\d{2}-\d{2}$/.test(v)
  ) {
    return v;
  }

  const d =
    new Date(v);

  if (
    !Number.isNaN(
      d.getTime()
    )
  ) {
    return d
      .toISOString()
      .slice(0, 10);
  }

  return null;
}

function getResult(row) {
  const direct =
    clean(row.FTR);

  if (
    direct === 'H' ||
    direct === 'D' ||
    direct === 'A'
  ) {
    return direct;
  }

  const home =
    int(row.FTHG);

  const away =
    int(row.FTAG);

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
  const direct =
    clean(row.HTR);

  if (
    direct === 'H' ||
    direct === 'D' ||
    direct === 'A'
  ) {
    return direct;
  }

  const home =
    int(row.HTHG);

  const away =
    int(row.HTAG);

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
      const n =
        num(value);

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
    const char =
      text[i];

    const next =
      text[i + 1];

    if (
      char === '"'
    ) {
      if (
        inQuotes &&
        next === '"'
      ) {
        cell += '"';
        i++;
      } else {
        inQuotes =
          !inQuotes;
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
      h =>
        String(h).trim()
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

function getSourceUrl(
  season,
  code
) {
  const [
    start,
    end
  ] =
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
        name =
          excluded.name,
        country =
          excluded.country
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
      WHERE
        source = ?
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

  /*
   * 2026/27 -> 2026 / 2027
   *
   * Poprzednio było:
   * 20 + 2026 = 202026
   */

  const startYear =
    Number(
      years[0]
    );

  const endYear =
    2000 +
    Number(
      years[1]
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

      ON CONFLICT(
        league_id,
        name
      )
      DO UPDATE SET
        start_year =
          excluded.start_year,
        end_year =
          excluded.end_year,
        source =
          excluded.source
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
      WHERE
        league_id = ?
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
      clean(
        row.HomeTeam
      );

    const away =
      clean(
        row.AwayTeam
      );

    const referee =
      clean(
        row.Referee
      );

    if (home) {
      teamNames.add(home);
    }

    if (away) {
      teamNames.add(away);
    }

    if (referee) {
      refereeNames.add(
        referee
      );
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

        ON CONFLICT(
          source,
          source_name
        )
        DO UPDATE SET
          name =
            excluded.name
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

        ON CONFLICT(
          source,
          source_name
        )
        DO UPDATE SET
          name =
            excluded.name
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
    for (
      let i = 0;
      i <
      teamRefStatements.length;
      i += MATCH_BATCH_SIZE
    ) {
      await env.DB.batch(
        teamRefStatements.slice(
          i,
          i + MATCH_BATCH_SIZE
        )
      );
    }
  }

  const teamQuery =
    env.DB.prepare(`
      SELECT
        id,
        source_name
      FROM teams
      WHERE
        source = ?
    `).bind(
      FOOTBALL_DATA_SOURCE
    );

  const refereeQuery =
    env.DB.prepare(`
      SELECT
        id,
        source_name
      FROM referees
      WHERE
        source = ?
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
        dateToISO(
          row.Date
        );

      const homeTeam =
        clean(
          row.HomeTeam
        );

      const awayTeam =
        clean(
          row.AwayTeam
        );

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
        clean(
          row.Referee
        );

      const refereeId =
        refereeName
          ? (
              refereeMap.get(
                refereeName
              ) ?? null
            )
          : null;

      const homeGoals =
        int(
          row.FTHG
        );

      const awayGoals =
        int(
          row.FTAG
        );

      const homeHTGoals =
        int(
          row.HTHG
        );

      const awayHTGoals =
        int(
          row.HTAG
        );

      const homeXG =
        num(
          row.HxG
        );

      const awayXG =
        num(
          row.AxG
        );

      const odds =
        JSON.stringify(
          getOdds(row)
        );

      const rawData =
        JSON.stringify(
          row
        );

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
 * TEAM NAME NORMALIZATION
 *
 * NAJWAŻNIEJSZA ZASADA:
 *
 * Nazwa istniejąca w tabeli teams jest kanoniczna.
 *
 * Fixtures NIGDY nie tworzą nowej drużyny.
 * =========================================================
 */

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
      ' and '
    )
    .replace(
      /['’`]/g,
      ''
    )
    .replace(
      /\b(fc|afc|cf|sc|ac|bc|cd|ud|rc|rfc|sv|vfb|tsg|fk|sk)\b/g,
      ' '
    )
    .replace(
      /\bfootball club\b/g,
      ' '
    )
    .replace(
      /\bfootball\b/g,
      ' '
    )
    .replace(
      /\bclub\b/g,
      ' '
    )
    .replace(
      /[^a-z0-9]+/g,
      ' '
    )
    .replace(
      /\s+/g,
      ' '
    )
    .trim();
}

const TEAM_ALIASES = {
  /*
   * England
   */

  'man utd':
    'manchester united',

  'man united':
    'manchester united',

  'manchester utd':
    'manchester united',

  'manchester united':
    'manchester united',

  'man city':
    'manchester city',

  'manchester city':
    'manchester city',

  'spurs':
    'tottenham',

  'tottenham':
    'tottenham',

  'tottenham hotspur':
    'tottenham',

  'wolves':
    'wolverhampton wanderers',

  'wolverhampton':
    'wolverhampton wanderers',

  'wolverhampton wanderers':
    'wolverhampton wanderers',

  'nott m forest':
    'nottingham forest',

  'nottm forest':
    'nottingham forest',

  'nott forest':
    'nottingham forest',

  'nottingham forest':
    'nottingham forest',

  'newcastle':
    'newcastle united',

  'newcastle united':
    'newcastle united',

  'west ham':
    'west ham united',

  'west ham united':
    'west ham united',

  'brighton':
    'brighton',

  'brighton hove albion':
    'brighton',

  'brighton and hove albion':
    'brighton',

  'leicester':
    'leicester city',

  'leicester city':
    'leicester city',

  'ipswich':
    'ipswich town',

  'ipswich town':
    'ipswich town',

  'qpr':
    'queens park rangers',

  'queens park rangers':
    'queens park rangers',

  'stoke':
    'stoke city',

  'stoke city':
    'stoke city',

  'west brom':
    'west bromwich albion',

  'west bromwich':
    'west bromwich albion',

  'west bromwich albion':
    'west bromwich albion',

  'sheffield utd':
    'sheffield united',

  'sheffield united':
    'sheffield united',

  'sheffield weds':
    'sheffield wednesday',

  'sheffield wednesday':
    'sheffield wednesday',

  'blackburn':
    'blackburn rovers',

  'blackburn rovers':
    'blackburn rovers',

  'bolton':
    'bolton wanderers',

  'bolton wanderers':
    'bolton wanderers',

  'preston':
    'preston north end',

  'preston north end':
    'preston north end',

  'cardiff':
    'cardiff city',

  'cardiff city':
    'cardiff city',

  'swansea':
    'swansea city',

  'swansea city':
    'swansea city',

  'birmingham':
    'birmingham city',

  'birmingham city':
    'birmingham city',

  'coventry':
    'coventry city',

  'coventry city':
    'coventry city',

  'luton':
    'luton town',

  'luton town':
    'luton town',

  'derby':
    'derby county',

  'derby county':
    'derby county',

  'hull':
    'hull city',

  'hull city':
    'hull city',

  'plymouth':
    'plymouth argyle',

  'plymouth argyle':
    'plymouth argyle',

  'wigan':
    'wigan athletic',

  'wigan athletic':
    'wigan athletic',

  'charlton':
    'charlton athletic',

  'charlton athletic':
    'charlton athletic',

  'exeter':
    'exeter city',

  'exeter city':
    'exeter city',

  'wycombe':
    'wycombe wanderers',

  'wycombe wanderers':
    'wycombe wanderers',

  /*
   * Germany
   */

  'bayern munich':
    'bayern munich',

  'bayern munchen':
    'bayern munich',

  'bayern munchen':
    'bayern munich',

  'fc bayern':
    'bayern munich',

  'borussia dortmund':
    'borussia dortmund',

  'dortmund':
    'borussia dortmund',

  'bvb':
    'borussia dortmund',

  'borussia monchengladbach':
    'borussia monchengladbach',

  'monchengladbach':
    'borussia monchengladbach',

  'gladbach':
    'borussia monchengladbach',

  'rb leipzig':
    'rb leipzig',

  'leipzig':
    'rb leipzig',

  'eintracht frankfurt':
    'eintracht frankfurt',

  'frankfurt':
    'eintracht frankfurt',

  /*
   * Spain
   */

  'atletico madrid':
    'atletico madrid',

  'atletico de madrid':
    'atletico madrid',

  'atletico':
    'atletico madrid',

  'athletic bilbao':
    'athletic club',

  'athletic club':
    'athletic club',

  'real betis':
    'real betis',

  'betis':
    'real betis',

  'real sociedad':
    'real sociedad',

  'rayo vallecano':
    'rayo vallecano',

  'celta vigo':
    'celta vigo',

  'celta':
    'celta vigo',

  'rcd espanyol':
    'espanyol',

  'espanyol':
    'espanyol',

  /*
   * France
   */

  'paris saint germain':
    'paris saint germain',

  'paris sg':
    'paris saint germain',

  'psg':
    'paris saint germain',

  'olympique lyon':
    'lyon',

  'olympique lyonnais':
    'lyon',

  'lyon':
    'lyon',

  'olympique marseille':
    'marseille',

  'olympique de marseille':
    'marseille',

  'marseille':
    'marseille',

  /*
   * Italy
   */

  'inter':
    'internazionale',

  'inter milan':
    'internazionale',

  'internazionale':
    'internazionale',

  'fc internazionale':
    'internazionale',

  'ac milan':
    'milan',

  'milan':
    'milan',

  'as roma':
    'roma',

  'roma':
    'roma',

  /*
   * Netherlands
   */

  'ajax':
    'ajax',

  'psv':
    'psv eindhoven',

  'psv eindhoven':
    'psv eindhoven',

  'feyenoord':
    'feyenoord',

  /*
   * Portugal
   */

  'sporting cp':
    'sporting cp',

  'sporting lisbon':
    'sporting cp',

  'sporting':
    'sporting cp',

  'fc porto':
    'porto',

  'porto':
    'porto',

  'sl benfica':
    'benfica',

  'benfica':
    'benfica',

  /*
   * Turkey
   */

  'galatasaray':
    'galatasaray',

  'fenerbahce':
    'fenerbahce',

  'besiktas':
    'besiktas',

  'trabzonspor':
    'trabzonspor'
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
      x =>
        bb.has(x)
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

/*
 * =========================================================
 * API-FOOTBALL
 *
 * Zostawione tylko dla istniejącego endpointu testowego.
 * Nie jest już używane do fixtures.
 * =========================================================
 */

const API_FOOTBALL_SOURCE =
  'api-football';

const API_BASE =
  'https://v3.football.api-sports.io';

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
    const [
      key,
      value
    ]
    of Object.entries(params)
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

      api:
        data
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
 * STATS TEAM MAP
 * =========================================================
 */

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

/*
 * =========================================================
 * RESOLVE TEAM
 *
 * Zawsze zwracamy istniejącą drużynę
 * z tabeli teams.
 *
 * Nigdy nie INSERTujemy drużyny tutaj.
 * =========================================================
 */

function resolveStatsTeam(
  statsTeams,
  sourceName
) {
  const original =
    clean(
      sourceName
    );

  if (!original) {
    return null;
  }

  const sourceKey =
    teamKey(
      original
    );

  /*
   * 1. Exact / normalized
   */

  const exact =
    statsTeams.filter(
      team =>
        teamKey(
          team.name
        ) === sourceKey
    );

  if (
    exact.length === 1
  ) {
    return exact[0];
  }

  /*
   * Jeżeli dwie drużyny
   * mają ten sam znormalizowany
   * klucz, nie zgadujemy.
   */

  if (
    exact.length > 1
  ) {
    return null;
  }

  /*
   * 2. Similarity
   *
   * Tylko jeśli przewaga
   * najlepszego wyniku nad
   * drugim jest odpowiednio duża.
   */

  let best = null;
  let bestScore = 0;
  let secondScore = 0;

  for (
    const team
    of statsTeams
  ) {
    const score =
      similarity(
        sourceKey,
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

/*
 * =========================================================
 * SOFASCORE FIXTURES
 * =========================================================
 */

const SOFASCORE_BASE =
  'https://www.sofascore.com/api/v1';

const SOFASCORE_LEAGUE_RULES = {
  E0: {
    country: 'england',
    names: [
      'premier league'
    ]
  },

  E1: {
    country: 'england',
    names: [
      'championship'
    ]
  },

  E2: {
    country: 'england',
    names: [
      'league one'
    ]
  },

  E3: {
    country: 'england',
    names: [
      'league two'
    ]
  },

  EC: {
    country: 'england',
    names: [
      'national league'
    ]
  },

  SC0: {
    country: 'scotland',
    names: [
      'premiership',
      'scottish premiership'
    ]
  },

  SC1: {
    country: 'scotland',
    names: [
      'championship',
      'scottish championship'
    ]
  },

  SC2: {
    country: 'scotland',
    names: [
      'league one',
      'scottish league one'
    ]
  },

  SC3: {
    country: 'scotland',
    names: [
      'league two',
      'scottish league two'
    ]
  },

  D1: {
    country: 'germany',
    names: [
      'bundesliga'
    ]
  },

  D2: {
    country: 'germany',
    names: [
      '2. bundesliga',
      '2 bundesliga',
      'bundesliga 2'
    ]
  },

  I1: {
    country: 'italy',
    names: [
      'serie a'
    ]
  },

  I2: {
    country: 'italy',
    names: [
      'serie b'
    ]
  },

  SP1: {
    country: 'spain',
    names: [
      'la liga',
      'laliga',
      'primera division'
    ]
  },

  SP2: {
    country: 'spain',
    names: [
      'segunda division',
      'laliga 2',
      'laliga hyermotion',
      'laliga hypermotion'
    ]
  },

  F1: {
    country: 'france',
    names: [
      'ligue 1'
    ]
  },

  F2: {
    country: 'france',
    names: [
      'ligue 2'
    ]
  },

  N1: {
    country: 'netherlands',
    names: [
      'eredivisie'
    ]
  },

  B1: {
    country: 'belgium',
    names: [
      'jupiler pro league',
      'jupiler league',
      'first division a'
    ]
  },

  P1: {
    country: 'portugal',
    names: [
      'primeira liga',
      'liga portugal'
    ]
  },

  T1: {
    country: 'turkey',
    names: [
      'super lig',
      'süper lig'
    ]
  },

  G1: {
    country: 'greece',
    names: [
      'super league',
      'super league 1'
    ]
  }
};

function normalizeSofaText(
  value
) {
  return String(
    value || ''
  )
    .toLowerCase()
    .normalize('NFD')
    .replace(
      /[\u0300-\u036f]/g,
      ''
    )
    .replace(
      /[^a-z0-9]+/g,
      ' '
    )
    .replace(
      /\s+/g,
      ' '
    )
    .trim();
}

function getSofaCountryName(
  event
) {
  return normalizeSofaText(
    event
      ?.tournament
      ?.category
      ?.name
  );
}

function getSofaTournamentName(
  event
) {
  return normalizeSofaText(
    event
      ?.tournament
      ?.uniqueTournament
      ?.name ||
    event
      ?.tournament
      ?.name
  );
}

function getSofaLeagueCode(
  event,
  allowedCodes = null
) {
  const country =
    getSofaCountryName(
      event
    );

  const tournament =
    getSofaTournamentName(
      event
    );

  if (
    !country ||
    !tournament
  ) {
    return null;
  }

  for (
    const league
    of LEAGUES
  ) {
    if (
      allowedCodes &&
      !allowedCodes.includes(
        league.code
      )
    ) {
      continue;
    }

    const rule =
      SOFASCORE_LEAGUE_RULES[
        league.code
      ];

    if (!rule) {
      continue;
    }

    if (
      normalizeSofaText(
        rule.country
      ) !== country
    ) {
      continue;
    }

    const matches =
      rule.names.some(
        name =>
          normalizeSofaText(
            name
          ) === tournament
      );

    if (matches) {
      return league.code;
    }
  }

  return null;
}

function getSofaStatus(
  event
) {
  const type =
    normalizeSofaText(
      event
        ?.status
        ?.type
    );

  const slug =
    normalizeSofaText(
      event
        ?.status
        ?.slug
    );

  if (
    type === 'finished' ||
    slug === 'finished'
  ) {
    return 'finished';
  }

  if (
    type === 'inprogress' ||
    type === 'in progress' ||
    slug === 'inprogress'
  ) {
    return 'live';
  }

  if (
    type === 'canceled' ||
    type === 'cancelled' ||
    slug === 'canceled' ||
    slug === 'cancelled'
  ) {
    return 'cancelled';
  }

  if (
    type === 'postponed' ||
    slug === 'postponed'
  ) {
    return 'postponed';
  }

  if (
    type === 'suspended' ||
    slug === 'suspended'
  ) {
    return 'postponed';
  }

  return 'scheduled';
}

function getSofaKickoffISO(
  event
) {
  const timestamp =
    Number(
      event?.startTimestamp
    );

  if (
    !Number.isFinite(
      timestamp
    ) ||
    timestamp <= 0
  ) {
    return null;
  }

  const date =
    new Date(
      timestamp * 1000
    );

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return null;
  }

  return date.toISOString();
}

/*
 * =========================================================
 * SOFASCORE FETCH
 * =========================================================
 */

async function fetchSofaEvents(
  date
) {
  const urls = [
    `${SOFASCORE_BASE}/sport/football/scheduled-events/${date}/inverse`,
    `${SOFASCORE_BASE}/sport/football/scheduled-events/${date}`
  ];

  const errors = [];

  for (
    const url
    of urls
  ) {
    try {
      const response =
        await fetch(
          url,
          {
            method: 'GET',

            headers: {
              'Accept':
                'application/json',

              'User-Agent':
                'Football-Analizer/1.0',

              'Referer':
                'https://www.sofascore.com/'
            },

            cf: {
              cacheTtl: 0,
              cacheEverything: false
            }
          }
        );

      if (
        !response.ok
      ) {
        errors.push(
          `${url}: HTTP ${response.status}`
        );

        continue;
      }

      const data =
        await response.json();

      if (
        !data ||
        !Array.isArray(
          data.events
        )
      ) {
        errors.push(
          `${url}: brak tablicy events`
        );

        continue;
      }

      return {
        events:
          data.events,

        url
      };
    } catch (e) {
      errors.push(
        `${url}: ${
          e.message || e
        }`
      );
    }
  }

  throw new Error(
    'Nie udało się pobrać terminarza SofaScore. ' +
    errors.join(' | ')
  );
}

/*
 * =========================================================
 * SOFASCORE FIXTURE DATE IMPORT
 * =========================================================
 */

async function importSofaFixtureDate(
  env,
  date,
  seasonName = CURRENT_SEASON,
  allowedCodes = null
) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(
      date
    )
  ) {
    throw new Error(
      `Nieprawidłowa data: ${date}`
    );
  }

  if (
    !SEASONS.includes(
      seasonName
    )
  ) {
    throw new Error(
      `Nieprawidłowy sezon: ${seasonName}`
    );
  }

  const feed =
    await fetchSofaEvents(
      date
    );

  /*
   * Najpierw ustalamy,
   * które ligi faktycznie
   * występują tego dnia.
   */

  const matchedEvents = [];

  const codes =
    allowedCodes &&
    allowedCodes.length
      ? allowedCodes
      : LEAGUES.map(
          league =>
            league.code
        );

  for (
    const event
    of feed.events
  ) {
    const code =
      getSofaLeagueCode(
        event,
        codes
      );

    if (!code) {
      continue;
    }

    matchedEvents.push({
      event,
      code
    });
  }

  /*
   * Pobieramy z D1 tylko
   * drużyny istniejące w
   * statystycznej bazie.
   */

  const contexts =
    new Map();

  const uniqueCodes =
    [
      ...new Set(
        matchedEvents.map(
          item =>
            item.code
        )
      )
    ];

  for (
    const code
    of uniqueCodes
  ) {
    const leagueConfig =
      getLeague(code);

    if (!leagueConfig) {
      continue;
    }

    const league =
      await env.DB.prepare(`
        SELECT
          id,
          name,
          country,
          code
        FROM leagues
        WHERE
          source = ?
          AND code = ?
        LIMIT 1
      `).bind(
        FOOTBALL_DATA_SOURCE,
        code
      ).first();

    if (!league) {
      continue;
    }

    const season =
      await env.DB.prepare(`
        SELECT
          id,
          name
        FROM seasons
        WHERE
          league_id = ?
          AND name = ?
          AND source = ?
        LIMIT 1
      `).bind(
        league.id,
        seasonName,
        FOOTBALL_DATA_SOURCE
      ).first();

    if (!season) {
      continue;
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
      continue;
    }

    contexts.set(
      code,
      {
        league,
        season,
        statsTeams
      }
    );
  }

  let imported = 0;
  let skipped = 0;

  const skippedTeams = [];
  const statements = [];

  for (
    const item
    of matchedEvents
  ) {
    const event =
      item.event;

    const code =
      item.code;

    const context =
      contexts.get(code);

    if (!context) {
      skipped++;
      continue;
    }

    const homeName =
      clean(
        event
          ?.homeTeam
          ?.name
      );

    const awayName =
      clean(
        event
          ?.awayTeam
          ?.name
      );

    if (
      !homeName ||
      !awayName
    ) {
      skipped++;
      continue;
    }

    /*
     * Próbujemy nazwy głównej,
     * potem shortName.
     */

    let homeTeam =
      resolveStatsTeam(
        context.statsTeams,
        homeName
      );

    if (
      !homeTeam
    ) {
      homeTeam =
        resolveStatsTeam(
          context.statsTeams,
          event
            ?.homeTeam
            ?.shortName
        );
    }

    let awayTeam =
      resolveStatsTeam(
        context.statsTeams,
        awayName
      );

    if (
      !awayTeam
    ) {
      awayTeam =
        resolveStatsTeam(
          context.statsTeams,
          event
            ?.awayTeam
            ?.shortName
        );
    }

    /*
     * Jeżeli nie udało się
     * jednoznacznie znaleźć
     * jednej z drużyn,
     * NIE zapisujemy meczu.
     */

    if (
      !homeTeam ||
      !awayTeam
    ) {
      skipped++;

      skippedTeams.push({
        league:
          code,

        sourceEventId:
          event?.id ?? null,

        home:
          homeName,

        away:
          awayName,

        resolvedHome:
          homeTeam?.name || null,

        resolvedAway:
          awayTeam?.name || null
      });

      continue;
    }

    /*
     * Nigdy nie tworzymy
     * nowych teams.
     *
     * Zapisujemy ID istniejących
     * drużyn statystycznych.
     */

    const sourceMatchId =
      String(
        event.id
      );

    const status =
      getSofaStatus(
        event
      );

    const rawData =
      JSON.stringify({
        source:
          'sofascore',

        fetched_date:
          date,

        event
      });

    statements.push(
      env.DB.prepare(`
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

        ON CONFLICT(
          source,
          league_id,
          season_id,
          match_date,
          home_team_id,
          away_team_id
        )
        DO UPDATE SET
          status =
            excluded.status,

          source_match_id =
            excluded.source_match_id,

          raw_data_json =
            excluded.raw_data_json,

          updated_at =
            CURRENT_TIMESTAMP
      `).bind(
        context.league.id,
        context.season.id,
        date,
        homeTeam.id,
        awayTeam.id,
        null,
        status,
        FIXTURE_SOURCE,
        sourceMatchId,
        rawData
      )
    );

    imported++;
  }

  /*
   * D1 batch ma ograniczenie liczby
   * statementów, więc dzielimy.
   */

  for (
    let i = 0;
    i < statements.length;
    i += MATCH_BATCH_SIZE
  ) {
    await env.DB.batch(
      statements.slice(
        i,
        i + MATCH_BATCH_SIZE
      )
    );
  }

  return {
    ok: true,

    source:
      FIXTURE_SOURCE,

    date,

    season:
      seasonName,

    fetchedFrom:
      feed.url,

    sourceEvents:
      feed.events.length,

    matchedEvents:
      matchedEvents.length,

    imported,

    skipped,

    skippedTeams
  };
}

/*
 * =========================================================
 * DATE HELPERS
 * =========================================================
 */

function addDaysISO(
  date,
  days
) {
  const d =
    new Date(
      `${date}T12:00:00Z`
    );

  d.setUTCDate(
    d.getUTCDate() +
    days
  );

  return d
    .toISOString()
    .slice(0, 10);
}

function todayISO() {
  return new Date()
    .toISOString()
    .slice(0, 10);
}

/*
 * =========================================================
 * SOFASCORE FIXTURE WINDOW
 * =========================================================
 */

async function refreshSofaFixtureWindow(
  env,
  seasonName = CURRENT_SEASON,
  leagueCodes = null,
  startDate = null,
  days = 1
) {
  const start =
    startDate ||
    todayISO();

  const safeDays =
    Math.min(
      Math.max(
        Number.isFinite(
          Number(days)
        )
          ? Math.trunc(
              Number(days)
            )
          : 1,
        1
      ),
      14
    );

  const results = [];

  let totalImported = 0;
  let totalSkipped = 0;

  for (
    let i = 0;
    i < safeDays;
    i++
  ) {
    const date =
      addDaysISO(
        start,
        i
      );

    try {
      const result =
        await importSofaFixtureDate(
          env,
          date,
          seasonName,
          leagueCodes
        );

      results.push(
        result
      );

      totalImported +=
        Number(
          result.imported || 0
        );

      totalSkipped +=
        Number(
          result.skipped || 0
        );
    } catch (e) {
      results.push({
        ok: false,

        date,

        error:
          String(
            e.message || e
          )
      });
    }
  }

  return {
    ok: true,

    source:
      FIXTURE_SOURCE,

    season:
      seasonName,

    from:
      start,

    days:
      safeDays,

    to:
      addDaysISO(
        start,
        safeDays - 1
      ),

    totalImported,

    totalSkipped,

    results
  };
}

/*
 * =========================================================
 * GET FIXTURES
 * =========================================================
 */

async function getFixtures(
  env,
  date,
  leagueCode = null
) {
  const where = [
    'f.source = ?',
    'f.match_date = ?'
  ];

  const binds = [
    FIXTURE_SOURCE,
    date
  ];

  if (
    leagueCode
  ) {
    where.push(
      'l.code = ?'
    );

    binds.push(
      leagueCode
    );
  }

  /*
   * Kolejność dokładnie taka,
   * jak LEAGUES.
   */

  const leagueOrder =
    LEAGUES.map(
      (
        league,
        index
      ) =>
        `WHEN '${league.code}' THEN ${index}`
    ).join(' ');

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
        ON l.id =
           f.league_id

      JOIN teams ht
        ON ht.id =
           f.home_team_id

      JOIN teams at
        ON at.id =
           f.away_team_id

      WHERE
        ${where.join(
          ' AND '
        )}

      ORDER BY
        CASE l.code
          ${leagueOrder}
          ELSE 999
        END,

        json_extract(
          f.raw_data_json,
          '$.event.startTimestamp'
        ),

        ht.name
    `).bind(
      ...binds
    ).all();

  return (
    result.results || []
  ).map(
    row => {
      let raw = {};

      try {
        raw =
          JSON.parse(
            row.raw_data_json ||
            '{}'
          );
      } catch (_) {
        raw = {};
      }

      const event =
        raw.event || {};

      const kickoff =
        getSofaKickoffISO(
          event
        );

      return {
        id:
          row.id,

        fixture_id:
          row.source_match_id,

        date:
          row.match_date,

        kickoff,

        timestamp:
          event.startTimestamp ||
          null,

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
          event.venue ||
          null
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
     * -----------------------------------------------------
     * TEST
     * -----------------------------------------------------
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
     * -----------------------------------------------------
     * API-FOOTBALL TEST
     * -----------------------------------------------------
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
     * -----------------------------------------------------
     * DB TEST
     * -----------------------------------------------------
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
     * -----------------------------------------------------
     * LEAGUES
     * -----------------------------------------------------
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
     * -----------------------------------------------------
     * SEASONS
     * -----------------------------------------------------
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
     * -----------------------------------------------------
     * MATCHES
     * -----------------------------------------------------
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
     * -----------------------------------------------------
     * FIXTURES
     *
     * /api/fixtures?date=2026-09-12
     *
     * Jeżeli fixtures dla tej daty
     * jeszcze nie ma w D1, próbujemy
     * pobrać tę datę automatycznie.
     * -----------------------------------------------------
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

        const leagueCode =
          clean(
            url.searchParams.get(
              'league'
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

        /*
         * Najpierw sprawdzamy D1.
         */

        let fixtures =
          await getFixtures(
            env,
            date,
            leagueCode
          );

        /*
         * Jeżeli brak danych,
         * pobieramy wybraną datę
         * z SofaScore.
         */

        if (
          fixtures.length === 0
        ) {
          try {
            await importSofaFixtureDate(
              env,
              date,
              CURRENT_SEASON,
              leagueCode
                ? [
                    leagueCode.toUpperCase()
                  ]
                : null
            );

            fixtures =
              await getFixtures(
                env,
                date,
                leagueCode
              );
          } catch (refreshError) {
            console.error(
              'Automatic fixtures refresh failed:',
              String(
                refreshError.message ||
                refreshError
              )
            );
          }
        }

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
     * -----------------------------------------------------
     * FIXTURES REFRESH
     *
     * Przykłady:
     *
     * /api/fixtures-refresh
     * /api/fixtures-refresh?date=2026-09-12
     * /api/fixtures-refresh?date=2026-09-12&days=7
     * /api/fixtures-refresh?league=E0
     * /api/fixtures-refresh?part=1
     * -----------------------------------------------------
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

      const leagueParam =
        clean(
          url.searchParams.get(
            'league'
          )
        );

      const partParam =
        clean(
          url.searchParams.get(
            'part'
          )
        );

      let leagueCodes =
        null;

      if (
        leagueParam
      ) {
        const code =
          leagueParam.toUpperCase();

        if (
          !getLeague(code)
        ) {
          return json(
            {
              ok: false,

              error:
                `Unknown league: ${code}`,

              available:
                LEAGUES.map(
                  l =>
                    l.code
                )
            },
            400
          );
        }

        leagueCodes = [
          code
        ];
      } else if (
        partParam
      ) {
        const partNumber =
          Number(
            partParam
          );

        if (
          !Number.isInteger(
            partNumber
          ) ||
          partNumber < 1 ||
          partNumber >
            REFRESH_PARTS.length
        ) {
          return json(
            {
              ok: false,

              error:
                `Unknown part: ${partParam}`,

              availableParts:
                REFRESH_PARTS.map(
                  (
                    codes,
                    index
                  ) => ({
                    part:
                      index + 1,

                    leagues:
                      codes
                  })
                )
            },
            400
          );
        }

        leagueCodes =
          REFRESH_PARTS[
            partNumber - 1
          ];
      }

      const dateParam =
        clean(
          url.searchParams.get(
            'date'
          )
        );

      const daysParam =
        Number(
          url.searchParams.get(
            'days'
          ) || (
            dateParam
              ? '1'
              : '14'
          )
        );

      const startDate =
        dateParam ||
        todayISO();

      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(
          startDate
        )
      ) {
        return json(
          {
            ok: false,

            error:
              'Nieprawidłowa data. Użyj YYYY-MM-DD.'
          },
          400
        );
      }

      try {
        const result =
          await refreshSofaFixtureWindow(
            env,
            season,
            leagueCodes,
            startDate,
            daysParam
          );

        return json(
          result
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
     * -----------------------------------------------------
     * IMPORT ONE
     * -----------------------------------------------------
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
     * -----------------------------------------------------
     * IMPORT ALL
     * -----------------------------------------------------
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
     * -----------------------------------------------------
     * REFRESH ONE LEAGUE
     * -----------------------------------------------------
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

    /*
     * -----------------------------------------------------
     * ASSETS
     * -----------------------------------------------------
     */

    return env.ASSETS.fetch(
      request
    );
  },

  /*
   * =======================================================
   * CRON
   * =======================================================
   */

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
     * -----------------------------------------------------
     * FIXTURES
     *
     * Raz w tygodniu:
     * poniedziałek 03:00 UTC
     *
     * Pobieramy 14 najbliższych dni.
     * -----------------------------------------------------
     */

    if (
      day === 1 &&
      hour === 3
    ) {
      const startDate =
        date
          .toISOString()
          .slice(
            0,
            10
          );

      ctx.waitUntil(
        (async () => {
          try {
            const result =
              await refreshSofaFixtureWindow(
                env,
                CURRENT_SEASON,
                null,
                startDate,
                14
              );

            console.log(
              'SofaScore fixtures weekly refresh FINISHED',
              JSON.stringify(
                result
              )
            );
          } catch (e) {
            console.error(
              'SofaScore fixtures weekly refresh FAILED:',
              String(
                e.message || e
              )
            );
          }
        })()
      );
    }

    /*
     * -----------------------------------------------------
     * FOOTBALL-DATA
     *
     * Ten cron zostaje tak jak wcześniej.
     *
     * Statystyki odświeżają się
     * rotacyjnie dla 22 lig.
     * -----------------------------------------------------
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
