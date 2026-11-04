from __future__ import annotations

import argparse
import base64
import getpass
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

WORKER_DEFAULT = "https://football-analyzer.2w77ywngkv.workers.dev"
API_BASE = "https://v3.football.api-sports.io"

FINISHED = {"FT", "AET", "PEN"}
NORMAL_FUTURE = {"NS", "TBD"}

API_BATCH_SIZE = 20
FINISHED_REFRESH_DAYS = 3
SCHEDULE_REFRESH_DAYS = 21
SCHEDULE_PAST_DAYS = 2
API_MIN_INTERVAL = 0.35
CATALOG_CACHE_SECONDS = 6 * 3600

# I Liga / II Liga mają konserwatywne flagi coverage w katalogu API-Football,
# ale synchronizujemy je warunkowo i zapisujemy statystyki tylko wtedy,
# gdy endpoint /fixtures faktycznie je zwraca.
FORCED_POLISH_TIP_LEAGUE_IDS = {107, 109}

_last_api_request = 0.0


def save_json(path: Path, data) -> None:
    path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def chunks(values, size):
    for i in range(0, len(values), size):
        yield values[i:i + size]


def to_number(value):
    try:
        if value in (None, ""):
            return None
        return float(value)
    except Exception:
        return None


def fixture_id(row):
    try:
        value = int((row.get("fixture") or {}).get("id"))
        return value if value > 0 else None
    except Exception:
        return None


def fixture_timestamp(row):
    try:
        return int((row.get("fixture") or {}).get("timestamp"))
    except Exception:
        return None


def fixture_status(row):
    return str(
        ((row.get("fixture") or {}).get("status") or {}).get("short") or ""
    ).upper()


def is_finished(row):
    return fixture_status(row) in FINISHED


def has_complete_stats(row):
    stats = row.get("statistics")
    if not isinstance(stats, list) or len(stats) < 2:
        return False

    teams = row.get("teams") or {}
    try:
        home_id = int((teams.get("home") or {}).get("id"))
        away_id = int((teams.get("away") or {}).get("id"))
    except Exception:
        return False

    found = set()
    for block in stats:
        try:
            found.add(int((block.get("team") or {}).get("id")))
        except Exception:
            pass

    return home_id in found and away_id in found


def worker_request(
    base,
    path,
    password,
    *,
    method="GET",
    payload=None,
    timeout=180,
):
    token = base64.b64encode(
        f"admin:{password}".encode("utf-8")
    ).decode("ascii")

    headers = {
        "Authorization": f"Basic {token}",
        "Accept": "application/json",
        "User-Agent": "Football-Analyzer-Analysis-Local/4.2",
    }

    data = None
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"

    req = urllib.request.Request(
        f"{base.rstrip('/')}{path}",
        data=data,
        headers=headers,
        method=method,
    )

    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            raw = response.read().decode("utf-8", errors="replace")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            body = json.loads(raw)
        except Exception:
            body = {"error": raw or str(exc)}
        detail = body.get("error") if isinstance(body, dict) else body
        raise RuntimeError(
            f"Worker HTTP {exc.code}: {detail or body}"
        ) from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(
            f"Worker: błąd połączenia: {exc}"
        ) from exc


def api_rate_meta(response):
    return {
        "minute_limit": to_number(
            response.headers.get("X-RateLimit-Limit")
        ),
        "minute_remaining": to_number(
            response.headers.get("X-RateLimit-Remaining")
        ),
        "daily_limit": to_number(
            response.headers.get("x-ratelimit-requests-limit")
        ),
        "daily_remaining": to_number(
            response.headers.get("x-ratelimit-requests-remaining")
        ),
    }


def is_rate_limit(body, status=None):
    if status == 429:
        return True
    try:
        text = json.dumps(
            body.get("errors") if isinstance(body, dict) else body,
            ensure_ascii=False,
        ).lower()
    except Exception:
        text = str(body).lower()

    return any(
        token in text
        for token in (
            "too many requests",
            "rate limit",
            "ratelimit",
            "limit of requests per minute",
        )
    )


def api_get(
    api_key,
    endpoint,
    params=None,
    *,
    retries=5,
    cooldown=65.0,
    timeout=120,
):
    global _last_api_request

    params = params or {}
    query = urllib.parse.urlencode(
        {
            key: value
            for key, value in params.items()
            if value not in (None, "")
        }
    )

    url = f"{API_BASE}{endpoint}"
    if query:
        url += f"?{query}"

    for attempt in range(retries + 1):
        elapsed = time.monotonic() - _last_api_request
        if _last_api_request and elapsed < API_MIN_INTERVAL:
            time.sleep(API_MIN_INTERVAL - elapsed)

        req = urllib.request.Request(
            url,
            headers={
                "x-apisports-key": api_key,
                "Accept": "application/json",
                "User-Agent": "Football-Analyzer-Local-Analysis-Sync/4.2",
            },
            method="GET",
        )

        try:
            _last_api_request = time.monotonic()

            with urllib.request.urlopen(req, timeout=timeout) as response:
                raw = response.read().decode("utf-8", errors="replace")
                body = json.loads(raw) if raw else {}
                body["__api_rate_limit"] = api_rate_meta(response)

                errors = body.get("errors")
                has_errors = (
                    isinstance(errors, list) and bool(errors)
                ) or (
                    isinstance(errors, dict) and bool(errors)
                ) or (
                    errors not in (None, [], {}, False, "")
                )

                if not has_errors:
                    return body

                if is_rate_limit(body, response.status):
                    if attempt >= retries:
                        raise RuntimeError(
                            "API-Football: limit minutowy nie ustąpił po ponowieniach."
                        )
                    print(
                        f"  LIMIT API-Football lokalnie — cooldown "
                        f"{cooldown:.0f}s, próba {attempt + 1}/{retries}"
                    )
                    time.sleep(cooldown)
                    continue

                raise RuntimeError(
                    "API-Football: "
                    + json.dumps(errors, ensure_ascii=False)
                )

        except urllib.error.HTTPError as exc:
            raw = exc.read().decode("utf-8", errors="replace")
            try:
                body = json.loads(raw)
            except Exception:
                body = {"errors": raw or str(exc)}

            if is_rate_limit(body, exc.code) and attempt < retries:
                print(
                    f"  LIMIT API-Football lokalnie — cooldown "
                    f"{cooldown:.0f}s, próba {attempt + 1}/{retries}"
                )
                time.sleep(cooldown)
                continue

            raise RuntimeError(
                f"API-Football HTTP {exc.code}: "
                f"{json.dumps(body, ensure_ascii=False)}"
            ) from exc

        except urllib.error.URLError as exc:
            if attempt < retries:
                time.sleep(2)
                continue
            raise RuntimeError(
                f"API-Football: błąd połączenia: {exc}"
            ) from exc

    raise RuntimeError("API-Football: brak odpowiedzi.")


def force_polish_tip_competitions(competitions):
    rows = [dict(row) for row in competitions]
    present = set()

    for row in rows:
        try:
            league_id = int(row.get("league_id"))
        except Exception:
            continue

        if league_id not in FORCED_POLISH_TIP_LEAGUE_IDS:
            continue

        present.add(league_id)
        row["eligible"] = True
        row["analysis_only"] = False
        row["tip_scope"] = True
        row["forced_tip_scope"] = True
        row["type"] = "LEAGUE"
        row["category"] = "POLAND_FORCED_TIPS"

    fallback = {
        107: "I Liga",
        109: "II Liga - East",
    }

    for league_id, name in fallback.items():
        if league_id in present:
            continue

        rows.append(
            {
                "league_id": league_id,
                "season": 2026,
                "name": name,
                "country": "Poland",
                "type": "LEAGUE",
                "category": "POLAND_FORCED_TIPS",
                "eligible": True,
                "analysis_only": False,
                "tip_scope": True,
                "forced_tip_scope": True,
            }
        )

    return rows


def fmt_comp(row):
    tag = "CUP" if row.get("type") == "CUP" else "LIGA"
    scope = "TYPY+ANALIZA" if row.get("tip_scope") else "ANALIZA"
    return (
        f"{int(row.get('league_id', 0)):>5} | "
        f"{row.get('season')} | {tag:<4} | {scope:<13} | "
        f"{row.get('country')} | {row.get('name')}"
    )


def get_catalog(api_key, worker, password, out_dir, refresh=False):
    cache = out_dir / "analysis-competition-catalog.json"

    if cache.exists() and not refresh:
        try:
            catalog = load_json(cache)
            generated_at = str(catalog.get("generated_at") or "")
            generated = datetime.fromisoformat(
                generated_at.replace("Z", "+00:00")
            )
            age = (
                datetime.now(timezone.utc) - generated
            ).total_seconds()

            if 0 <= age <= CATALOG_CACHE_SECONDS:
                print(
                    f"Używam świeżego cache katalogu ({age / 60:.0f} min)."
                )
                return catalog
        except Exception:
            pass

    print("Pobieram /leagues lokalnie z API-Football...")
    api_body = api_get(
        api_key,
        "/leagues",
        {"current": "true"},
    )

    print("Worker filtruje katalog po whiteliście...")
    catalog = worker_request(
        worker,
        "/admin/analysis-sync/catalog-local",
        password,
        method="POST",
        payload={"api_body": api_body},
        timeout=180,
    )

    save_json(cache, catalog)
    return catalog


def get_existing(worker, password, league_id, season):
    body = worker_request(
        worker,
        (
            "/admin/analysis-sync/existing"
            f"?league_id={urllib.parse.quote(str(league_id))}"
            f"&season={urllib.parse.quote(str(season))}"
        ),
        password,
    )

    fixture_ids = set()
    complete_ids = set()
    fixtures = {}

    for value in body.get("fixture_ids") or []:
        try:
            fixture_ids.add(int(value))
        except Exception:
            pass

    for value in body.get("complete_stats_fixture_ids") or []:
        try:
            complete_ids.add(int(value))
        except Exception:
            pass

    for row in body.get("fixtures") or []:
        try:
            fid = int(row.get("fixture_id"))
        except Exception:
            continue

        fixtures[fid] = {
            "fixture_timestamp": row.get("fixture_timestamp"),
            "status_short": row.get("status_short"),
            "stats_rows": row.get("stats_rows"),
        }

    return {
        "fixture_ids": fixture_ids,
        "complete_ids": complete_ids,
        "fixtures": fixtures,
    }


def save_state(
    worker,
    password,
    competition,
    status,
    *,
    summary=None,
    error=None,
):
    worker_request(
        worker,
        "/admin/analysis-sync/state",
        password,
        method="POST",
        payload={
            "competition": competition,
            "status": status,
            "summary": summary,
            "error": error,
        },
    )


def sync_one(api_key, worker, password, competition):
    league_id = int(competition["league_id"])
    season = int(competition["season"])

    before = get_existing(
        worker,
        password,
        league_id,
        season,
    )

    list_body = api_get(
        api_key,
        "/fixtures",
        {
            "league": league_id,
            "season": season,
        },
    )

    rate = list_body.get("__api_rate_limit") or {}
    all_fixtures = list_body.get("response") or []
    finished = [row for row in all_fixtures if is_finished(row)]
    future = [row for row in all_fixtures if not is_finished(row)]

    now_ts = int(time.time())
    schedule_from = now_ts - SCHEDULE_PAST_DAYS * 86400
    schedule_to = now_ts + SCHEDULE_REFRESH_DAYS * 86400

    schedule_selected = []

    for row in future:
        fid = fixture_id(row)
        if fid is None:
            continue

        ts = fixture_timestamp(row)
        status = fixture_status(row)
        existing = before["fixtures"].get(fid)

        missing = fid not in before["fixture_ids"]
        near = (
            ts is not None
            and schedule_from <= ts <= schedule_to
        )
        timestamp_changed = (
            existing is not None
            and ts is not None
            and int(existing.get("fixture_timestamp") or 0) != ts
        )
        status_changed = (
            existing is not None
            and str(existing.get("status_short") or "") != status
        )
        special = bool(
            status
            and status not in NORMAL_FUTURE
        )

        if (
            missing
            or near
            or timestamp_changed
            or status_changed
            or special
        ):
            schedule_selected.append(row)

    schedule_written = 0
    schedule_inserted = 0
    schedule_updated = 0

    schedule_batches = list(
        chunks(schedule_selected, API_BATCH_SIZE)
    )

    for index, fixtures in enumerate(schedule_batches, start=1):
        body = worker_request(
            worker,
            "/admin/analysis-sync/ingest-schedule",
            password,
            method="POST",
            payload={
                "source": "api-football-analysis-local",
                "league_id": league_id,
                "season": season,
                "batch_number": index,
                "total_batches": len(schedule_batches),
                "fixtures": fixtures,
            },
            timeout=180,
        )

        ingest = (
            (body.get("result") or {}).get("ingest")
            or body.get("ingest")
            or {}
        )

        schedule_written += len(fixtures)
        schedule_inserted += int(
            ingest.get("fixtures_inserted") or 0
        )
        schedule_updated += int(
            ingest.get("fixtures_updated") or 0
        )

    refresh_threshold = (
        now_ts - FINISHED_REFRESH_DAYS * 86400
    )

    finished_ids = []

    for row in finished:
        fid = fixture_id(row)
        if fid is None:
            continue

        ts = fixture_timestamp(row)
        missing_stats = fid not in before["complete_ids"]
        recent = (
            ts is not None
            and ts >= refresh_threshold
        )

        if missing_stats or recent:
            finished_ids.append(fid)

    finished_written = 0
    stats_skipped = 0
    stats_skipped_ids = set()
    detail_requests = 0

    id_batches = list(
        chunks(finished_ids, API_BATCH_SIZE)
    )

    for index, ids in enumerate(id_batches, start=1):
        detail = api_get(
            api_key,
            "/fixtures",
            {
                "ids": "-".join(
                    str(value) for value in ids
                )
            },
        )
        detail_requests += 1

        if detail.get("__api_rate_limit"):
            rate = detail["__api_rate_limit"]

        complete = []

        for row in detail.get("response") or []:
            if not is_finished(row):
                continue

            if not has_complete_stats(row):
                stats_skipped += 1
                skipped_id = fixture_id(row)
                if skipped_id is not None:
                    stats_skipped_ids.add(skipped_id)
                continue

            complete.append(row)

        # Jeśli API nie zwróciło któregoś requested ID wcale,
        # również traktujemy go jako brak danych po stronie API.
        returned_ids = {
            fid
            for fid in (
                fixture_id(row)
                for row in (detail.get("response") or [])
            )
            if fid is not None
        }

        for requested_id in ids:
            if requested_id not in returned_ids:
                stats_skipped += 1
                stats_skipped_ids.add(requested_id)

        if not complete:
            continue

        worker_request(
            worker,
            "/admin/analysis-sync/ingest-fixtures",
            password,
            method="POST",
            payload={
                "source": "api-football-analysis-local",
                "league_id": league_id,
                "season": season,
                "sync_type": "ANALYSIS_ONLY_LOCAL",
                "batch_number": index,
                "total_batches": len(id_batches),
                "total_finished": len(finished),
                "fixtures": complete,
            },
            timeout=240,
        )

        finished_written += len(complete)

    after = get_existing(
        worker,
        password,
        league_id,
        season,
    )

    finished_season_ids = {
        fid
        for fid in (
            fixture_id(row) for row in finished
        )
        if fid is not None
    }

    future_season_ids = {
        fid
        for fid in (
            fixture_id(row) for row in future
        )
        if fid is not None
    }

    missing_finished = sorted(
        finished_season_ids - after["complete_ids"]
    )

    missing_schedule = sorted(
        future_season_ids - after["fixture_ids"]
    )

    missing_finished_set = set(missing_finished)

    api_data_gaps = (
        bool(missing_finished_set)
        and not missing_schedule
        and missing_finished_set.issubset(
            stats_skipped_ids
        )
    )

    status = (
        "COMPLETE"
        if (
            not missing_schedule
            and (
                not missing_finished_set
                or api_data_gaps
            )
        )
        else "PARTIAL"
    )

    summary = {
        "league_id": league_id,
        "league": competition.get("name"),
        "country": competition.get("country"),
        "type": competition.get("type"),
        "category": competition.get("category"),
        "season": season,
        "fixtures_api": len(all_fixtures),
        "finished": len(finished),
        "scheduled": len(future),
        "schedule_written": schedule_written,
        "schedule_inserted": schedule_inserted,
        "schedule_updated": schedule_updated,
        "finished_selected": len(finished_ids),
        "finished_written": finished_written,
        "stats_skipped": stats_skipped,
        "stats_skipped_fixture_ids": sorted(
            stats_skipped_ids
        ),
        "api_requests": 1 + detail_requests,
        "rate_limit": rate,
        "missing_finished_stats": len(
            missing_finished_set
        ),
        "missing_schedule": len(missing_schedule),
        "api_data_gaps": (
            len(missing_finished_set)
            if api_data_gaps
            else 0
        ),
        "api_gap_fixture_ids": (
            sorted(missing_finished_set)
            if api_data_gaps
            else []
        ),
        "complete_with_api_gaps": api_data_gaps,
        "status": status,
    }

    save_state(
        worker,
        password,
        competition,
        status,
        summary=summary,
    )

    return summary


def main():
    parser = argparse.ArgumentParser(
        description=(
            "Football Analyzer cloud data sync. API-Football jest pobierane "
            "poza Cloudflare; Worker tylko zapisuje/odczytuje D1."
        )
    )

    parser.add_argument(
        "--base",
        default=WORKER_DEFAULT,
    )
    parser.add_argument(
        "--sync",
        action="store_true",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
    )
    parser.add_argument(
        "--force",
        action="store_true",
    )
    parser.add_argument(
        "--refresh-catalog",
        action="store_true",
    )
    parser.add_argument(
        "--password",
        default=None,
    )
    parser.add_argument(
        "--pause",
        type=float,
        default=0.8,
    )
    parser.add_argument(
        "--scope",
        choices=("all", "analysis-only", "tips"),
        default="all",
        help="Zakres rozgrywek do synchronizacji. GitHub Actions powinien używać all.",
    )

    args = parser.parse_args()

    password = (
        args.password
        or os.getenv("ADMIN_PASSWORD", "")
        or getpass.getpass(
            "Hasło admina Football Analyzer: "
        )
    ).strip()

    if not password:
        print("Brak hasła admina.")
        return 2

    api_key = os.getenv(
        "API_FOOTBALL_KEY",
        "",
    ).strip()

    if not api_key:
        api_key = getpass.getpass(
            "API_FOOTBALL_KEY (lokalnie, niewidoczne): "
        ).strip()

    if not api_key:
        print("Brak API_FOOTBALL_KEY.")
        return 2

    out_dir = Path.cwd()

    print("=" * 106)
    print("FOOTBALL ANALYZER — CLOUD DATA SYNC V4.3")
    print("=" * 106)
    print(f"Worker: {args.base}")
    print("API-Football: zewnętrzny runner (np. GitHub Actions)")
    print()

    catalog = get_catalog(
        api_key,
        args.base,
        password,
        out_dir,
        refresh=args.refresh_catalog,
    )

    competitions = force_polish_tip_competitions(
        list(catalog.get("competitions") or [])
    )

    eligible = [
        row
        for row in competitions
        if row.get("eligible")
    ]

    analysis_only = [
        row
        for row in eligible
        if row.get("analysis_only")
    ]

    tip_scope = [
        row
        for row in eligible
        if row.get("tip_scope")
    ]

    no_stats = [
        row
        for row in competitions
        if not row.get("eligible")
    ]

    print(
        f"Whitelist dopasowała:      "
        f"{catalog.get('matched_count', 0)}"
    )
    print(
        f"Z pełnymi statystykami:    "
        f"{len(eligible)}"
    )
    print(
        f"Już w Typach + Analizie:   "
        f"{len(tip_scope)}"
    )
    print(
        f"Nowe tylko do Analizy:     "
        f"{len(analysis_only)}"
    )
    forced_poland = [
        row for row in eligible
        if row.get("forced_tip_scope")
    ]
    print(
        f"Polska wymuszona do Typów: "
        f"{len(forced_poland)} (I Liga + II Liga; statystyki tylko jeśli API je zwróci)"
    )
    print(
        f"Odrzucone przez coverage:  "
        f"{len(no_stats)}"
    )

    if args.scope == "all":
        scope_rows = eligible
        scope_label = "WSZYSTKIE OBSŁUGIWANE ROZGRYWKI"
    elif args.scope == "tips":
        scope_rows = tip_scope
        scope_label = "DOTYCHCZASOWY TIP SCOPE"
    else:
        scope_rows = analysis_only
        scope_label = "ANALYSIS-ONLY"

    print(f"\n{scope_label}")
    print("-" * 106)

    for row in scope_rows:
        print(fmt_comp(row))

    if not args.sync:
        print()
        print(
            "Podgląd gotowy. Nic nie zostało zapisane do D1."
        )
        print(
            "Import: python sync-football-data-cloud.py "
            "--sync --scope all --force"
        )
        return 0

    status_body = worker_request(
        args.base,
        "/admin/analysis-sync/status",
        password,
    )

    states = {}
    for row in status_body.get("states") or []:
        try:
            key = (
                int(row.get("league_id")),
                int(row.get("season")),
            )
        except Exception:
            continue
        states[key] = row

    queue = []

    for row in scope_rows:
        key = (
            int(row["league_id"]),
            int(row["season"]),
        )

        previous = states.get(key)

        if (
            not args.force
            and previous
            and previous.get("last_status") == "COMPLETE"
        ):
            continue

        queue.append(row)

    if args.limit > 0:
        queue = queue[:args.limit]

    print(f"\nDo synchronizacji: {len(queue)}")

    report = {
        "started_at": datetime.now(
            timezone.utc
        ).isoformat(),
        "version": "V4.3_CLOUD",
        "mode": "CLOUD_API_FOOTBALL",
        "scope": args.scope,
        "requested": len(queue),
        "results": [],
    }

    for index, competition in enumerate(
        queue,
        start=1,
    ):
        label = (
            f"{competition.get('country')} · "
            f"{competition.get('name')} "
            f"({competition.get('season')})"
        )

        print(
            f"\n[{index}/{len(queue)}] {label}"
        )

        try:
            summary = sync_one(
                api_key,
                args.base,
                password,
                competition,
            )

            report["results"].append(
                {
                    "competition": competition,
                    "ok": True,
                    "summary": summary,
                }
            )

            gap_note = (
                f" | braki API="
                f"{summary.get('api_data_gaps', 0)}"
                if summary.get(
                    "complete_with_api_gaps"
                )
                else ""
            )

            print(
                f"  {summary['status']} | "
                f"fixtures={summary['fixtures_api']} | "
                f"historia={summary['finished_written']} | "
                f"terminarz={summary['schedule_written']} | "
                f"API calls={summary['api_requests']}"
                f"{gap_note}"
            )

            rate = summary.get(
                "rate_limit"
            ) or {}

            if rate.get(
                "daily_remaining"
            ) is not None:
                print(
                    "  API remaining: "
                    f"min {rate.get('minute_remaining')} / "
                    f"{rate.get('minute_limit')} | "
                    f"day {rate.get('daily_remaining')} / "
                    f"{rate.get('daily_limit')}"
                )

                try:
                    if float(
                        rate["daily_remaining"]
                    ) <= 25:
                        print(
                            "  STOP: zostało <=25 "
                            "zapytań na dziś."
                        )
                        break
                except Exception:
                    pass

        except Exception as exc:
            message = str(exc)
            print(f"  BŁĄD: {message}")

            try:
                save_state(
                    args.base,
                    password,
                    competition,
                    "ERROR",
                    error=message,
                )
            except Exception:
                pass

            report["results"].append(
                {
                    "competition": competition,
                    "ok": False,
                    "error": message,
                }
            )

            break

        if args.pause > 0:
            time.sleep(args.pause)

    report["finished_at"] = datetime.now(
        timezone.utc
    ).isoformat()

    report_path = Path(
        os.getenv("FOOTBALL_SYNC_REPORT", "analysis-sync-report.json")
    )
    if not report_path.is_absolute():
        report_path = out_dir / report_path
    save_json(
        report_path,
        report,
    )

    ok = sum(
        1
        for row in report["results"]
        if row.get("ok")
    )

    errors = sum(
        1
        for row in report["results"]
        if not row.get("ok")
    )

    print()
    print("=" * 106)
    print(
        f"KONIEC — OK: {ok} | "
        f"błędy: {errors}"
    )
    print(
        f"Raport: {report_path}"
    )

    return 0 if errors == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
