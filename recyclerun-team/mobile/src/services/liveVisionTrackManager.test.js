import { describe, expect, it } from "vitest";

import {
  createLiveVisionTrackManager,
  normalizeNativeTracks,
  sortTracksForQueue,
} from "./liveVisionTrackManager";

describe("liveVisionTrackManager", () => {
  it("normalizes and sorts stable tracks by stability then area", () => {
    const tracks = normalizeNativeTracks({
      timestamp_ms: 1000,
      detections: [
        {
          track_id: "track_small",
          bbox_norm: { x: 0.2, y: 0.2, width: 0.12, height: 0.12 },
          stable_frames: 4,
          stable_ms: 1600,
          area_score: 0.1,
          local_confidence: 0.7,
          is_stable: true,
        },
        {
          track_id: "track_big",
          bbox_norm: { x: 0.1, y: 0.1, width: 0.3, height: 0.3 },
          stable_frames: 4,
          stable_ms: 1600,
          area_score: 0.4,
          local_confidence: 0.6,
          is_stable: true,
        },
      ],
    });

    const sorted = sortTracksForQueue(tracks);
    expect(sorted[0].track_id).toBe("track_big");
    expect(sorted[1].track_id).toBe("track_small");
  });

  it("emits one candidate for the highest-priority stable track and suppresses skipped tracks", () => {
    const manager = createLiveVisionTrackManager({ suppressionMs: 2000 });
    const firstBatch = manager.ingest({
      timestamp_ms: 2000,
      detections: [
        {
          track_id: "track_1",
          bbox_norm: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
          stable_frames: 3,
          stable_ms: 1400,
          area_score: 0.18,
          local_confidence: 0.8,
          is_stable: true,
        },
        {
          track_id: "track_2",
          bbox_norm: { x: 0.4, y: 0.2, width: 0.15, height: 0.15 },
          stable_frames: 2,
          stable_ms: 900,
          area_score: 0.1,
          local_confidence: 0.9,
          is_stable: true,
        },
      ],
    });

    expect(firstBatch.candidate.track_id).toBe("track_1");
    manager.suppressTrack("track_1", { nowMs: 2000, durationMs: 2500 });
    manager.markResolved("track_1", firstBatch.candidate.generation);

    const secondBatch = manager.ingest({
      timestamp_ms: 2400,
      detections: [
        {
          track_id: "track_1",
          bbox_norm: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
          stable_frames: 4,
          stable_ms: 1800,
          area_score: 0.18,
          local_confidence: 0.82,
          is_stable: true,
        },
        {
          track_id: "track_2",
          bbox_norm: { x: 0.4, y: 0.2, width: 0.15, height: 0.15 },
          stable_frames: 3,
          stable_ms: 1200,
          area_score: 0.1,
          local_confidence: 0.9,
          is_stable: true,
        },
      ],
    });

    expect(secondBatch.candidate.track_id).toBe("track_2");
  });
});
