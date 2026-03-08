function makeEventId(prefix = "evt") {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createLiveVisionTelemetryClient({
  api,
  telemetrySessionId,
  platform = "",
  deviceTier = "",
  networkType = "",
}) {
  let queue = [];
  let summary = {};

  function event(type, payload = {}) {
    queue.push({
      event_id: payload.event_id || makeEventId(type),
      event_type: type,
      ts_ms: payload.ts_ms || Date.now(),
      latency_ms: payload.latency_ms,
      candidate_id: payload.candidate_id || "",
      track_id: payload.track_id || "",
      reason: payload.reason || "",
      details: payload.details || {},
      platform: payload.platform || platform,
      device_tier: payload.device_tier || deviceTier,
      network_type: payload.network_type || networkType,
      device_model: payload.device_model || "",
      os_version: payload.os_version || "",
      transport_mode: payload.transport_mode || "",
      preview_fps_p50: payload.preview_fps_p50,
      preview_fps_p95: payload.preview_fps_p95,
      detector_ms_p50: payload.detector_ms_p50,
      detector_ms_p95: payload.detector_ms_p95,
      stable_candidate_ms_p50: payload.stable_candidate_ms_p50,
      stable_candidate_ms_p95: payload.stable_candidate_ms_p95,
      gemini_rtt_ms_p50: payload.gemini_rtt_ms_p50,
      gemini_rtt_ms_p95: payload.gemini_rtt_ms_p95,
      resume_count: payload.resume_count,
      fallback_reason: payload.fallback_reason || "",
    });
  }

  function setSummary(nextSummary = {}) {
    summary = {
      ...summary,
      ...(nextSummary || {}),
    };
  }

  async function flush() {
    if (!telemetrySessionId || !queue.length || !api?.sendLiveVisionTelemetryBatch) return { ok: false };
    const events = queue.slice();
    queue = [];
    return api.sendLiveVisionTelemetryBatch({
      telemetry_session_id: telemetrySessionId,
      events,
      summary,
    });
  }

  async function end(payload = {}) {
    await flush();
    if (!telemetrySessionId || !api?.endLiveVisionSession) return { ok: false };
    return api.endLiveVisionSession({
      telemetry_session_id: telemetrySessionId,
      source_session_id: payload.sourceSessionId || telemetrySessionId,
      duration_ms: payload.durationMs || 0,
      confirmed_count: payload.confirmedCount || 0,
      skipped_count: payload.skippedCount || 0,
      fallback_mode: payload.fallbackMode || "none",
      error_summary: payload.errorSummary || "",
      transport_mode: payload.transportMode || summary.transport_mode || "",
      metrics: payload.metrics || summary.metrics || {},
    });
  }

  return {
    event,
    flush,
    end,
    setSummary,
  };
}
