"""Tests for optimize-route profiling harness output shape and scenario matrix."""
from __future__ import annotations

from backend.app import create_app
from backend.tools import profile_optimize_route as profiler


def test_summarize_latency_ns_returns_expected_metrics_shape():
    samples_ns = [1_000_000, 2_000_000, 3_000_000, 5_000_000, 8_000_000]
    summary = profiler.summarize_latency_ns(samples_ns)

    expected = {"sample_count", "mean_ms", "p50_ms", "p95_ms", "p99_ms", "max_ms", "stddev_ms"}
    assert set(summary.keys()) == expected
    assert summary["sample_count"] == len(samples_ns)
    assert summary["p50_ms"] <= summary["p95_ms"] <= summary["p99_ms"] <= summary["max_ms"]


def test_build_scenarios_includes_baseline_and_solver_variants():
    scenarios = profiler.build_scenarios(stress_multipliers=[5, 10], objectives=["value", "lbs"], force_fallback_only=False)

    multipliers = {s.dataset_multiplier for s in scenarios}
    objectives = {s.objective for s in scenarios}
    modes = {s.solver_mode for s in scenarios}

    assert multipliers == {1, 5, 10}
    assert objectives == {"value", "lbs"}
    assert modes == {"normal", "forced_fallback"}


def test_profile_scenario_returns_machine_readable_row_structure():
    app = create_app()
    client = app.test_client()
    scenario = profiler.Scenario(dataset_multiplier=1, objective="value", solver_mode="forced_fallback")

    row = profiler.profile_scenario(client, scenario, runs=2, warmup=1, seed=1234)

    assert row["scenario_name"] == "m1_value_forced_fallback"
    assert row["dataset_multiplier"] == 1
    assert row["dataset_size"] > 0
    assert row["objective"] == "value"
    assert row["solver_mode"] == "forced_fallback"
    assert isinstance(row["observed_solvers"], list)
    assert len(row["observed_solvers"]) >= 1

    metrics = row["metrics"]
    assert metrics["sample_count"] == 2
    assert metrics["p50_ms"] >= 0
    assert metrics["p95_ms"] >= 0
    assert metrics["max_ms"] >= metrics["p95_ms"]
