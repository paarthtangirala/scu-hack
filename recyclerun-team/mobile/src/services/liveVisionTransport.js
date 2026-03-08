import { parseLiveModelText } from "./liveVisionParser";

const DIRECT_SOCKET_OPEN_TIMEOUT_MS = 8000;
const DIRECT_RECONNECT_BASE_MS = 600;
const DIRECT_RECONNECT_MAX_MS = 3200;

function extractServerText(message) {
  const serverContent = message?.serverContent;
  if (!serverContent || typeof serverContent !== "object") return "";
  const parts =
    serverContent?.modelTurn?.parts ||
    serverContent?.turn?.parts ||
    serverContent?.parts ||
    [];
  return (Array.isArray(parts) ? parts : [])
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join("");
}

function buildCandidatePrompt(candidate, fallbackPrompt = "") {
  const coarseLabel = String(candidate?.coarse_label || "").trim();
  const context = coarseLabel ? `Local tracker hint: ${coarseLabel}.` : "";
  return (
    `${fallbackPrompt || "Analyze the latest Bin2Bucks live candidate stream."} `
    + `${context} Return strict JSON only with this shape: `
    + '{"materials":[{"type":"supported_material_key","lbs":0.0,"count":1,"confidence":0.0,"weight_confidence":0.0,"weight_low":0.0,"weight_high":0.0,"provenance":"live_ai_native","candidate_id":"string"}],"notes":"optional"} '
    + "If nothing confidently matches the supported taxonomy, return "
    + '{"materials":[],"notes":"no supported recyclables confidently visible"}.'
  );
}

export function createDirectLiveTransport({
  token,
  wsEndpoint,
  setup,
  frameTurnPrompt,
  supportsSessionResumption = true,
  candidateVideoPolicy = {},
  onState = () => {},
  onResult = () => {},
  onError = () => {},
}) {
  let socket = null;
  let openPromise = null;
  let setupTimer = null;
  let reconnectTimer = null;
  let isReady = false;
  let isClosed = false;
  let isReconnecting = false;
  let reconnectAttempts = 0;
  let bufferedText = "";
  let resumeHandle = "";
  let currentRequest = null;

  function cleanupTimer() {
    if (!setupTimer) return;
    clearTimeout(setupTimer);
    setupTimer = null;
  }

  function clearReconnectTimer() {
    if (!reconnectTimer) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  function closeSocket(code = 1000, reason = "client_close") {
    cleanupTimer();
    try {
      socket?.close(code, reason);
    } catch {
      // Ignore close errors.
    }
    socket = null;
    openPromise = null;
    isReady = false;
  }

  function scheduleReconnect(reason = "socket_reconnect") {
    if (isClosed || isReconnecting || !supportsSessionResumption) return;
    isReconnecting = true;
    onState({ type: "socket_reconnecting", reason });
    clearReconnectTimer();
    const delay = Math.min(
      DIRECT_RECONNECT_MAX_MS,
      DIRECT_RECONNECT_BASE_MS * Math.max(1, reconnectAttempts + 1),
    );
    reconnectTimer = setTimeout(() => {
      reconnectAttempts += 1;
      isReconnecting = false;
      void connect(true).catch((error) => {
        onError(error);
      });
    }, delay);
  }

  function currentSetupPayload() {
    if (!supportsSessionResumption || !resumeHandle) {
      return setup;
    }
    return {
      ...setup,
      sessionResumption: {
        ...(setup?.sessionResumption || {}),
        handle: resumeHandle,
      },
    };
  }

  function connect(isResume = false) {
    if (openPromise) return openPromise;
    openPromise = new Promise((resolve, reject) => {
      try {
        socket = new WebSocket(`${wsEndpoint}?access_token=${encodeURIComponent(token)}`);
      } catch (error) {
        openPromise = null;
        reject(error);
        return;
      }

      setupTimer = setTimeout(() => {
        if (isReady || isClosed) return;
        closeSocket(1000, "setup_timeout");
        reject(new Error("Timed out while opening Gemini Live socket"));
      }, DIRECT_SOCKET_OPEN_TIMEOUT_MS);

      socket.onopen = () => {
        onState({ type: "socket_open" });
        socket.send(JSON.stringify({ setup: currentSetupPayload() }));
      };

      socket.onerror = (event) => {
        const message = event?.message || "Gemini Live socket error";
        onError(new Error(message));
      };

      socket.onclose = () => {
        cleanupTimer();
        const wasReady = isReady;
        isReady = false;
        openPromise = null;
        onState({ type: "socket_closed", wasReady });
        if (!isClosed && wasReady && supportsSessionResumption) {
          scheduleReconnect("socket_closed");
        }
      };

      socket.onmessage = (event) => {
        let payload;
        try {
          payload = JSON.parse(String(event?.data || "{}"));
        } catch {
          return;
        }

        const nextHandle =
          payload?.sessionResumptionUpdate?.newHandle ||
          payload?.sessionResumptionUpdate?.resumeHandle ||
          "";
        if (nextHandle) {
          resumeHandle = String(nextHandle);
        }

        if (payload?.setupComplete != null) {
          cleanupTimer();
          isReady = true;
          reconnectAttempts = 0;
          if (isResume) {
            onState({ type: "socket_resumed" });
          }
          onState({ type: "setup_complete" });
          resolve();
          return;
        }

        if (payload?.goAway) {
          onState({ type: "go_away", payload: payload.goAway });
          scheduleReconnect("go_away");
        }

        const nextText = extractServerText(payload);
        if (nextText) {
          bufferedText += nextText;
        }

        if (payload?.serverContent?.generationComplete || payload?.serverContent?.turnComplete) {
          const text = bufferedText.trim();
          bufferedText = "";
          if (!text) return;
          const parsed = parseLiveModelText(text);
          if (!parsed) {
            onError(new Error("Gemini Live returned non-parseable JSON"));
            return;
          }
          onResult({
            success: true,
            source: "gemini_live",
            generation: currentRequest?.generation || 0,
            candidate_id: currentRequest?.candidate_id || "",
            track_id: currentRequest?.track_id || "",
            from_cache: false,
            stable: false,
            latency_ms: 0,
            ...parsed,
          });
          currentRequest = null;
        }
      };
    });
    return openPromise;
  }

  async function pushCandidateVideo(candidate) {
    await connect();
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error("Gemini Live socket is not open");
    }
    const maxChunkCount = Math.max(1, Number(candidateVideoPolicy?.max_chunk_count || 2));
    const chunks = [
      candidate?.roi_jpeg_base64,
      candidate?.context_jpeg_base64,
    ].filter(Boolean).slice(0, maxChunkCount);
    const mimeType = candidate?.mime_type || "image/jpeg";
    for (const chunk of chunks) {
      socket.send(
        JSON.stringify({
          realtimeInput: {
            video: {
              mimeType,
              data: chunk,
            },
          },
        }),
      );
    }
    return candidate?.generation || 1;
  }

  async function requestCandidateClassification(candidate) {
    await connect();
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error("Gemini Live socket is not open");
    }
    bufferedText = "";
    currentRequest = {
      candidate_id: candidate?.candidate_id || "",
      generation: Number(candidate?.generation || 1),
      track_id: candidate?.track_id || String(candidate?.candidate_id || "").split(":")[0] || "",
    };
    socket.send(
      JSON.stringify({
        clientContent: {
          turns: [
            {
              role: "user",
              parts: [
                {
                  text: buildCandidatePrompt(candidate, frameTurnPrompt),
                },
              ],
            },
          ],
          turnComplete: true,
        },
      }),
    );
    return currentRequest.generation;
  }

  async function close() {
    isClosed = true;
    clearReconnectTimer();
    closeSocket(1000, "client_close");
  }

  return {
    mode: "direct_websocket",
    connect,
    pushCandidateVideo,
    requestCandidateClassification,
    close,
    isReady: () => isReady,
  };
}

export function createLegacyLiveTransport({
  api,
  model,
}) {
  let sessionId = "";

  async function connect() {
    const response = await api.startLiveVisionSession({ model });
    if (!response.ok || !response.data?.session_id) {
      throw new Error(response.error || response.hint || "Legacy live session start failed");
    }
    sessionId = response.data.session_id;
    return response.data;
  }

  async function sendFrame(frameBase64, mimeType = "image/jpeg") {
    if (!sessionId) {
      throw new Error("Legacy live session is not connected");
    }
    const response = await api.sendLiveVisionFrame(sessionId, {
      frame_base64: frameBase64,
      mime_type: mimeType,
    });
    if (!response.ok) {
      throw new Error(response.error || response.hint || "Legacy live frame failed");
    }
    return response.data;
  }

  async function close() {
    if (!sessionId) return;
    await api.stopLiveVisionSession(sessionId);
    sessionId = "";
  }

  return {
    mode: "legacy_http_poll",
    connect,
    sendFrame,
    close,
    getSessionId: () => sessionId,
  };
}
