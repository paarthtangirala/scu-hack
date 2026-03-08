function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, toNumber(value, 0)));
}

function normalizeBBox(raw) {
  const bbox = raw && typeof raw === "object" ? raw : {};
  return {
    x: clamp01(bbox.x),
    y: clamp01(bbox.y),
    width: clamp01(bbox.width),
    height: clamp01(bbox.height),
  };
}

function trackSignature(track) {
  const bbox = normalizeBBox(track?.bbox_norm);
  return [
    String(track?.track_id || "").trim(),
    String(track?.coarse_label || "").trim().toLowerCase(),
    bbox.x.toFixed(3),
    bbox.y.toFixed(3),
    bbox.width.toFixed(3),
    bbox.height.toFixed(3),
  ].join("|");
}

export function normalizeNativeTracks(payload) {
  const rows = Array.isArray(payload?.detections) ? payload.detections : [];
  return rows
    .map((row) => {
      const trackId = String(row?.track_id || "").trim();
      if (!trackId) return null;
      const bbox = normalizeBBox(row?.bbox_norm);
      return {
        track_id: trackId,
        bbox_norm: bbox,
        first_seen_ms: Math.max(0, toNumber(row?.first_seen_ms, 0)),
        last_seen_ms: Math.max(0, toNumber(row?.last_seen_ms, payload?.timestamp_ms || Date.now())),
        stable_frames: Math.max(0, Math.round(toNumber(row?.stable_frames, 0))),
        stable_ms: Math.max(0, toNumber(row?.stable_ms, 0)),
        motion_score: clamp01(row?.motion_score),
        area_score: clamp01(row?.area_score || bbox.width * bbox.height),
        local_confidence: clamp01(row?.local_confidence),
        coarse_label: String(row?.coarse_label || "").trim().toLowerCase(),
        is_stable: Boolean(row?.is_stable),
      };
    })
    .filter(Boolean);
}

export function sortTracksForQueue(tracks) {
  return (Array.isArray(tracks) ? tracks : [])
    .slice()
    .sort((a, b) => {
      const stableDelta = toNumber(b?.stable_ms, 0) - toNumber(a?.stable_ms, 0);
      if (stableDelta !== 0) return stableDelta;
      const areaDelta = toNumber(b?.area_score, 0) - toNumber(a?.area_score, 0);
      if (areaDelta !== 0) return areaDelta;
      return toNumber(b?.local_confidence, 0) - toNumber(a?.local_confidence, 0);
    });
}

export function createLiveVisionTrackManager({
  suppressionMs = 3000,
  maxTracks = 5,
} = {}) {
  const suppressed = new Map();
  const inflight = new Map();

  function cleanup(nowMs) {
    for (const [trackId, untilMs] of suppressed.entries()) {
      if (toNumber(untilMs, 0) <= nowMs) {
        suppressed.delete(trackId);
      }
    }
  }

  function ingest(payload, options = {}) {
    const nowMs = Math.max(0, toNumber(options.nowMs, payload?.timestamp_ms || Date.now()));
    cleanup(nowMs);
    const tracks = sortTracksForQueue(normalizeNativeTracks(payload)).slice(0, maxTracks);

    const candidate = tracks.find((track) => {
      if (!track.is_stable) return false;
      if (suppressed.has(track.track_id)) return false;
      const signature = trackSignature(track);
      const current = inflight.get(track.track_id);
      return current?.signature !== signature;
    });

    if (!candidate) {
      return { tracks, candidate: null };
    }

    const signature = trackSignature(candidate);
    const nextGeneration = Math.max(1, Number(inflight.get(candidate.track_id)?.generation || 0) + 1);
    inflight.set(candidate.track_id, {
      generation: nextGeneration,
      signature,
      requested_at_ms: nowMs,
    });

    return {
      tracks,
      candidate: {
        candidate_id: `${candidate.track_id}:${nextGeneration}`,
        generation: nextGeneration,
        ...candidate,
      },
    };
  }

  function markResolved(trackId, generation) {
    const trackKey = String(trackId || "").trim();
    const current = inflight.get(trackKey);
    if (!current) return;
    if (generation != null && Number(current.generation) !== Number(generation)) return;
    inflight.delete(trackKey);
  }

  function suppressTrack(trackId, { nowMs = Date.now(), durationMs = suppressionMs } = {}) {
    const trackKey = String(trackId || "").trim();
    if (!trackKey) return;
    inflight.delete(trackKey);
    suppressed.set(trackKey, Math.max(nowMs, 0) + Math.max(250, toNumber(durationMs, suppressionMs)));
  }

  function reset() {
    inflight.clear();
    suppressed.clear();
  }

  return {
    ingest,
    markResolved,
    suppressTrack,
    reset,
  };
}
