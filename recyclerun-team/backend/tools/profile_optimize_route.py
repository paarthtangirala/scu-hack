"""Deterministic profiling harness for /api/optimize-route latency."""
from __future__ import annotations

import argparse
import json
import os
import random
import statistics
import subprocess
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

PROJECT_ROOT = Path(__file__).resolve().parents[2]

import sys

if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.app import create_app
from backend.models.listing import Listing
from backend.models.material import Material
from backend.services.store import store


@dataclass(frozen=True)
class Scenario:
    dataset_multiplier: int
    objective: str
    solver_mode: str  # normal | forced_fallback


def percentile(values: list[float], pct: float) -> float:
    if not values:
        return 0.0
    if len(values) == 1:
        return values[0]
    sorted_vals = sorted(values)
    rank = (len(sorted_vals) - 1) * pct
    lower = int(rank)
    upper = min(lower + 1, len(sorted_vals) - 1)
    weight = rank - lower
    return sorted_vals[lower] * (1.0 - weight) + sorted_vals[upper] * weight


def summarize_latency_ns(samples_ns: list[int]) -> dict:
    samples_ms = [v / 1_000_000.0 for v in samples_ns]
    stddev = statistics.pstdev(samples_ms) if len(samples_ms) > 1 else 0.0
    return {
        "sample_count": len(samples_ms),
        "mean_ms": round(statistics.mean(samples_ms), 3) if samples_ms else 0.0,
        "p50_ms": round(percentile(samples_ms, 0.50), 3),
        "p95_ms": round(percentile(samples_ms, 0.95), 3),
        "p99_ms": round(percentile(samples_ms, 0.99), 3),
        "max_ms": round(max(samples_ms), 3) if samples_ms else 0.0,
        "stddev_ms": round(stddev, 3),
    }


def _clone_listing(template: Listing, multiplier: int, clone_idx: int, rng: random.Random) -> Listing:
    lat = template.lat + rng.uniform(-0.02, 0.02)
    lng = template.lng + rng.uniform(-0.02, 0.02)
    materials = [Material(type=m.type, lbs=m.lbs) for m in template.materials]
    listing = Listing(
        address=f"{template.address} [stress m{multiplier}:{clone_idx}]",
        lat=lat,
        lng=lng,
        household_name=f"{template.household_name} m{multiplier}:{clone_idx}",
        phone=f"+1408{multiplier:02d}{clone_idx:06d}"[:12],
        listing_kind=template.listing_kind,
        materials=materials,
        notes=template.notes,
    )
    listing.id = f"{template.id}_m{multiplier}_{clone_idx:05d}"
    listing.status = "available"
    return listing


def prepare_store_for_multiplier(multiplier: int, seed: int) -> int:
    if multiplier < 1:
        raise ValueError("dataset multiplier must be >= 1")

    store.reset_demo()
    if multiplier == 1:
        return len(store.all("available"))

    rng = random.Random(seed + multiplier * 10_007)
    base = list(store.all("available"))
    base_count = len(base)
    target_count = base_count * multiplier

    for idx in range(base_count, target_count):
        template = base[idx % base_count]
        store.add(_clone_listing(template=template, multiplier=multiplier, clone_idx=idx, rng=rng))

    return len(store.all("available"))


def build_scenarios(stress_multipliers: Iterable[int], objectives: Iterable[str], force_fallback_only: bool) -> list[Scenario]:
    multipliers = sorted({1, *[int(m) for m in stress_multipliers]})
    obj_list = [str(o).strip().lower() for o in objectives]
    solver_modes = ["forced_fallback"] if force_fallback_only else ["normal", "forced_fallback"]
    scenarios: list[Scenario] = []
    for multiplier in multipliers:
        for objective in obj_list:
            for solver_mode in solver_modes:
                scenarios.append(Scenario(dataset_multiplier=multiplier, objective=objective, solver_mode=solver_mode))
    return scenarios


def _git_commit_hash() -> str:
    try:
        out = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=PROJECT_ROOT, text=True)
        return out.strip()
    except Exception:
        return "unknown"


def _configure_force_fallback(enabled: bool) -> str | None:
    prev = os.environ.get("OPTIMIZER_FORCE_FALLBACK")
    if enabled:
        os.environ["OPTIMIZER_FORCE_FALLBACK"] = "1"
    else:
        os.environ.pop("OPTIMIZER_FORCE_FALLBACK", None)
    return prev


def _restore_force_fallback(prev: str | None) -> None:
    if prev is None:
        os.environ.pop("OPTIMIZER_FORCE_FALLBACK", None)
    else:
        os.environ["OPTIMIZER_FORCE_FALLBACK"] = prev


def profile_scenario(client, scenario: Scenario, *, runs: int, warmup: int, seed: int) -> dict:
    dataset_size = prepare_store_for_multiplier(scenario.dataset_multiplier, seed=seed)
    force_fallback = scenario.solver_mode == "forced_fallback"
    prev_force_value = _configure_force_fallback(force_fallback)

    payload = {
        "lat": 37.3541,
        "lng": -121.9552,
        "max_minutes": 240,
        "truck_capacity_lbs": 1000,
        "objective": scenario.objective,
    }

    try:
        observed_solvers: set[str] = set()

        for _ in range(warmup):
            resp = client.post("/api/optimize-route", json=payload)
            if resp.status_code != 200:
                raise RuntimeError(f"warmup failed ({resp.status_code}): {resp.get_data(as_text=True)}")
            body = resp.get_json() or {}
            observed_solvers.add(str((body.get("summary") or {}).get("solver", "unknown")))

        samples_ns: list[int] = []
        for _ in range(runs):
            t0 = time.perf_counter_ns()
            resp = client.post("/api/optimize-route", json=payload)
            elapsed = time.perf_counter_ns() - t0
            if resp.status_code != 200:
                raise RuntimeError(f"run failed ({resp.status_code}): {resp.get_data(as_text=True)}")
            body = resp.get_json() or {}
            observed_solvers.add(str((body.get("summary") or {}).get("solver", "unknown")))
            samples_ns.append(elapsed)

        return {
            "scenario_name": f"m{scenario.dataset_multiplier}_{scenario.objective}_{scenario.solver_mode}",
            "dataset_multiplier": scenario.dataset_multiplier,
            "dataset_size": dataset_size,
            "objective": scenario.objective,
            "solver_mode": scenario.solver_mode,
            "observed_solvers": sorted(observed_solvers),
            "metrics": summarize_latency_ns(samples_ns),
        }
    finally:
        _restore_force_fallback(prev_force_value)


def format_table(rows: list[dict]) -> str:
    header = (
        "scenario", "size", "objective", "solver_mode", "observed", "p50_ms", "p95_ms", "p99_ms", "mean_ms", "max_ms", "stddev_ms", "n"
    )
    line = " | ".join(header)
    sep = "-+-".join("-" * len(h) for h in header)
    rendered = [line, sep]
    for row in rows:
        metrics = row["metrics"]
        rendered.append(
            " | ".join(
                [
                    str(row["scenario_name"]),
                    str(row["dataset_size"]),
                    str(row["objective"]),
                    str(row["solver_mode"]),
                    ",".join(row["observed_solvers"]),
                    str(metrics["p50_ms"]),
                    str(metrics["p95_ms"]),
                    str(metrics["p99_ms"]),
                    str(metrics["mean_ms"]),
                    str(metrics["max_ms"]),
                    str(metrics["stddev_ms"]),
                    str(metrics["sample_count"]),
                ]
            )
        )
    return "\n".join(rendered)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Deterministic /api/optimize-route latency profiler")
    parser.add_argument("--runs", type=int, default=40, help="Measured requests per scenario")
    parser.add_argument("--warmup", type=int, default=8, help="Warmup requests per scenario")
    parser.add_argument("--seed", type=int, default=20260301, help="Deterministic random seed")
    parser.add_argument(
        "--stress-multiplier",
        type=int,
        action="append",
        dest="stress_multipliers",
        help="Additional dataset multiplier(s). Repeat flag for multiple values. Defaults to 5 and 10.",
    )
    parser.add_argument(
        "--objective",
        choices=["value", "lbs"],
        action="append",
        dest="objectives",
        help="Objective(s) to profile. Repeat flag. Defaults to value and lbs.",
    )
    parser.add_argument(
        "--force-fallback",
        action="store_true",
        help="Only run forced fallback (greedy) scenarios.",
    )
    parser.add_argument("--json-out", type=str, default="", help="Optional path to write JSON report")
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    stress_multipliers = args.stress_multipliers or [5, 10]
    objectives = args.objectives or ["value", "lbs"]

    app = create_app()
    client = app.test_client()

    scenarios = build_scenarios(
        stress_multipliers=stress_multipliers,
        objectives=objectives,
        force_fallback_only=bool(args.force_fallback),
    )

    rows = [
        profile_scenario(
            client,
            scenario,
            runs=max(1, int(args.runs)),
            warmup=max(0, int(args.warmup)),
            seed=int(args.seed),
        )
        for scenario in scenarios
    ]

    report = {
        "metadata": {
            "timestamp_utc": datetime.now(timezone.utc).isoformat(),
            "commit": _git_commit_hash(),
            "runs": int(args.runs),
            "warmup": int(args.warmup),
            "seed": int(args.seed),
            "stress_multipliers": stress_multipliers,
            "objectives": objectives,
            "force_fallback_only": bool(args.force_fallback),
        },
        "scenarios": rows,
    }

    print("\\nOptimize Route Profiling Report")
    print(f"commit: {report['metadata']['commit']}")
    print(f"timestamp_utc: {report['metadata']['timestamp_utc']}")
    print(format_table(rows))

    if args.json_out:
        out_path = Path(args.json_out)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(f"\\nJSON report written to: {out_path}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
