from __future__ import annotations

import argparse
import base64
import json
import os
import getpass
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

WORKER_DEFAULT = "https://football-analyzer.2w77ywngkv.workers.dev"
MAX_WORKERS_DEFAULT = 3


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def auth_header(password: str) -> str:
    token = base64.b64encode(f"admin:{password}".encode("utf-8")).decode("ascii")
    return f"Basic {token}"


def request_json(
    base: str,
    password: str,
    path: str,
    *,
    method: str = "GET",
    payload=None,
    timeout: int = 240,
):
    headers = {
        "Authorization": auth_header(password),
        "Accept": "application/json",
        "User-Agent": "Football-Analyzer-Cloud-Odds-Sync/1.0",
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
            body = json.loads(raw) if raw else {}
            if not isinstance(body, dict):
                raise RuntimeError(f"Nieoczekiwana odpowiedź Worker: {type(body).__name__}")
            return body
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            body = json.loads(raw) if raw else {}
        except Exception:
            body = {"error": raw or str(exc)}
        detail = body.get("error") if isinstance(body, dict) else body
        raise RuntimeError(f"Worker HTTP {exc.code}: {detail or body}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Worker: błąd połączenia: {exc}") from exc


def mapped_targets(base: str, password: str, run_id: str):
    body = request_json(
        base,
        password,
        f"/admin/sync/targets?run_id={run_id}",
        timeout=120,
    )
    return body, list(body.get("fixtures") or [])


def run_one_fixture(base: str, password: str, run_id: str, fixture: dict):
    fixture_id = int(fixture["fixture_id"])
    body = request_json(
        base,
        password,
        "/admin/sync/superbet-model",
        method="POST",
        payload={"run_id": run_id, "fixture_id": fixture_id},
        timeout=180,
    )
    result = body.get("result") or {}
    return fixture, result


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Cloud orchestration: OddsPAPI tylko discovery/mapping, "
            "Superbet Direct pełne rynki, potem model."
        )
    )
    parser.add_argument("--base", default=WORKER_DEFAULT)
    parser.add_argument("--skip-discovery", action="store_true")
    parser.add_argument("--workers", type=int, default=MAX_WORKERS_DEFAULT)
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()

    password = os.getenv("ADMIN_PASSWORD", "").strip()
    if not password:
        password = getpass.getpass(
            "Hasło admina Football Analyzer: "
        ).strip()
    if not password:
        print("BŁĄD: brak ADMIN_PASSWORD.")
        return 2

    workers = max(1, min(6, int(args.workers or MAX_WORKERS_DEFAULT)))
    started_at = now_iso()

    print("=" * 100)
    print("FOOTBALL ANALYZER — CLOUD ODDS + MODEL")
    print("=" * 100)
    print(f"Start UTC: {started_at}")
    print(f"Worker:    {args.base}")
    print(f"Discovery: {'POMINIĘTE' if args.skip_discovery else 'OddsPAPI -> mapping Superbet'}")
    print(f"Kursy:     Superbet Direct")
    print(f"Wątki:     {workers}")
    print()

    # Normalizuje też wygasły lock po poprzednim runie.
    status = request_json(args.base, password, "/admin/sync/status", timeout=60)
    state = status.get("state") or {}
    if state.get("status") == "RUNNING":
        print("SKIP: inna sesja odświeżania jest aktywna.")
        print(f"run_id={state.get('run_id')}")
        return 0

    started = request_json(
        args.base,
        password,
        "/admin/sync/start",
        method="POST",
        payload={},
        timeout=60,
    )
    run_id = str(started.get("run_id") or "")
    if not run_id:
        print("BŁĄD: Worker nie zwrócił run_id.")
        return 1

    summary = {
        "source": "github-actions-cloud",
        "started_at": started_at,
        "run_id": run_id,
        "discovery": None,
        "targets": {},
        "direct": {
            "requested": 0,
            "ok": 0,
            "skipped": 0,
            "errors": 0,
            "quotes": 0,
            "predictions": 0,
            "shadow_predictions": 0,
        },
        "error_samples": [],
    }

    finish_status = "OK"
    finish_error = None

    try:
        if not args.skip_discovery:
            print("[1/2] OddsPAPI autodiscovery...")
            discovery = request_json(
                args.base,
                password,
                "/admin/sync/autodiscover",
                method="POST",
                payload={"run_id": run_id},
                timeout=300,
            ).get("result") or {}
            summary["discovery"] = discovery
            print(
                "  PAPI req={req} | D1 unmapped={unmapped} | candidates={cand} | mapped={mapped}".format(
                    req=discovery.get("api_requests", 0),
                    unmapped=discovery.get("d1_unmapped_before", 0),
                    cand=discovery.get("candidate_matches", 0),
                    mapped=discovery.get("mapped", 0),
                )
            )
        else:
            print("[1/2] OddsPAPI discovery pominięte — używam istniejących mapowań.")

        target_body, fixtures = mapped_targets(args.base, password, run_id)
        if args.limit > 0:
            fixtures = fixtures[: args.limit]

        summary["targets"] = {
            "window_days": target_body.get("window_days"),
            "fixtures_total": target_body.get("fixtures_total"),
            "fixtures_mapped": target_body.get("fixtures_mapped"),
            "fixtures_unmapped": target_body.get("fixtures_unmapped"),
        }
        summary["direct"]["requested"] = len(fixtures)

        print(
            f"[2/2] Superbet Direct + model: {len(fixtures)} zmapowanych meczów "
            f"(okno {target_body.get('window_days', '?')} dni)."
        )

        if fixtures:
            with ThreadPoolExecutor(max_workers=workers) as pool:
                future_map = {
                    pool.submit(run_one_fixture, args.base, password, run_id, fixture): fixture
                    for fixture in fixtures
                }

                done = 0
                for future in as_completed(future_map):
                    fixture = future_map[future]
                    done += 1
                    label = f"{fixture.get('home', '?')} - {fixture.get('away', '?')}"
                    try:
                        _, result = future.result()
                        if result.get("skipped"):
                            summary["direct"]["skipped"] += 1
                        else:
                            summary["direct"]["ok"] += 1
                            summary["direct"]["quotes"] += int(result.get("quotes") or 0)
                            model = result.get("model") or {}
                            summary["direct"]["predictions"] += int(model.get("saved_predictions") or 0)
                            summary["direct"]["shadow_predictions"] += int(
                                model.get("shadow_v4_saved_predictions") or 0
                            )
                        print(
                            f"  [{done}/{len(fixtures)}] OK {label} | "
                            f"quotes={result.get('quotes', 0)}"
                        )
                    except Exception as exc:
                        summary["direct"]["errors"] += 1
                        if len(summary["error_samples"]) < 10:
                            summary["error_samples"].append(
                                {
                                    "fixture_id": fixture.get("fixture_id"),
                                    "match": label,
                                    "error": str(exc),
                                }
                            )
                        print(f"  [{done}/{len(fixtures)}] BŁĄD {label} | {exc}")

        if summary["direct"]["errors"]:
            finish_status = "ERROR"
            finish_error = f"Superbet/model errors: {summary['direct']['errors']}"

    except Exception as exc:
        finish_status = "ERROR"
        finish_error = str(exc)
        summary["fatal_error"] = str(exc)
        print(f"BŁĄD KRYTYCZNY: {exc}")

    summary["finished_at"] = now_iso()

    try:
        request_json(
            args.base,
            password,
            "/admin/sync/finish",
            method="POST",
            payload={
                "run_id": run_id,
                "status": finish_status,
                "summary": summary,
                "error": finish_error,
            },
            timeout=60,
        )
    except Exception as exc:
        print(f"UWAGA: nie udało się zamknąć sesji: {exc}")
        if finish_status == "OK":
            finish_status = "ERROR"

    print()
    print("=" * 100)
    print(
        "KONIEC | status={status} | direct OK={ok} | błędy={errors} | quotes={quotes} | prognozy={pred}".format(
            status=finish_status,
            ok=summary["direct"]["ok"],
            errors=summary["direct"]["errors"],
            quotes=summary["direct"]["quotes"],
            pred=summary["direct"]["predictions"],
        )
    )
    print("=" * 100)

    return 0 if finish_status == "OK" else 1


if __name__ == "__main__":
    raise SystemExit(main())
