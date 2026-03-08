import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { Platform } from "react-native";

import { LIVE_PREVIEW_FRAME_INTERVAL_MS } from "../config";
import { api } from "../services/api";
import {
  buildLiveDetectionSignature,
  buildSuggestedMaterialRow,
  normalizeLiveRows,
} from "../services/liveVisionParser";
import {
  createInitialLiveVisionState,
  LIVE_CONTROLLER_STATES,
  reduceLiveVisionState,
} from "../services/liveVisionReducer";
import { createLiveVisionTelemetryClient } from "../services/liveVisionTelemetry";
import { createLiveVisionTrackManager } from "../services/liveVisionTrackManager";
import { createDirectLiveTransport, createLegacyLiveTransport } from "../services/liveVisionTransport";

function sortRowsByPriority(rows) {
  return (Array.isArray(rows) ? rows : [])
    .slice()
    .sort((a, b) => Number(b?.lbs || 0) - Number(a?.lbs || 0));
}

function normalizePendingRow(row) {
  const next = buildSuggestedMaterialRow(row);
  if (!next) return null;
  return {
    ...next,
    source: "gemini_live",
    label: row?.label || row?.type || "",
  };
}

export function useLiveVisionController({
  cameraSurfaceRef,
  lockedTypes = [],
  profileId = "",
  onEditSuggestion = () => {},
}) {
  const [state, dispatch] = useReducer(reduceLiveVisionState, undefined, createInitialLiveVisionState);
  const transportRef = useRef(null);
  const telemetryRef = useRef(null);
  const frameLoopRef = useRef(null);
  const frameBusyRef = useRef(false);
  const classificationBusyRef = useRef(false);
  const activeRequestRef = useRef(null);
  const startedAtRef = useRef(0);
  const stableSignatureRef = useRef("");
  const stableSignatureCountRef = useRef(0);
  const lastPromptedSignatureRef = useRef("");
  const trackManagerRef = useRef(createLiveVisionTrackManager());
  const sessionPolicyRef = useRef({
    candidate_stable_frames: 2,
    candidate_stable_ms: 900,
    remote_send_cooldown_ms: LIVE_PREVIEW_FRAME_INTERVAL_MS,
    recheck_after_low_confidence_ms: 1500,
  });
  const fallbackModeRef = useRef("none");
  const skippedCountRef = useRef(0);
  const confirmedCountRef = useRef(0);
  const fallbackAttemptedRef = useRef(false);

  const clearFrameLoop = useCallback(() => {
    if (!frameLoopRef.current) return;
    clearInterval(frameLoopRef.current);
    frameLoopRef.current = null;
  }, []);

  const queueTelemetry = useCallback((eventType, payload = {}) => {
    telemetryRef.current?.event(eventType, payload);
  }, []);

  const flushTelemetry = useCallback(async () => {
    try {
      await telemetryRef.current?.flush();
    } catch {
      // Telemetry errors should never break scan flow.
    }
  }, []);

  const endTelemetry = useCallback(async (errorSummary = "") => {
    try {
      await telemetryRef.current?.end({
        sourceSessionId: state.sourceSessionId || state.tokenSessionId,
        durationMs: startedAtRef.current ? Date.now() - startedAtRef.current : 0,
        confirmedCount: confirmedCountRef.current,
        skippedCount: skippedCountRef.current,
        fallbackMode: fallbackModeRef.current,
        errorSummary,
      });
    } catch {
      // Telemetry errors should never break scan flow.
    } finally {
      telemetryRef.current = null;
    }
  }, [state.sourceSessionId, state.tokenSessionId]);

  const stop = useCallback(async (message = "Live preview stopped.") => {
    clearFrameLoop();
    frameBusyRef.current = false;
    classificationBusyRef.current = false;
    activeRequestRef.current = null;
    stableSignatureRef.current = "";
    stableSignatureCountRef.current = 0;
    lastPromptedSignatureRef.current = "";
    trackManagerRef.current.reset();
    const transport = transportRef.current;
    transportRef.current = null;
    if (transport?.close) {
      try {
        await transport.close();
      } catch {
        // Ignore close errors.
      }
    }
    await flushTelemetry();
    await endTelemetry();
    dispatch({ type: "closed", message });
  }, [clearFrameLoop, endTelemetry, flushTelemetry]);

  const setConfirmedRows = useCallback((rows) => {
    dispatch({ type: "set_confirmed_rows", rows });
  }, []);

  useEffect(() => {
    if (!Array.isArray(lockedTypes) || !lockedTypes.length) return;
    const filtered = (state.confirmedRows || []).filter((row) => !lockedTypes.includes(row.type));
    if (filtered.length !== (state.confirmedRows || []).length) {
      setConfirmedRows(filtered);
    }
  }, [lockedTypes, setConfirmedRows, state.confirmedRows]);

  const applyModelPayload = useCallback((payload) => {
    const normalizedRows = normalizeLiveRows(payload?.materials || [], { lockedTypes });
    dispatch({
      type: "streaming",
      source: payload?.source || state.source || "gemini_live",
      transport: state.transport,
      message:
        payload?.source === "gemini_live_demo"
          ? "Live AI fallback mode active. You can still add or edit materials manually."
          : payload?.from_cache
            ? "Live AI is reusing the last stable estimate."
            : "Live AI preview active.",
    });

    if (!normalizedRows.length) {
      stableSignatureRef.current = "";
      stableSignatureCountRef.current = 0;
      return;
    }

    const signature = buildLiveDetectionSignature(normalizedRows);
    if (!signature) return;

    if (signature === stableSignatureRef.current) {
      stableSignatureCountRef.current += 1;
    } else {
      stableSignatureRef.current = signature;
      stableSignatureCountRef.current = 1;
    }

    if (state.pendingCandidate || signature === lastPromptedSignatureRef.current) {
      return;
    }

    if (stableSignatureCountRef.current < Number(sessionPolicyRef.current.candidate_stable_frames || 2)) {
      return;
    }

    const queue = sortRowsByPriority(normalizedRows);
    const [primary, ...rest] = queue;
    const nextCandidate = normalizePendingRow(primary);
    if (!nextCandidate) return;

    lastPromptedSignatureRef.current = signature;
    queueTelemetry("candidate_stable", {
      candidate_id: nextCandidate.candidate_id || signature,
      details: {
        signature,
        count: nextCandidate.count,
        lbs: nextCandidate.lbs,
      },
    });
    dispatch({
      type: "candidate_pending",
      pendingCandidate: nextCandidate,
      pendingQueue: rest.map(normalizePendingRow).filter(Boolean),
      latestDetections: queue.map(normalizePendingRow).filter(Boolean),
      message: "Stable live suggestion ready for review.",
    });
  }, [lockedTypes, queueTelemetry, state.pendingCandidate, state.source, state.transport]);

  const handleClassificationResult = useCallback((payload, requestMeta = {}) => {
    const activeRequest = activeRequestRef.current;
    if (activeRequest && requestMeta?.generation && Number(activeRequest.generation) !== Number(requestMeta.generation)) {
      queueTelemetry("candidate_dropped_stale", {
        candidate_id: requestMeta.candidateId || activeRequest.candidateId,
        track_id: requestMeta.trackId || activeRequest.trackId,
      });
      return;
    }

    classificationBusyRef.current = false;
    activeRequestRef.current = null;
    if (requestMeta?.trackId) {
      trackManagerRef.current.markResolved(requestMeta.trackId, requestMeta.generation);
    }

    const rows = normalizeLiveRows(
      (payload?.materials || []).map((row) => ({
        ...row,
        candidate_id: requestMeta?.candidateId || row?.candidate_id || "",
        provenance: row?.provenance || "live_ai_native",
      })),
      { lockedTypes },
    );

    if (!rows.length) {
      if (requestMeta?.trackId) {
        trackManagerRef.current.suppressTrack(requestMeta.trackId, {
          durationMs: sessionPolicyRef.current.recheck_after_low_confidence_ms,
        });
      }
      dispatch({
        type: "candidate_suppressed",
        message: "No supported recyclable was confidently classified. Keep scanning or edit manually.",
      });
      return;
    }

    const queue = sortRowsByPriority(rows);
    const normalizedQueue = queue.map((row) =>
      normalizePendingRow({
        ...row,
        candidate_id: requestMeta?.candidateId || row?.candidate_id || "",
      }),
    ).filter(Boolean);
    const [primary, ...rest] = normalizedQueue;
    if (!primary) return;

    queueTelemetry("candidate_classified", {
      candidate_id: requestMeta?.candidateId || primary.candidate_id || "",
      track_id: requestMeta?.trackId || "",
      details: {
        rows: normalizedQueue.length,
        total_lbs: payload?.total_lbs || 0,
      },
    });

    dispatch({
      type: "candidate_pending",
      pendingCandidate: primary,
      pendingQueue: rest,
      latestDetections: normalizedQueue,
      highlightedTrackId: requestMeta?.trackId || "",
      message: "Stable live suggestion ready for review.",
    });
  }, [lockedTypes, queueTelemetry]);

  const classifyNativeCandidate = useCallback(async (candidate) => {
    if (!candidate || !transportRef.current || !cameraSurfaceRef?.current) return;
    classificationBusyRef.current = true;
    const snapshot = await cameraSurfaceRef.current.captureCandidateFrame({
      bboxNorm: candidate.bbox_norm,
    });
    const requestMeta = {
      candidateId: candidate.candidate_id,
      generation: candidate.generation,
      trackId: candidate.track_id,
    };
    activeRequestRef.current = requestMeta;
    queueTelemetry("candidate_ready", {
      candidate_id: candidate.candidate_id,
      track_id: candidate.track_id,
      details: { stable_ms: candidate.stable_ms, stable_frames: candidate.stable_frames },
    });
    queueTelemetry("candidate_sent", {
      candidate_id: candidate.candidate_id,
      track_id: candidate.track_id,
    });
    queueTelemetry("remote_inference_started", {
      candidate_id: candidate.candidate_id,
      track_id: candidate.track_id,
    });

    if (transportRef.current.mode === "legacy_http_poll") {
      const payload = await transportRef.current.sendFrame(
        snapshot.context_jpeg_base64 || snapshot.roi_jpeg_base64,
        snapshot.mime_type || "image/jpeg",
      );
      handleClassificationResult(payload, requestMeta);
      return;
    }

    await transportRef.current.pushCandidateVideo({
      ...snapshot,
      candidate_id: candidate.candidate_id,
      generation: candidate.generation,
      coarse_label: candidate.coarse_label,
    });
    await transportRef.current.requestCandidateClassification({
      ...snapshot,
      candidate_id: candidate.candidate_id,
      generation: candidate.generation,
      coarse_label: candidate.coarse_label,
    });
  }, [cameraSurfaceRef, handleClassificationResult, queueTelemetry]);

  const handleNativeTracks = useCallback(async (payload) => {
    const { tracks, candidate } = trackManagerRef.current.ingest(payload, {
      nowMs: payload?.timestamp_ms || Date.now(),
    });
    const highlightedTrackId =
      state.pendingCandidate?.candidate_id?.split(":")[0] ||
      activeRequestRef.current?.trackId ||
      "";
    dispatch({
      type: "native_tracks_updated",
      overlayTracks: tracks,
      highlightedTrackId,
    });

    if (!state.liveRunning || !cameraSurfaceRef?.current?.supportsNativeTracking?.()) {
      return;
    }
    if (!candidate || classificationBusyRef.current || state.pendingCandidate) {
      return;
    }

    try {
      await classifyNativeCandidate(candidate);
    } catch (error) {
      classificationBusyRef.current = false;
      activeRequestRef.current = null;
      trackManagerRef.current.suppressTrack(candidate.track_id, {
        durationMs: sessionPolicyRef.current.recheck_after_low_confidence_ms,
      });
      queueTelemetry("remote_inference_failed", {
        candidate_id: candidate.candidate_id,
        track_id: candidate.track_id,
        reason: "native_candidate_classification_failed",
        details: { message: String(error?.message || "") },
      });
      if (transportRef.current?.mode === "direct_websocket" && !fallbackAttemptedRef.current) {
        fallbackAttemptedRef.current = true;
        fallbackModeRef.current = "legacy_http_poll";
        dispatch({
          type: "tracking_only_entered",
          transport: "direct_websocket",
          source: state.source || "gemini_live",
          message: "Direct live classification failed. Tracking remains active while fallback connects.",
        });
      }
    }
  }, [cameraSurfaceRef, classifyNativeCandidate, queueTelemetry, state.liveRunning, state.pendingCandidate, state.source]);

  const captureAndSendLegacyFrame = useCallback(async () => {
    if (frameBusyRef.current || !cameraSurfaceRef?.current || !transportRef.current) return;
    if (state.status === LIVE_CONTROLLER_STATES.CANDIDATE_PENDING || state.status === LIVE_CONTROLLER_STATES.REVIEWING) {
      return;
    }
    frameBusyRef.current = true;
    try {
      const snapshot = await cameraSurfaceRef.current.captureLegacyFrame();
      if (!snapshot?.frame_base64) return;
      const payload = await transportRef.current.sendFrame(snapshot.frame_base64, snapshot.mime_type || "image/jpeg");
      if (transportRef.current.mode === "legacy_http_poll") {
        applyModelPayload(payload);
      }
    } catch (error) {
      dispatch({ type: "set_message", message: `Live preview frame failed: ${error?.message || "Unknown error"}` });
      queueTelemetry("remote_inference_failed", {
        reason: "frame_send_failed",
        details: { message: String(error?.message || "") },
      });
    } finally {
      frameBusyRef.current = false;
    }
  }, [applyModelPayload, cameraSurfaceRef, queueTelemetry, state.status]);

  const runFrameLoop = useCallback(() => {
    clearFrameLoop();
    const cadence = Math.max(
      500,
      Number(sessionPolicyRef.current.remote_send_cooldown_ms || LIVE_PREVIEW_FRAME_INTERVAL_MS),
    );
    frameLoopRef.current = setInterval(() => {
      void captureAndSendLegacyFrame();
    }, cadence);
  }, [captureAndSendLegacyFrame, clearFrameLoop]);

  const startLegacyFallback = useCallback(async (reason = "legacy_fallback") => {
    const transport = createLegacyLiveTransport({
      api,
      model: "",
    });
    const session = await transport.connect();
    transportRef.current = transport;
    fallbackModeRef.current = "legacy_http_poll";
    if (!telemetryRef.current && session?.session_id) {
      telemetryRef.current = createLiveVisionTelemetryClient({
        api,
        telemetrySessionId: session.session_id,
        platform: Platform.OS,
        deviceTier: cameraSurfaceRef?.current?.supportsNativeTracking?.() ? "native_tracker" : "legacy_camera",
        networkType: "unknown",
      });
    }
    dispatch({
      type: cameraSurfaceRef?.current?.supportsNativeTracking?.() ? "tracking_only_entered" : "connecting",
      transport: "legacy_http_poll",
      directAvailable: false,
      sourceSessionId: session?.session_id || state.sourceSessionId,
      tokenSessionId: state.tokenSessionId,
      source: session?.source_mode || "gemini_live_demo",
      message: cameraSurfaceRef?.current?.supportsNativeTracking?.()
        ? "Legacy classification fallback active. Native tracking remains enabled."
        : "Using legacy live scan fallback.",
    });
    queueTelemetry("legacy_fallback_entered", {
      reason,
      details: { transport: "legacy_http_poll" },
    });
    if (!cameraSurfaceRef?.current?.supportsNativeTracking?.()) {
      await captureAndSendLegacyFrame();
      runFrameLoop();
    }
  }, [cameraSurfaceRef, captureAndSendLegacyFrame, queueTelemetry, runFrameLoop, state.sourceSessionId, state.tokenSessionId]);

  const start = useCallback(async () => {
    if (state.starting || state.liveRunning) return;
    dispatch({ type: "permission_check" });
    const permission = await cameraSurfaceRef?.current?.ensurePermission?.();
    if (!permission?.granted) {
      dispatch({ type: "set_message", message: "Camera permission is required for Live AI Preview." });
      dispatch({ type: "closed", message: "Camera permission is required for Live AI Preview." });
      return;
    }
    if (!cameraSurfaceRef?.current?.isReady?.()) {
      dispatch({ type: "camera_warmup", message: "Camera is initializing. Wait a moment and try again." });
      dispatch({ type: "closed", message: "Camera is initializing. Wait a moment and try again." });
      return;
    }

    stableSignatureRef.current = "";
    stableSignatureCountRef.current = 0;
    lastPromptedSignatureRef.current = "";
    fallbackAttemptedRef.current = false;
    skippedCountRef.current = 0;
    confirmedCountRef.current = 0;
    startedAtRef.current = Date.now();
    trackManagerRef.current.reset();

    try {
      const tokenResponse = await api.getLiveVisionToken({
        profile_id: profileId,
        device_label: cameraSurfaceRef?.current?.supportsNativeTracking?.() ? "vision-camera-live-scan" : "legacy-live-scan",
        app_version: "1.0.0",
        platform: Platform.OS,
        device_tier: cameraSurfaceRef?.current?.supportsNativeTracking?.() ? "native_tracker" : "legacy_camera",
        network_type: "unknown",
      });
      if (!tokenResponse.ok || !tokenResponse.data) {
        throw new Error(tokenResponse.error || tokenResponse.hint || "Direct Live token failed");
      }

      sessionPolicyRef.current = {
        ...sessionPolicyRef.current,
        ...(tokenResponse.data.session_policy || {}),
      };
      telemetryRef.current = createLiveVisionTelemetryClient({
        api,
        telemetrySessionId: tokenResponse.data.telemetry_session_id || tokenResponse.data.source_session_id,
        platform: Platform.OS,
        deviceTier: cameraSurfaceRef?.current?.supportsNativeTracking?.() ? "native_tracker" : "legacy_camera",
        networkType: "unknown",
      });
      queueTelemetry("session_started", {
        details: {
          transport: tokenResponse.data.direct_available ? "direct_websocket" : "legacy_http_poll",
          model: tokenResponse.data.model,
        },
      });
      queueTelemetry("native_pipeline_started", {
        details: {
          native_tracking: Boolean(cameraSurfaceRef?.current?.supportsNativeTracking?.()),
        },
      });

      if (!tokenResponse.data.direct_available || !tokenResponse.data.token) {
        await startLegacyFallback(tokenResponse.data.fallback_reason || "direct_unavailable");
        return;
      }

      const transport = createDirectLiveTransport({
        token: tokenResponse.data.token,
        wsEndpoint: tokenResponse.data.ws_endpoint,
        setup: tokenResponse.data.setup,
        frameTurnPrompt: tokenResponse.data.frame_turn_prompt,
        supportsSessionResumption: Boolean(tokenResponse.data.supports_session_resumption),
        candidateVideoPolicy: tokenResponse.data.candidate_video_policy || {},
        onState: async ({ type, payload }) => {
          if (type === "socket_open") {
            dispatch({ type: "socket_opened", message: "Direct live socket connected." });
            queueTelemetry("socket_opened");
          } else if (type === "setup_complete") {
            queueTelemetry("socket_setup_completed");
          } else if (type === "socket_reconnecting") {
            dispatch({ type: "socket_reconnecting", message: "Reconnecting live AI stream..." });
            queueTelemetry("socket_reconnecting");
          } else if (type === "socket_resumed") {
            dispatch({ type: "socket_resumed", message: "Live AI stream resumed." });
            queueTelemetry("socket_resumed");
          } else if (type === "go_away") {
            dispatch({ type: "socket_reconnecting", message: "Live AI session rotating. Reconnecting..." });
            queueTelemetry("socket_reconnecting", { details: payload || {} });
          } else if (type === "socket_closed") {
            queueTelemetry("socket_closed");
            if (cameraSurfaceRef?.current?.supportsNativeTracking?.()) {
              dispatch({
                type: "tracking_only_entered",
                transport: "direct_websocket",
                source: "gemini_live",
                message: "Socket closed. Native tracking remains active while reconnect or fallback proceeds.",
              });
            }
          }
        },
        onResult: (payload) => {
          queueTelemetry("remote_inference_completed", {
            candidate_id: payload?.candidate_id || activeRequestRef.current?.candidateId || "",
          });
          handleClassificationResult(payload, {
            candidateId: payload?.candidate_id || activeRequestRef.current?.candidateId || "",
            generation: payload?.generation || activeRequestRef.current?.generation,
            trackId: payload?.track_id || activeRequestRef.current?.trackId || "",
          });
        },
        onError: async (error) => {
          queueTelemetry("remote_inference_failed", {
            candidate_id: activeRequestRef.current?.candidateId || "",
            track_id: activeRequestRef.current?.trackId || "",
            reason: "direct_socket_error",
            details: { message: String(error?.message || "") },
          });
          classificationBusyRef.current = false;
          if (!fallbackAttemptedRef.current) {
            fallbackAttemptedRef.current = true;
            await startLegacyFallback("direct_socket_error");
          } else {
            dispatch({
              type: "tracking_only_entered",
              transport: "direct_websocket",
              source: "gemini_live",
              message: "Direct live classification unavailable. Native tracking remains available.",
            });
          }
        },
      });
      transportRef.current = transport;
      dispatch({
        type: "connecting",
        transport: "direct_websocket",
        directAvailable: true,
        sourceSessionId: tokenResponse.data.source_session_id,
        tokenSessionId: tokenResponse.data.telemetry_session_id,
        message: cameraSurfaceRef?.current?.supportsNativeTracking?.()
          ? "Connecting native live tracker to Gemini Live..."
          : "Connecting to Live AI...",
      });
      await transport.connect();
      dispatch({
        type: "streaming",
        transport: "direct_websocket",
        source: "gemini_live",
        message: cameraSurfaceRef?.current?.supportsNativeTracking?.()
          ? "Native live tracker active. Hold steady on one recyclable item."
          : "Live AI preview active.",
      });

      if (!cameraSurfaceRef?.current?.supportsNativeTracking?.()) {
        await captureAndSendLegacyFrame();
        runFrameLoop();
      }
    } catch (error) {
      await startLegacyFallback(String(error?.message || "direct_start_failed"));
    }
  }, [
    cameraSurfaceRef,
    captureAndSendLegacyFrame,
    handleClassificationResult,
    profileId,
    queueTelemetry,
    runFrameLoop,
    startLegacyFallback,
    state.liveRunning,
    state.starting,
  ]);

  const promoteNextCandidate = useCallback((message) => {
    const queue = Array.isArray(state.pendingQueue) ? state.pendingQueue : [];
    if (!queue.length) {
      dispatch({
        type: "skip_candidate",
        nextCandidate: null,
        pendingQueue: [],
        latestDetections: [],
        highlightedTrackId: "",
        message,
      });
      return;
    }
    const [nextCandidate, ...rest] = queue;
    dispatch({
      type: "skip_candidate",
      nextCandidate,
      pendingQueue: rest,
      latestDetections: [nextCandidate, ...rest],
      highlightedTrackId: "",
      message,
    });
    dispatch({ type: "reviewing", message });
  }, [state.pendingQueue]);

  const confirmPendingCandidate = useCallback(() => {
    if (!state.pendingCandidate) return;
    confirmedCountRef.current += 1;
    queueTelemetry("candidate_confirmed", {
      candidate_id: state.pendingCandidate.candidate_id || buildLiveDetectionSignature([state.pendingCandidate]),
      details: { type: state.pendingCandidate.type, lbs: state.pendingCandidate.lbs },
    });
    const trackId = String(state.pendingCandidate.candidate_id || "").split(":")[0];
    if (trackId) {
      trackManagerRef.current.suppressTrack(trackId);
    }
    dispatch({ type: "candidate_suppressed", message: "Candidate committed to listing." });
    const queue = Array.isArray(state.pendingQueue) ? state.pendingQueue : [];
    const [nextCandidate, ...rest] = queue;
    dispatch({
      type: "confirm_candidate",
      row: state.pendingCandidate,
      nextCandidate: nextCandidate || null,
      pendingQueue: rest,
      latestDetections: [nextCandidate, ...rest].filter(Boolean),
      highlightedTrackId: "",
      message: nextCandidate ? "Item added. Reviewing next suggestion." : "Item added. Continue scanning.",
    });
    if (nextCandidate) {
      dispatch({ type: "reviewing", message: "Review the next suggestion." });
    }
  }, [queueTelemetry, state.pendingCandidate, state.pendingQueue]);

  const editPendingCandidate = useCallback(() => {
    if (!state.pendingCandidate) return;
    confirmedCountRef.current += 1;
    onEditSuggestion(state.pendingCandidate);
    queueTelemetry("candidate_confirmed", {
      candidate_id: state.pendingCandidate.candidate_id || buildLiveDetectionSignature([state.pendingCandidate]),
      details: { mode: "edit", type: state.pendingCandidate.type, lbs: state.pendingCandidate.lbs },
    });
    const trackId = String(state.pendingCandidate.candidate_id || "").split(":")[0];
    if (trackId) {
      trackManagerRef.current.suppressTrack(trackId);
    }
    dispatch({ type: "candidate_suppressed", message: "Suggestion moved to editable materials." });
    promoteNextCandidate("Suggestion moved to editable materials.");
  }, [onEditSuggestion, promoteNextCandidate, queueTelemetry, state.pendingCandidate]);

  const skipPendingCandidate = useCallback(() => {
    if (!state.pendingCandidate) return;
    skippedCountRef.current += 1;
    queueTelemetry("candidate_skipped", {
      candidate_id: state.pendingCandidate.candidate_id || buildLiveDetectionSignature([state.pendingCandidate]),
      details: { type: state.pendingCandidate.type, lbs: state.pendingCandidate.lbs },
    });
    const trackId = String(state.pendingCandidate.candidate_id || "").split(":")[0];
    if (trackId) {
      trackManagerRef.current.suppressTrack(trackId, {
        durationMs: sessionPolicyRef.current.recheck_after_low_confidence_ms,
      });
    }
    dispatch({ type: "candidate_suppressed", message: "Suggestion skipped. Continue scanning." });
    promoteNextCandidate("Suggestion skipped. Continue scanning.");
  }, [promoteNextCandidate, queueTelemetry, state.pendingCandidate]);

  const reset = useCallback(() => {
    clearFrameLoop();
    stableSignatureRef.current = "";
    stableSignatureCountRef.current = 0;
    lastPromptedSignatureRef.current = "";
    skippedCountRef.current = 0;
    confirmedCountRef.current = 0;
    fallbackModeRef.current = "none";
    activeRequestRef.current = null;
    trackManagerRef.current.reset();
    dispatch({ type: "reset" });
  }, [clearFrameLoop]);

  useEffect(() => () => {
    void stop("Live preview stopped.");
  }, [stop]);

  const activelyScanning = useMemo(
    () =>
      state.liveRunning &&
      state.status !== LIVE_CONTROLLER_STATES.CANDIDATE_PENDING &&
      state.status !== LIVE_CONTROLLER_STATES.REVIEWING,
    [state.liveRunning, state.status],
  );

  return {
    controllerState: state.status,
    liveRunning: state.liveRunning,
    startingLive: state.starting,
    aiSource: state.source,
    aiMaterials: state.confirmedRows,
    sourceSessionId: state.sourceSessionId || state.tokenSessionId,
    message: state.message,
    pendingDetection: state.pendingCandidate,
    pendingDetectionQueue: state.pendingQueue,
    latestFrameDetections: state.latestDetections,
    overlayTracks: state.overlayTracks,
    highlightedTrackId: state.highlightedTrackId,
    activelyScanning,
    directAvailable: state.directAvailable,
    handleNativeTracks,
    start,
    stop,
    confirmPendingCandidate,
    editPendingCandidate,
    skipPendingCandidate,
    reset,
  };
}
