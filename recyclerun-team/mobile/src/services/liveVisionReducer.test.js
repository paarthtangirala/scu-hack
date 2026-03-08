import { describe, expect, it } from "vitest";

import {
  createInitialLiveVisionState,
  LIVE_CONTROLLER_STATES,
  reduceLiveVisionState,
} from "./liveVisionReducer";

describe("liveVisionReducer", () => {
  it("moves from connecting to streaming with direct live", () => {
    let state = createInitialLiveVisionState();
    state = reduceLiveVisionState(state, {
      type: "connecting",
      transport: "direct_websocket",
      directAvailable: true,
      sourceSessionId: "lvs_123",
      message: "Connecting",
    });
    expect(state.status).toBe(LIVE_CONTROLLER_STATES.CONNECTING);
    expect(state.liveRunning).toBe(true);
    expect(state.transport).toBe("direct_websocket");

    state = reduceLiveVisionState(state, {
      type: "streaming",
      transport: "direct_websocket",
      source: "gemini_live",
      message: "Streaming",
    });
    expect(state.status).toBe(LIVE_CONTROLLER_STATES.STREAMING);
    expect(state.source).toBe("gemini_live");
    expect(state.starting).toBe(false);
  });

  it("queues and confirms candidates without dropping confirmed rows", () => {
    let state = createInitialLiveVisionState();
    state = reduceLiveVisionState(state, {
      type: "candidate_pending",
      pendingCandidate: { type: "cardboard", lbs: 2.5, count: 1, confidence: 0.9 },
      pendingQueue: [{ type: "glass_bottles", lbs: 1.1, count: 1, confidence: 0.8 }],
      latestDetections: [{ type: "cardboard", lbs: 2.5 }, { type: "glass_bottles", lbs: 1.1 }],
      message: "Review",
    });
    expect(state.status).toBe(LIVE_CONTROLLER_STATES.CANDIDATE_PENDING);
    expect(state.pendingQueue).toHaveLength(1);

    state = reduceLiveVisionState(state, {
      type: "confirm_candidate",
      row: { type: "cardboard", lbs: 2.5, count: 1, confidence: 0.9 },
      nextCandidate: { type: "glass_bottles", lbs: 1.1, count: 1, confidence: 0.8 },
      pendingQueue: [],
      latestDetections: [{ type: "glass_bottles", lbs: 1.1 }],
      message: "Next",
    });
    expect(state.confirmedRows).toHaveLength(1);
    expect(state.confirmedRows[0].type).toBe("cardboard");
    expect(state.pendingCandidate.type).toBe("glass_bottles");
  });

  it("records fallback mode explicitly", () => {
    const state = reduceLiveVisionState(createInitialLiveVisionState(), {
      type: "fallback",
      transport: "legacy_http_poll",
      source: "gemini_live_demo",
      reason: "direct_socket_error",
      message: "Fallback active",
    });

    expect(state.status).toBe(LIVE_CONTROLLER_STATES.DEGRADED_FALLBACK);
    expect(state.transport).toBe("legacy_http_poll");
    expect(state.fallbackReason).toBe("direct_socket_error");
  });
});
