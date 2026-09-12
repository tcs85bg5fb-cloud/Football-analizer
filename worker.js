const API_FOOTBALL_SOURCE = 'api-football';
const API_BASE = 'https://v3.football.api-sports.io';

const LEAGUES = [
  { code: 'E0', name: 'Premier League', country: 'England', apiId: 39 },
  { code: 'E1', name: 'Championship', country: 'England', apiId: 40 },
  { code: 'E2', name: 'League One', country: 'England', apiId: 41 },
  { code: 'E3', name: 'League Two', country: 'England', apiId: 42 },
  { code: 'EC', name: 'National League', country: 'England', apiId: 43 },

  { code: 'SC0', name: 'Premiership', country: 'Scotland', apiId: 179 },
  { code: 'SC1', name: 'Championship', country: 'Scotland', apiId: 180 },
  { code: 'SC2', name: 'League One', country: 'Scotland', apiId: 181 },
  { code: 'SC3', name: 'League Two', country: 'Scotland', apiId: 182 },

  { code: 'D1', name: 'Bundesliga', country: 'Germany', apiId: 78 },
  { code: 'D2', name: '2. Bundesliga', country: 'Germany', apiId: 79 },

  { code: 'I1', name: 'Serie A', country: 'Italy', apiId: 135 },
  { code: 'I2', name: 'Serie B', country: 'Italy', apiId: 136 },

  { code: 'SP1', name: 'La Liga', country: 'Spain', apiId: 140 },
  { code: 'SP2', name: 'Segunda División', country: 'Spain', apiId: 141 },

  { code: 'F1', name: 'Ligue 1', country: 'France', apiId: 61 },
  { code: 'F2', name: 'Ligue 2', country: 'France', apiId: 62 },

  { code: 'N1', name: 'Eredivisie', country: 'Netherlands', apiId: 88 },
  { code: 'B1', name: 'Jupiler League', country: 'Belgium', apiId: 144 },
  { code: 'P1', name: 'Liga Portugal', country: 'Portugal', apiId: 94 },
  { code: 'T1', name: 'Süper Lig', country: 'Turkey', apiId: 203 },
  { code: 'G1', name: 'Super League', country: 'Greece', apiId: 197 }
];

const API_SEASON = 2026;
const DEFAULT_SEASON = '2026/27';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

function cors(response) {
  const headers = new Headers(response.headers);
  headers.set('access-control-allow-origin', '*');
  headers.set('access-control-allow-methods', 'GET,POST,OPTIONS');
  headers.set('access-control-allow-headers', 'Content-Type');
  return new Response(response.body, {
    status: response.status,
    headers
  });
}

function normalizeTeamName(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

const TEAM_ALIASES = {
  'man united': 'manchester united',
  'man utd': 'manchester united',
  'manchester utd': 'manchester united',
  'man city': 'manchester city',

  'nott m forest': 'nottingham forest',
  'nottingham forest': 'nottingham forest',

  'wolves': 'wolverhampton wanderers',
  'wolverhampton': 'wolverhampton wanderers',

  'spurs': 'tottenham',
  'tottenham hotspur': 'tottenham',

  'newcastle': 'newcastle united',

  'west ham': 'west ham united',

  'brighton': 'brighton',
  'brighton and hove albion': 'brighton',

  'leicester': 'leicester city',

  'ipswich': 'ipswich town',

  'norwich': 'norwich',

  'qpr': 'queens park rangers',

  'stoke': 'stoke city',

  'west brom': 'west bromwich albion',

  'sheffield utd': 'sheffield united',
  'sheffield united': 'sheffield united',

  'sheffield weds': 'sheffield wednesday',
  'sheffield wednesday': 'sheffield wednesday',

  'blackburn': 'blackburn rovers',

  'bolton': 'bolton wanderers',

  'preston': 'preston north end',

  'cardiff': 'cardiff city',

  'swansea': 'swansea city',

  'birmingham': 'birmingham city',

  'coventry': 'coventry city',

  'luton': 'luton town',

  'derby': 'derby county',

  'hull': 'hull city',

  'middlesbrough': 'middlesbrough',

  'millwall': 'millwall',

  'plymouth': 'plymouth argyle',

  'portsmouth': 'portsmouth',

  'reading': 'reading',

  'wigan': 'wigan athletic',

  'charlton': 'charlton athletic',

  'exeter': 'exeter city',

  'leyton orient': 'leyton orient',

  'wycombe': 'wycombe wanderers',

  'bristol city': 'bristol city',

  'bristol rovers': 'bristol rovers'
};

function teamKey(name) {
  const normalized = normalizeTeamName(name);

  if (TEAM_ALIASES[normalized]) {
    return TEAM_ALIASES[normalized];
  }

  return normalized;
}

function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;

  if (a.includes(b) || b.includes(a)) {
    return Math.min(a.length, b.length) / Math.max(a.length, b.length);
  }

  const aa = new Set(a.split(' '));
  const bb = new Set(b.split(' '));

  const intersection = [...aa].filter(x => bb.has(x)).length;
  const union = new Set([...aa, ...bb]).size;

  return union ? intersection / union : 0;
}

async function apiFootball(env, path, params = {}) {
  if (!env.API_FOOTBALL_KEY) {
    throw new Error('Brak sekretu API_FOOTBALL_KEY');
  }

  const url = new URL(API_BASE + path);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, value);
    }
  }

  const response = await fetch(url.toString(), {
    headers: {
      'x-apisports-key': env.API_FOOTBALL_KEY
    }
  });

  if (!response.ok) {
    throw new Error(`API-Football HTTP ${response.status}`);
  }

  const data = await response.json();

  if (data.errors && Object.keys(data.errors).length) {
    throw new Error(JSON.stringify(data.errors));
  }

  return data;
}

async function getStatsTeamMap(env, leagueId, seasonId) {
  const rows = await env.DB.prepare(`
    SELECT DISTINCT
      t.id,
      t.name
    FROM teams t
    JOIN matches m
      ON m.home_team_id = t.id
      OR m.away_team_id = t.id
    WHERE m.league_id = ?
      AND m.season_id = ?
      AND t.source = 'football-data'
    ORDER BY t.name
  `).bind(leagueId, seasonId).all();

  return rows.results || [];
}

async function resolveStatsTeam(statsTeams, apiName) {
  const apiKey = teamKey(apiName);

  const exact = statsTeams.filter(t => teamKey(t.name) === apiKey);

  if (exact.length === 1) {
    return exact[0];
  }

  if (exact.length > 1) {
    return null;
  }

  let best = null;
  let bestScore = 0;
  let secondScore = 0;

  for (const team of statsTeams) {
    const score = similarity(apiKey, teamKey(team.name));

    if (score > bestScore) {
      secondScore = bestScore;
      bestScore = score;
      best = team;
    } else if (score > secondScore) {
      secondScore = score;
    }
  }

  // Nie zgadujemy przy niepewnym dopasowaniu.
  if (best && bestScore >= 0.75 && bestScore - secondScore >= 0.10) {
    return best;
  }

  return null;
}

function fixtureStatus(short) {
  const live = [
    '1H',
    '2H',
    'ET',
    'P',
    'BT',
    'LIVE'
  ];

  if (live.includes(short)) {
    return 'live';
  }

  if (short === 'FT' || short === 'AET' || short === 'PEN') {
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

  if (short === 'SUSP') {
    return 'postponed';
  }

  return 'scheduled';
}

function parseDate(value) {
  if (!value) return null;

  const d = new Date(value);

  if (Number.isNaN(d.getTime())) {
    return null;
  }

  return d;

}
async function importApiLeague(env, cfg, seasonName = DEFAULT_SEASON) {
  const leagueRow = await env.DB.prepare(`
    SELECT id
    FROM leagues
    WHERE code = ?
      AND source = 'football-data'
    LIMIT 1
  `).bind(cfg.code).first();

  if (!leagueRow) {
    return {
      league: cfg.code,
      imported: 0,
      skipped: 0,
      reason: 'Brak ligi w bazie statystycznej'
    };
  }

  const seasonRow = await env.DB.prepare(`
    SELECT id
    FROM seasons
    WHERE league_id = ?
      AND name = ?
      AND source = 'football-data'
    LIMIT 1
  `).bind(leagueRow.id, seasonName).first();

  if (!seasonRow) {
    return {
      league: cfg.code,
      imported: 0,
      skipped: 0,
      reason: 'Brak sezonu w bazie statystycznej'
    };
  }

  const statsTeams = await getStatsTeamMap(
    env,
    leagueRow.id,
    seasonRow.id
  );

  if (!statsTeams.length) {
    return {
      league: cfg.code,
      imported: 0,
      skipped: 0,
      reason: 'Brak drużyn w danych statystycznych'
    };
  }

  const data = await apiFootball(env, '/fixtures', {
    league: cfg.apiId,
    season: API_SEASON
  });

  const fixtures = data.response || [];

  let imported = 0;
  let skipped = 0;

  for (const fixture of fixtures) {
    const fixtureId = fixture.fixture?.id;

    if (!fixtureId) {
      skipped++;
      continue;
    }

    const homeApiName = fixture.teams?.home?.name;
    const awayApiName = fixture.teams?.away?.name;

    if (!homeApiName || !awayApiName) {
      skipped++;
      continue;
    }

    const homeTeam = await resolveStatsTeam(
      statsTeams,
      homeApiName
    );

    const awayTeam = await resolveStatsTeam(
      statsTeams,
      awayApiName
    );

    // Pokazujemy wyłącznie drużyny,
    // które istnieją już w bazie statystycznej.
    if (!homeTeam || !awayTeam) {
      skipped++;
      continue;
    }

    const kickoff = parseDate(fixture.fixture?.date);

    if (!kickoff) {
      skipped++;
      continue;
    }

    const matchDate = kickoff.toISOString().slice(0, 10);

    const status = fixtureStatus(
      fixture.fixture?.status?.short
    );

    const rawData = {
      fixture_id: fixtureId,
      timestamp: fixture.fixture?.timestamp ?? null,
      date: fixture.fixture?.date ?? null,

      venue: fixture.fixture?.venue
        ? {
            id: fixture.fixture.venue.id ?? null,
            name: fixture.fixture.venue.name ?? null,
            city: fixture.fixture.venue.city ?? null
          }
        : null,

      status: fixture.fixture?.status ?? null,

      league: fixture.league ?? null,

      teams: fixture.teams ?? null
    };

    // Usuwamy poprzednią wersję tego samego meczu.
    // Dzięki temu zmiana godziny / statusu jest aktualizowana.
    await env.DB.prepare(`
      DELETE FROM fixtures
      WHERE source = ?
        AND source_match_id = ?
    `).bind(
      API_FOOTBALL_SOURCE,
      String(fixtureId)
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
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).bind(
      leagueRow.id,
      seasonRow.id,
      matchDate,
      homeTeam.id,
      awayTeam.id,
      null,
      status,
      API_FOOTBALL_SOURCE,
      String(fixtureId),
      JSON.stringify(rawData)
    ).run();

    imported++;
  }

  return {
    league: cfg.code,
    imported,
    skipped,
    total_api: fixtures.length
  };
}


async function refreshApiFixtures(env, seasonName = DEFAULT_SEASON) {
  const results = [];

  for (const cfg of LEAGUES) {
    try {
      const result = await importApiLeague(
        env,
        cfg,
        seasonName
      );

      results.push(result);
    } catch (error) {
      results.push({
        league: cfg.code,
        imported: 0,
        skipped: 0,
        error: error.message
      });
    }
  }

  return results;
}


function getFixtureKickoff(rawData) {
  try {
    const data = JSON.parse(rawData || '{}');

    if (data.date) {
      return data.date;
    }

    if (data.timestamp) {
      return new Date(
        Number(data.timestamp) * 1000
      ).toISOString();
    }
  } catch (_) {}

  return null;
}


async function getFixtures(env, date) {
  const rows = await env.DB.prepare(`
    SELECT
      f.id,
      f.match_date,
      f.home_team_id,
      f.away_team_id,
      f.status,
      f.source_match_id,
      f.raw_data_json,

      l.name AS league_name,
      l.country AS league_country,
      l.code AS league_code,

      ht.name AS home_team,
      at.name AS away_team

    FROM fixtures f

    JOIN leagues l
      ON l.id = f.league_id

    JOIN teams ht
      ON ht.id = f.home_team_id

    JOIN teams at
      ON at.id = f.away_team_id

    WHERE f.source = ?
      AND f.match_date = ?

    ORDER BY
      l.id,
      json_extract(f.raw_data_json, '$.timestamp'),
      ht.name
  `).bind(
    API_FOOTBALL_SOURCE,
    date
  ).all();

  return (rows.results || []).map(row => ({
    id: row.id,
    source_match_id: row.source_match_id,

    date: row.match_date,

    kickoff: getFixtureKickoff(
      row.raw_data_json
    ),

    status: row.status,

    league: {
      code: row.league_code,
      name: row.league_name,
      country: row.league_country
    },

    home_team: row.home_team,
    away_team: row.away_team,

    venue: (() => {
      try {
        const data = JSON.parse(
          row.raw_data_json || '{}'
        );

        return data.venue || null;
      } catch (_) {
        return null;
      }
    })()
  }));
}


async function handleFixtures(request, env) {
  const url = new URL(request.url);

  const date = url.searchParams.get('date');

  if (!date) {
    return json({
      error: 'Brak parametru date. Użyj /api/fixtures?date=YYYY-MM-DD'
    }, 400);
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return json({
      error: 'Nieprawidłowy format daty. Użyj YYYY-MM-DD.'
    }, 400);
  }

  const fixtures = await getFixtures(
    env,
    date
  );

  return json({
    date,
    count: fixtures.length,
    fixtures
  });
}


async function handleFixturesRefresh(request, env) {
  const url = new URL(request.url);

  const token = url.searchParams.get('token');

  if (!env.REFRESH_TOKEN) {
    return json({
      error: 'Brak sekretu REFRESH_TOKEN'
    }, 500);
  }

  if (token !== env.REFRESH_TOKEN) {
    return json({
      error: 'Nieprawidłowy token'
    }, 401);
  }

  const season =
    url.searchParams.get('season') ||
    DEFAULT_SEASON;

  try {
    const results = await refreshApiFixtures(
      env,
      season
    );

    const imported = results.reduce(
      (sum, r) => sum + (r.imported || 0),
      0
    );

    const skipped = results.reduce(
      (sum, r) => sum + (r.skipped || 0),
      0
    );

    return json({
      ok: true,
      season,
      imported,
      skipped,
      leagues: results
    });
  } catch (error) {
    return json({
      ok: false,
      error: error.message
    }, 500);
  }
}


async function getMatches(env, request) {
  const url = new URL(request.url);

  const league = url.searchParams.get('league');
  const team = url.searchParams.get('team');
  const referee = url.searchParams.get('referee');

  const limitParam =
    url.searchParams.get('limit') || '50';

  const offset =
    Number(url.searchParams.get('offset') || 0);

  const limit =
    limitParam === 'all'
      ? 100000
      : Math.min(
          Math.max(Number(limitParam) || 50, 1),
          1000
        );

  const conditions = [];
  const bindings = [];

  if (league) {
    conditions.push('l.code = ?');
    bindings.push(league);
  }

  if (team) {
    conditions.push(`
      (
        ht.name LIKE ?
        OR at.name LIKE ?
      )
    `);

    bindings.push(`%${team}%`);
    bindings.push(`%${team}%`);
  }

  if (referee) {
    conditions.push('r.name LIKE ?');
    bindings.push(`%${referee}%`);
  }

  const where =
    conditions.length
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

  const countResult = await env.DB.prepare(`
    SELECT COUNT(*) AS total
    FROM matches m

    JOIN leagues l
      ON l.id = m.league_id

    JOIN teams ht
      ON ht.id = m.home_team_id

    JOIN teams at
      ON at.id = m.away_team_id

    LEFT JOIN referees r
      ON r.id = m.referee_id

    ${where}
  `).bind(...bindings).first();

  const total =
    Number(countResult?.total || 0);

  const result = await env.DB.prepare(`
    SELECT
      m.*,

      l.name AS league_name,
      l.code AS league_code,

      ht.name AS home_team,
      at.name AS away_team,

      r.name AS referee

    FROM matches m

    JOIN leagues l
      ON l.id = m.league_id

    JOIN teams ht
      ON ht.id = m.home_team_id

    JOIN teams at
      ON at.id = m.away_team_id

    LEFT JOIN referees r
      ON r.id = m.referee_id

    ${where}

    ORDER BY m.match_date DESC

    LIMIT ?
    OFFSET ?
  `).bind(
    ...bindings,
    limit,
    offset
  ).all();

  return json({
    count: result.results?.length || 0,
    total,
    offset,
    limit,
    matches: result.results || []
  });
}


async function getLeagues(env) {
  const result = await env.DB.prepare(`
    SELECT
      id,
      name,
      country,
      code,
      source
    FROM leagues
    WHERE source = 'football-data'
    ORDER BY
      country,
      name
  `).all();

  return json({
    leagues: result.results || []
  });
}


async function getSeasons(env) {
  const result = await env.DB.prepare(`
    SELECT
      id,
      league_id,
      name,
      start_year,
      end_year,
      source
    FROM seasons
    WHERE source = 'football-data'
    ORDER BY
      start_year DESC,
      name
  `).all();

  return json({
    seasons: result.results || []
  });
}


async function testApiFootball(env) {
  try {
    const data = await apiFootball(
      env,
      '/status'
    );

    return json({
      ok: true,
      api: data
    });
  } catch (error) {
    return json({
      ok: false,
      error: error.message
    }, 500);
  }
}
async function getFixtureList(env,date) {
  const binds=[API_FOOTBALL_SOURCE,date];

  const q=await env.DB.prepare(`
    SELECT
      f.id,
      f.match_date,
      f.status,
      f.source_match_id AS fixture_id,
      l.code AS league_code,
      l.name AS league,
      l.country AS country,
      ht.name AS home_team,
      at.name AS away_team,
      f.raw_data_json
    FROM fixtures f
    JOIN leagues l ON l.id=f.league_id
    JOIN teams ht ON ht.id=f.home_team_id
    JOIN teams at ON at.id=f.away_team_id
    WHERE f.source=? AND f.match_date=?
    ORDER BY
      l.country,
      l.name,
      json_extract(f.raw_data_json,'$.fixture.date'),
      f.id
  `).bind(...binds).all();

  return (q.results||[]).map(x=>{
    let raw={};

    try {
      raw=JSON.parse(x.raw_data_json||'{}');
    } catch {}

    return {
      ...x,
      kickoff:raw.fixture?.date||null,
      timestamp:raw.fixture?.timestamp||null,
      venue:raw.fixture?.venue?.name||null
    };
  });
}


async function getLeagueList(env) {
  const r=await env.DB.prepare(`
    SELECT
      l.id,
      l.name,
      l.country,
      l.code,
      COUNT(DISTINCT m.id) AS matches
    FROM leagues l
    LEFT JOIN matches m
      ON m.league_id=l.id
    WHERE l.source=?
    GROUP BY
      l.id,
      l.name,
      l.country,
      l.code
    ORDER BY
      l.country,
      l.name
  `).bind(FOOTBALL_DATA_SOURCE).all();

  return r.results||[];
}


async function getSeasonList(env) {
  const r=await env.DB.prepare(`
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
      ON l.id=s.league_id
    WHERE l.source=?
    ORDER BY
      s.start_year DESC,
      l.country,
      l.name
  `).bind(FOOTBALL_DATA_SOURCE).all();

  return r.results||[];
}


async function getMatches(env,url) {
  const requestedLimit=
    Number(url.searchParams.get('limit')||'1000');

  const requestedOffset=
    Number(url.searchParams.get('offset')||'0');

  const leagueCode=
    clean(url.searchParams.get('league'));

  const seasonName=
    clean(url.searchParams.get('season'));

  const teamName=
    clean(url.searchParams.get('team'));

  const limit=Math.min(
    Math.max(
      Number.isFinite(requestedLimit)
        ? Math.trunc(requestedLimit)
        : 1000,
      1
    ),
    2000
  );

  const offset=Math.max(
    Number.isFinite(requestedOffset)
      ? Math.trunc(requestedOffset)
      : 0,
    0
  );

  const where=['l.source=?'];
  const binds=[FOOTBALL_DATA_SOURCE];

  if(leagueCode){
    where.push('l.code=?');
    binds.push(leagueCode);
  }

  if(seasonName){
    where.push('s.name=?');
    binds.push(seasonName);
  }

  if(teamName){
    where.push(
      '(ht.name=? OR at.name=?)'
    );
    binds.push(teamName,teamName);
  }

  const whereSQL=
    'WHERE '+where.join(' AND ');

  const count=await env.DB.prepare(`
    SELECT COUNT(*) AS total
    FROM matches m
    JOIN leagues l
      ON l.id=m.league_id
    JOIN seasons s
      ON s.id=m.season_id
    JOIN teams ht
      ON ht.id=m.home_team_id
    JOIN teams at
      ON at.id=m.away_team_id
    ${whereSQL}
  `).bind(...binds).first();

  const result=await env.DB.prepare(`
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
      ON l.id=m.league_id

    JOIN seasons s
      ON s.id=m.season_id

    JOIN teams ht
      ON ht.id=m.home_team_id

    JOIN teams at
      ON at.id=m.away_team_id

    LEFT JOIN referees r
      ON r.id=m.referee_id

    ${whereSQL}

    ORDER BY
      m.match_date DESC,
      m.id DESC

    LIMIT ?
    OFFSET ?
  `).bind(
    ...binds,
    limit,
    offset
  ).all();

  const matches=(result.results||[]).map(m=>({
    ...m,
    odds:m.odds_json
      ? JSON.parse(m.odds_json)
      : {},
    raw_data:m.raw_data_json
      ? JSON.parse(m.raw_data_json)
      : {}
  }));

  return {
    ok:true,
    count:matches.length,
    total:Number(count?.total||0),
    limit,
    offset,
    matches
  };
}


function json(data,status=200){
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers:{
        'content-type':
          'application/json; charset=utf-8',
        'cache-control':'no-store',
        'access-control-allow-origin':'*'
      }
    }
  );
}


export default {

  async fetch(request,env,ctx){

    const url=new URL(request.url);


    if(url.pathname==='/api/test'){
      return new Response(
        'WORKER OK',
        {
          status:200,
          headers:{
            'content-type':
              'text/plain; charset=utf-8'
          }
        }
      );
    }


    if(url.pathname==='/api/db-test'){
      try{
        return json({
          ok:true,
          database:'football-analyzer-db',
          counts:await getCounts(env)
        });
      }catch(e){
        return json({
          ok:false,
          error:String(e.message||e)
        },500);
      }
    }


    if(url.pathname==='/api/leagues'){
      try{
        return json({
          ok:true,
          available:LEAGUES,
          imported:await getLeagueList(env)
        });
      }catch(e){
        return json({
          ok:false,
          error:String(e.message||e)
        },500);
      }
    }


    if(url.pathname==='/api/seasons'){
      try{
        return json({
          ok:true,
          seasons:await getSeasonList(env)
        });
      }catch(e){
        return json({
          ok:false,
          error:String(e.message||e)
        },500);
      }
    }


    if(url.pathname==='/api/matches'){
      try{
        return json(
          await getMatches(env,url)
        );
      }catch(e){
        return json({
          ok:false,
          error:String(e.message||e)
        },500);
      }
    }


    /*
     * GET /api/fixtures?date=2026-09-12
     *
     * Zwraca wyłącznie terminarz zapisany
     * z API-Football.
     */
    if(url.pathname==='/api/fixtures'){

      try{

        const date=
          clean(url.searchParams.get('date'));

        if(!date){
          return json({
            ok:false,
            error:'Use date=YYYY-MM-DD'
          },400);
        }

        if(!/^\d{4}-\d{2}-\d{2}$/.test(date)){
          return json({
            ok:false,
            error:
              'Invalid date. Use YYYY-MM-DD'
          },400);
        }

        const fixtures=
          await getFixtureList(env,date);

        return json({
          ok:true,
          date,
          count:fixtures.length,
          fixtures
        });

      }catch(e){

        return json({
          ok:false,
          error:String(e.message||e)
        },500);

      }
    }


    /*
     * Ręczne odświeżenie terminarza.
     *
     * /api/fixtures-refresh
     *   ?token=...
     *   &season=2026/27
     */
    if(url.pathname==='/api/fixtures-refresh'){

      const token=
        url.searchParams.get('token');

      if(token!==IMPORT_TOKEN){
        return json({
          ok:false,
          error:'Unauthorized'
        },401);
      }

      try{

        const season=
          clean(
            url.searchParams.get('season')
          )||CURRENT_SEASON;

        if(!SEASONS.includes(season)){
          return json({
            ok:false,
            error:
              `Unknown season: ${season}`,
            available:SEASONS
          },400);
        }

        return json(
          await refreshApiFixtures(
            env,
            season
          )
        );

      }catch(e){

        return json({
          ok:false,
          error:String(e.message||e)
        },502);

      }
    }


    if(url.pathname==='/api/import'){

      if(
        url.searchParams.get('token')
        !==IMPORT_TOKEN
      ){
        return json({
          ok:false,
          error:'Unauthorized'
        },401);
      }

      try{

        const leagueCode=
          clean(
            url.searchParams.get('league')
          );

        const season=
          clean(
            url.searchParams.get('season')
          );

        if(!leagueCode||!season){
          return json({
            ok:false,
            error:
              'Use league=E0&season=2025/26'
          },400);
        }

        return json({
          ok:true,
          result:
            await importLeagueSeason(
              env,
              leagueCode,
              season
            ),
          counts:
            await getCounts(env)
        });

      }catch(e){

        return json({
          ok:false,
          error:String(e.message||e),
          note:
            'Existing data was not deleted or cleared.'
        },502);

      }
    }


    if(url.pathname==='/api/import-all'){

      if(
        url.searchParams.get('token')
        !==IMPORT_TOKEN
      ){
        return json({
          ok:false,
          error:'Unauthorized'
        },401);
      }

      const season=
        clean(
          url.searchParams.get('season')
        )||'2025/26';

      const part=
        Number(
          url.searchParams.get('part')||'1'
        );

      if(!SEASONS.includes(season)){
        return json({
          ok:false,
          error:
            `Unknown season: ${season}`,
          available:SEASONS
        },400);
      }

      try{

        return json({
          ok:true,
          result:
            await importAllLeagues(
              env,
              season,
              part
            ),
          counts:
            await getCounts(env)
        });

      }catch(e){

        return json({
          ok:false,
          error:String(e.message||e),
          note:
            'Existing data was not deleted or cleared.'
        },502);

      }
    }


    if(url.pathname==='/api/refresh'){

      if(
        url.searchParams.get('token')
        !==IMPORT_TOKEN
      ){
        return json({
          ok:false,
          error:'Unauthorized'
        },401);
      }

      try{

        const code=
          clean(
            url.searchParams.get('league')
          );

        if(!code){
          return json({
            ok:false,
            error:'Use league=E0'
          },400);
        }

        return json({
          ok:true,
          result:
            await importLeagueSeason(
              env,
              code,
              CURRENT_SEASON
            ),
          counts:
            await getCounts(env)
        });

      }catch(e){

        return json({
          ok:false,
          error:String(e.message||e),
          note:
            'Existing data was not deleted or cleared.'
        },502);

      }
    }


    return env.ASSETS.fetch(request);
  },


  async scheduled(controller,env,ctx){

    const d=
      new Date(controller.scheduledTime);

    /*
     * Football-Data zostaje z dotychczasową
     * rotacją.
     *
     * API-Football odświeżamy raz w tygodniu:
     * poniedziałek 03:00 UTC.
     */

    ctx.waitUntil(
      (async()=>{

        try{

          const hour=d.getUTCHours();

          const day=d.getUTCDay();
          // 0 = niedziela
          // 1 = poniedziałek

          if(day===1 && hour===3){

            const result=
              await refreshApiFixtures(
                env,
                CURRENT_SEASON
              );

            console.log(
              'API-Football weekly refresh',
              JSON.stringify(result)
            );
          }


          /*
           * Dotychczasowy mechanizm
           * Football-Data.
           *
           * Rotacja 22 lig przy każdym
           * cron slocie.
           */

          const slot=
            CRON_HOURS.indexOf(hour);

          if(slot>=0){

            const dayNumber=
              Math.floor(
                Date.UTC(
                  d.getUTCFullYear(),
                  d.getUTCMonth(),
                  d.getUTCDate()
                )/86400000
              );

            const index=
              (
                dayNumber*
                CRON_HOURS.length+
                slot
              )%REFRESH_PARTS.length;

            const part=
              REFRESH_PARTS[index];

            for(const code of part){

              try{

                const result=
                  await importLeagueSeason(
                    env,
                    code,
                    CURRENT_SEASON
                  );

                console.log(
                  'Football-Data cron OK',
                  JSON.stringify(result)
                );

              }catch(e){

                console.error(
                  'Football-Data cron FAILED',
                  code,
                  String(e.message||e)
                );

              }
            }
          }

        }catch(e){

          console.error(
            'Scheduled refresh FAILED',
            String(e.message||e)
          );

        }

      })()
    );
  }
};
