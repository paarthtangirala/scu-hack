export const LIVE_CONTROLLER_STATES = {
  IDLE: "idle",
  PERMISSION_CHECK: "permission_check",
  CAMERA_WARMUP: "camera_warmup",
  CONNECTING: "connecting",
  STREAMING: "streaming",
  TRACKING_ONLY: "tracking_only",
  CANDIDATE_PENDING: "candidate_pending",
  REVIEWING: "reviewing",
  RECONNECTING: "reconnecting",
  DEGRADED_FALLBACK: "degraded_fallback",
  CLOSED: "closed",
};

export function createInitialLiveVisionState() {
  return {
    status: LIVE_CONTROLLER_STATES.IDLE,
    transport: "idle",
    liveRunning: false,
    starting: false,
    source: "",
    sourceSessionId: "",
    tokenSessionId: "",
    directAvailable: false,
    pendingCandidate: null,
    pendingQueue: [],
    latestDetections: [],
    overlayTracks: [],
    highlightedTrackId: "",
    confirmedRows: [],
    message: "",
    fallbackReason: "",
  };
}

function upsertConfirmedRows(existingRows, nextRow) {
  if (!nextRow?.type) return existingRows;
  const current = Array.isArray(existingRows) ? existingRows : [];
  const index = current.findIndex((row) => row.type === nextRow.type);
  if (index === -1) return [...current, nextRow];
  const updated = current.slice();
  const prior = updated[index];
  updated[index] = {
    ...prior,
    lbs: Math.round((Number(prior.lbs || 0) + Number(nextRow.lbs || 0)) * 10) / 10,
    count: Math.max(1, Number(prior.count || 1)) + Math.max(1, Number(nextRow.count || 1)),
    confidence: Math.max(Number(prior.confidence || 0), Number(nextRow.confidence || 0)),
    weight_confidence: Math.max(
      Number(prior.weight_confidence || 0),
      Number(nextRow.weight_confidence || 0),
    ),
    weight_low: Math.round(Math.min(
      Number(prior.weight_low || prior.lbs || 0),
      Number(nextRow.weight_low || nextRow.lbs || 0),
    ) * 10) / 10,
    weight_high: Math.round(Math.max(
      Number(prior.weight_high || prior.lbs || 0),
      Number(nextRow.weight_high || nextRow.lbs || 0),
    ) * 10) / 10,
  };
  return updated;
}

export function reduceLiveVisionState(state, action) {
  switch (action.type) {
    case "permission_check":
      return { ...state, status: LIVE_CONTROLLER_STATES.PERMISSION_CHECK, starting: true, message: "" };
    case "camera_warmup":
      return { ...state, status: LIVE_CONTROLLER_STATES.CAMERA_WARMUP, starting: true, message: action.message || "" };
    case "connecting":
      return {
        ...state,
        status: LIVE_CONTROLLER_STATES.CONNECTING,
        starting: true,
        liveRunning: true,
        transport: action.transport || state.transport,
        directAvailable: Boolean(action.directAvailable),
        sourceSessionId: action.sourceSessionId || state.sourceSessionId,
        tokenSessionId: action.tokenSessionId || state.tokenSessionId,
        message: action.message || "",
      };
    case "streaming":
      return {
        ...state,
        status: LIVE_CONTROLLER_STATES.STREAMING,
        starting: false,
        liveRunning: true,
        source: action.source || state.source,
        transport: action.transport || state.transport,
        message: action.message || state.message,
      };
    case "native_tracks_updated":
      return {
        ...state,
        overlayTracks: Array.isArray(action.overlayTracks) ? action.overlayTracks : [],
        highlightedTrackId: action.highlightedTrackId || state.highlightedTrackId,
      };
    case "fallback":
      return {
        ...state,
        status: LIVE_CONTROLLER_STATES.DEGRADED_FALLBACK,
        transport: action.transport || state.transport,
        source: action.source || state.source,
        fallbackReason: action.reason || "",
        message: action.message || state.message,
      };
    case "candidate_pending":
      return {
        ...state,
        status: LIVE_CONTROLLER_STATES.CANDIDATE_PENDING,
        pendingCandidate: action.pendingCandidate || null,
        pendingQueue: Array.isArray(action.pendingQueue) ? action.pendingQueue : [],
        latestDetections: Array.isArray(action.latestDetections) ? action.latestDetections : [],
        highlightedTrackId: action.highlightedTrackId || state.highlightedTrackId,
        message: action.message || state.message,
      };
    case "candidate_suppressed":
      return {
        ...state,
        highlightedTrackId: "",
        message: action.message || state.message,
      };
    case "socket_opened":
      return { ...state, message: action.message || state.message };
    case "socket_reconnecting":
      return {
        ...state,
        status: LIVE_CONTROLLER_STATES.RECONNECTING,
        message: action.message || state.message,
      };
    case "socket_resumed":
      return {
        ...state,
        status: LIVE_CONTROLLER_STATES.STREAMING,
        message: action.message || state.message,
      };
    case "tracking_only_entered":
      return {
        ...state,
        status: LIVE_CONTROLLER_STATES.TRACKING_ONLY,
        transport: action.transport || state.transport,
        source: action.source || state.source,
        message: action.message || state.message,
      };
    case "reviewing":
      return { ...state, status: LIVE_CONTROLLER_STATES.REVIEWING, message: action.message || state.message };
    case "confirm_candidate":
      return {
        ...state,
        status: LIVE_CONTROLLER_STATES.STREAMING,
        confirmedRows: upsertConfirmedRows(state.confirmedRows, action.row),
        pendingCandidate: action.nextCandidate || null,
        pendingQueue: Array.isArray(action.pendingQueue) ? action.pendingQueue : [],
        latestDetections: Array.isArray(action.latestDetections) ? action.latestDetections : state.latestDetections,
        highlightedTrackId: action.highlightedTrackId || "",
        message: action.message || state.message,
      };
    case "skip_candidate":
      return {
        ...state,
        status: action.nextCandidate ? LIVE_CONTROLLER_STATES.REVIEWING : LIVE_CONTROLLER_STATES.STREAMING,
        pendingCandidate: action.nextCandidate || null,
        pendingQueue: Array.isArray(action.pendingQueue) ? action.pendingQueue : [],
        latestDetections: Array.isArray(action.latestDetections) ? action.latestDetections : state.latestDetections,
        highlightedTrackId: action.highlightedTrackId || "",
        message: action.message || state.message,
      };
    case "set_confirmed_rows":
      return { ...state, confirmedRows: Array.isArray(action.rows) ? action.rows : [] };
    case "set_message":
      return { ...state, message: action.message || "" };
    case "reset":
      return {
        ...createInitialLiveVisionState(),
        confirmedRows: [],
      };
    case "closed":
      return {
        ...state,
        status: LIVE_CONTROLLER_STATES.CLOSED,
        starting: false,
        liveRunning: false,
        pendingCandidate: null,
        pendingQueue: [],
        latestDetections: [],
        overlayTracks: [],
        highlightedTrackId: "",
        message: action.message || state.message,
      };
    default:
      return state;
  }
}
