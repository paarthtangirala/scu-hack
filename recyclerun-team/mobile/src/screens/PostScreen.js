import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";

import { Card, PrimaryButton, SectionTitle, SecondaryButton, colors } from "../components/ui";
import { API_BASE_URL, LIVE_PREVIEW_FRAME_INTERVAL_MS } from "../config";
import { api } from "../services/api";
import { FALLBACK_MATERIALS } from "../services/materialsFallback";

function randomLatLng() {
  return {
    lat: 37.3541 + (Math.random() - 0.5) * 0.05,
    lng: -121.9552 + (Math.random() - 0.5) * 0.05,
  };
}

function formatApiFailure(action, response) {
  const hint = response?.hint ? ` ${response.hint}` : "";
  return `${action} failed: ${response?.error || "Request failed"}${hint}`;
}

const LIVE_MIN_PER_ITEM_LBS = 0.1;
const SCAN_PLACEHOLDER = "rgba(120, 145, 122, 0.9)";

function normalizeLiveDetectionCount(rawCount) {
  const count = Number(rawCount);
  if (!Number.isFinite(count) || count <= 0) return 1;
  return Math.max(1, Math.round(count));
}

function normalizeLiveDetectionLbs(rawLbs, rawCount) {
  const lbs = Number(rawLbs);
  if (!Number.isFinite(lbs) || lbs <= 0) return 0;
  const count = normalizeLiveDetectionCount(rawCount);
  const minTotal = LIVE_MIN_PER_ITEM_LBS * count;
  const total = count > 1 ? Math.max(lbs, minTotal) : Math.max(lbs, LIVE_MIN_PER_ITEM_LBS);
  return Math.round(total * 10) / 10;
}

function buildDetectionSignature(rows) {
  const normalized = (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const type = typeof row?.type === "string" ? row.type.trim() : "";
      if (!type) return "";
      const count = normalizeLiveDetectionCount(row?.count);
      const lbs = normalizeLiveDetectionLbs(row?.lbs, count);
      if (lbs <= 0) return "";
      return `${type}:${count}:${lbs.toFixed(1)}`;
    })
    .filter(Boolean)
    .sort();
  return normalized.join("|");
}

function materialDisplayName(materialMap, type) {
  const fallback = String(type || "").replace(/_/g, " ").trim();
  if (!type) return fallback;
  const label = materialMap?.[type]?.label;
  if (typeof label !== "string" || !label.trim()) return fallback;
  return label.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim();
}

export function PostScreen({ profile = null, onListingPosted = () => {} }) {
  const profileName = String(profile?.display_name || "").trim();
  const profilePhone = String(profile?.phone || "").trim();
  const profileHasContact = Boolean(profileName);
  const [useProfileContact, setUseProfileContact] = useState(profileHasContact);
  const [materials, setMaterials] = useState(FALLBACK_MATERIALS);
  const [form, setForm] = useState({
    listing_kind: "household",
    household_name: profileName,
    address: "",
    phone: profilePhone,
    notes: "",
  });
  const [message, setMessage] = useState("");
  const [aiMaterials, setAiMaterials] = useState([]);
  const [manualRows, setManualRows] = useState([]);
  const [lockedTypes, setLockedTypes] = useState([]);
  const lockedTypesRef = useRef([]);
  const [manualType, setManualType] = useState("cardboard");
  const [manualLbs, setManualLbs] = useState("");
  const [loadingSubmit, setLoadingSubmit] = useState(false);
  const [liveSupported, setLiveSupported] = useState(true);
  const [aiSource, setAiSource] = useState("");
  const [liveSession, setLiveSession] = useState(null);
  const [liveRunning, setLiveRunning] = useState(false);
  const [startingLive, setStartingLive] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [pendingDetection, setPendingDetection] = useState(null);
  const [pendingDetectionQueue, setPendingDetectionQueue] = useState([]);
  const [latestFrameDetections, setLatestFrameDetections] = useState([]);
  const [scanDecisionPromptVisible, setScanDecisionPromptVisible] = useState(false);
  const [livePausedForReview, setLivePausedForReview] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  const cameraRef = useRef(null);
  const liveSessionIdRef = useRef("");
  const frameLoopRef = useRef(null);
  const frameBusyRef = useRef(false);
  const livePausedForReviewRef = useRef(false);
  const pendingDetectionRef = useRef(null);
  const pendingDetectionQueueRef = useRef([]);
  const scanDecisionPromptVisibleRef = useRef(false);
  const lastPromptSignatureRef = useRef("");
  const scanPulse = useRef(new Animated.Value(0)).current;

  const materialKeys = useMemo(() => Object.keys(materials), [materials]);
  const liveFlowStage = useMemo(() => {
    if (startingLive) return "starting";
    if (!liveRunning) return "idle";
    if (pendingDetection) return "review";
    if (scanDecisionPromptVisible) return "decision";
    return "scanning";
  }, [liveRunning, pendingDetection, scanDecisionPromptVisible, startingLive]);

  const liveFlowMessage = useMemo(() => {
    if (liveFlowStage === "starting") return "Starting session and capturing first frame.";
    if (liveFlowStage === "review") return "Review detection, then add or skip.";
    if (liveFlowStage === "decision") return "Choose to keep scanning or end the live session.";
    if (liveFlowStage === "scanning") return "Scanning camera feed and waiting for next detection.";
    return "Tap Start Live Preview to begin guided scan mode.";
  }, [liveFlowStage]);

  const activelyScanning = useMemo(
    () => liveRunning && !startingLive && !livePausedForReview && !pendingDetection && !scanDecisionPromptVisible,
    [liveRunning, startingLive, livePausedForReview, pendingDetection, scanDecisionPromptVisible],
  );

  const scanPulseScale = useMemo(
    () => scanPulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] }),
    [scanPulse],
  );

  const scanPulseOpacity = useMemo(
    () => scanPulse.interpolate({ inputRange: [0, 1], outputRange: [0.65, 1] }),
    [scanPulse],
  );

  useEffect(() => {
    lockedTypesRef.current = lockedTypes;
  }, [lockedTypes]);

  useEffect(() => {
    livePausedForReviewRef.current = livePausedForReview;
  }, [livePausedForReview]);

  useEffect(() => {
    pendingDetectionRef.current = pendingDetection;
  }, [pendingDetection]);

  useEffect(() => {
    pendingDetectionQueueRef.current = pendingDetectionQueue;
  }, [pendingDetectionQueue]);

  useEffect(() => {
    scanDecisionPromptVisibleRef.current = scanDecisionPromptVisible;
  }, [scanDecisionPromptVisible]);

  useEffect(() => {
    if (!activelyScanning) {
      scanPulse.stopAnimation();
      scanPulse.setValue(0);
      return;
    }
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(scanPulse, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(scanPulse, {
          toValue: 0,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    pulse.start();
    return () => {
      pulse.stop();
      scanPulse.setValue(0);
    };
  }, [activelyScanning, scanPulse]);

  useEffect(() => {
    if (!cameraPermission?.granted) {
      setCameraReady(false);
    }
  }, [cameraPermission?.granted]);

  const loadMaterials = useCallback(async () => {
    const response = await api.getMaterials();
    if (response.ok && response.data) {
      setMaterials(response.data);
      const keys = Object.keys(response.data);
      if (keys.length && !keys.includes(manualType)) {
        setManualType(keys[0]);
      }
    } else {
      setMessage(formatApiFailure("Load materials", response));
    }
  }, [manualType]);

  useEffect(() => {
    loadMaterials();
  }, [loadMaterials]);

  useEffect(() => {
    setUseProfileContact(Boolean(profileName));
  }, [profileName]);

  useEffect(() => {
    if (!useProfileContact) return;
    setForm((prev) => ({
      ...prev,
      household_name: profileName,
      phone: profilePhone,
    }));
  }, [useProfileContact, profileName, profilePhone]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const probe = await api.getLiveVisionSessionHealth("probe");
      if (!mounted) return;
      if (probe.ok) {
        setLiveSupported(true);
        return;
      }
      if (probe.status !== 404) {
        return;
      }
      const code = probe?.data?.code || probe?.data?.error || "";
      if (code === "live_session_not_found") {
        setLiveSupported(true);
        return;
      }
      setLiveSupported(false);
      setMessage(`Live preview unavailable on backend (${API_BASE_URL}). Deploy backend with /api/live-vision routes.`);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const upsertManualLock = useCallback((type) => {
    const normalized = String(type || "").trim();
    if (!normalized) return;
    setLockedTypes((prev) => (prev.includes(normalized) ? prev : [...prev, normalized]));
  }, []);

  const normalizeAiRows = useCallback((rows) => {
    const locked = new Set(lockedTypesRef.current);
    const merged = new Map();
    const order = [];

    (Array.isArray(rows) ? rows : []).forEach((row) => {
      const type = typeof row?.type === "string" ? row.type.trim() : "";
      const safeCount = normalizeLiveDetectionCount(row?.count);
      const lbs = normalizeLiveDetectionLbs(row?.lbs, safeCount);
      if (!type || lbs <= 0 || locked.has(type)) return;
      if (!merged.has(type)) {
        merged.set(type, { lbs, count: safeCount });
        order.push(type);
        return;
      }
      const current = merged.get(type);
      merged.set(type, { lbs: current.lbs + lbs, count: current.count + safeCount });
    });

    return order.map((type) => ({
      type,
      lbs: Math.round(merged.get(type).lbs * 10) / 10,
      count: merged.get(type).count,
    }));
  }, []);

  const addManualRow = () => {
    const lbs = Number(manualLbs);
    if (!manualType || Number.isNaN(lbs) || lbs <= 0) {
      setMessage("Enter a valid material type and lbs > 0");
      return;
    }
    upsertManualLock(manualType);
    setManualRows((prev) => [...prev, { id: String(Date.now()), type: manualType, lbs, count: 1 }]);
    setManualLbs("");
    setMessage("");
  };

  const removeManualRow = (id) => {
    setManualRows((prev) => {
      const target = prev.find((row) => row.id === id);
      if (target?.type) upsertManualLock(target.type);
      return prev.filter((row) => row.id !== id);
    });
  };

  const updateManualRowLbs = (id, value) => {
    const parsed = Number(value);
    setManualRows((prev) =>
      prev.map((row) => {
        if (row.id !== id) return row;
        upsertManualLock(row.type);
        return { ...row, lbs: Number.isFinite(parsed) && parsed > 0 ? parsed : row.lbs };
      }),
    );
  };

  const clearLiveFrameLoop = useCallback(() => {
    if (!frameLoopRef.current) return;
    clearInterval(frameLoopRef.current);
    frameLoopRef.current = null;
  }, []);

  const stopLivePreview = useCallback(async () => {
    clearLiveFrameLoop();
    setLiveRunning(false);
    setStartingLive(false);
    setLivePausedForReview(false);
    livePausedForReviewRef.current = false;
    setPendingDetection(null);
    pendingDetectionRef.current = null;
    setPendingDetectionQueue([]);
    pendingDetectionQueueRef.current = [];
    setLatestFrameDetections([]);
    setScanDecisionPromptVisible(false);
    scanDecisionPromptVisibleRef.current = false;
    lastPromptSignatureRef.current = "";
    frameBusyRef.current = false;
    const sessionId = liveSessionIdRef.current;
    liveSessionIdRef.current = "";
    setLiveSession(null);
    if (!sessionId) return;
    await api.stopLiveVisionSession(sessionId);
  }, [clearLiveFrameLoop]);

  const sendLiveFrame = useCallback(
    async (sessionId) => {
      if (!sessionId || frameBusyRef.current || !cameraRef.current || livePausedForReviewRef.current) return;
      frameBusyRef.current = true;
      try {
        const photo = await cameraRef.current.takePictureAsync({
          base64: true,
          quality: 0.35,
          skipProcessing: true,
        });
        if (!photo?.base64) return;

        const response = await api.sendLiveVisionFrame(sessionId, {
          frame_base64: photo.base64,
          mime_type: "image/jpeg",
        });

        if (!response.ok) {
          if (response.status === 404) {
            setLiveSupported(false);
            setMessage(`Live preview unavailable on backend (${API_BASE_URL}). Deploy backend with /api/live-vision routes.`);
            return;
          }
          setMessage(formatApiFailure("Live preview", response));
          return;
        }

        setAiSource(response.data?.source || "gemini_live");
        const normalizedRows = normalizeAiRows(response.data?.materials || []);
        const detectionSignature = buildDetectionSignature(normalizedRows);
        const fromCache = Boolean(response.data?.from_cache);
        setAiMaterials(normalizedRows);

        if (response.data?.source === "gemini_live_demo") {
          const fallbackReason = String(response.data?.notes || "")
            .replace(/^Live fallback:\s*/i, "")
            .trim();
          const detail = fallbackReason ? ` (${fallbackReason})` : "";
          setMessage(`Live AI fallback mode active${detail}. You can still add/edit materials manually.`);
        } else if (fromCache) {
          if (!pendingDetectionRef.current && !scanDecisionPromptVisibleRef.current) {
            const reason = String(response.data?.fallback_reason || "").trim();
            const detail = reason ? ` (${reason})` : "";
            setMessage(`Live AI waiting for a fresh frame${detail}. Keep scanning.`);
          }
        } else {
          setMessage("Live AI preview active.");
          if (normalizedRows.length > 0 && !pendingDetectionRef.current && !scanDecisionPromptVisibleRef.current) {
            if (detectionSignature && detectionSignature === lastPromptSignatureRef.current) {
              setMessage("No new object change detected yet. Keep scanning.");
              return;
            }

            const queue = normalizedRows
              .slice()
              .sort((a, b) => Number(b?.lbs || 0) - Number(a?.lbs || 0));
            const primary = queue[0];
            if (primary?.type) {
              lastPromptSignatureRef.current = detectionSignature;
              const remaining = queue.slice(1);
              setLatestFrameDetections(queue);
              setPendingDetection({
                type: primary.type,
                lbs: Number(primary.lbs || 0),
                count: Number(primary.count || 1),
                source: response.data?.source || "gemini_live",
              });
              pendingDetectionRef.current = {
                type: primary.type,
                lbs: Number(primary.lbs || 0),
                count: Number(primary.count || 1),
                source: response.data?.source || "gemini_live",
              };
              setPendingDetectionQueue(remaining);
              pendingDetectionQueueRef.current = remaining;
              setLivePausedForReview(true);
              livePausedForReviewRef.current = true;
              setScanDecisionPromptVisible(false);
              scanDecisionPromptVisibleRef.current = false;
              clearLiveFrameLoop();
              setMessage(
                `Detected ${materialDisplayName(materials, primary.type)}${
                  Number(primary.count || 1) > 1 ? ` x${Number(primary.count || 1)}` : ""
                } (${Number(primary.lbs || 0).toFixed(1)} lbs). Confirm to add it.`,
              );
            }
          }
        }
      } catch (error) {
        const errorMessage = String(error?.message || "Unable to capture camera frame.");
        if (errorMessage.toLowerCase().includes("camera unmounted")) {
          await stopLivePreview();
          setMessage("Live preview was interrupted by camera remount. Tap Start Live Preview again.");
          return;
        }
        setMessage(`Live preview frame failed: ${errorMessage}`);
      } finally {
        frameBusyRef.current = false;
      }
    },
    [clearLiveFrameLoop, materials, normalizeAiRows, stopLivePreview],
  );

  const runLiveLoop = useCallback(
    (sessionId) => {
      if (!sessionId) return;
      clearLiveFrameLoop();
      frameLoopRef.current = setInterval(() => {
        sendLiveFrame(sessionId);
      }, LIVE_PREVIEW_FRAME_INTERVAL_MS);
    },
    [clearLiveFrameLoop, sendLiveFrame],
  );

  const resumeScanning = useCallback(async () => {
    const sessionId = liveSessionIdRef.current;
    if (!sessionId) return;
    setLivePausedForReview(false);
    livePausedForReviewRef.current = false;
    setPendingDetection(null);
    pendingDetectionRef.current = null;
    setPendingDetectionQueue([]);
    pendingDetectionQueueRef.current = [];
    setLatestFrameDetections([]);
    setScanDecisionPromptVisible(false);
    scanDecisionPromptVisibleRef.current = false;
    setMessage("Live AI preview active.");
    await sendLiveFrame(sessionId);
    runLiveLoop(sessionId);
  }, [runLiveLoop, sendLiveFrame]);

  const finishDetectionDecision = useCallback((added) => {
    const queue = pendingDetectionQueueRef.current;
    if (queue.length > 0) {
      const [nextDetection, ...rest] = queue;
      setPendingDetectionQueue(rest);
      pendingDetectionQueueRef.current = rest;
      setPendingDetection(nextDetection);
      pendingDetectionRef.current = nextDetection;
      setLivePausedForReview(true);
      livePausedForReviewRef.current = true;
      setScanDecisionPromptVisible(false);
      scanDecisionPromptVisibleRef.current = false;
      setMessage(
        `${added ? "Item added." : "Item skipped."} Next detected item: ${materialDisplayName(materials, nextDetection.type)}${
          Number(nextDetection.count || 1) > 1 ? ` x${Number(nextDetection.count || 1)}` : ""
        } (${Number(nextDetection.lbs || 0).toFixed(1)} lbs).`,
      );
      return;
    }
    if (added) {
      setMessage("Item added. Keep scanning or end live preview.");
    } else {
      setMessage("Item skipped. Keep scanning or end live preview.");
    }
    setPendingDetection(null);
    pendingDetectionRef.current = null;
    setScanDecisionPromptVisible(true);
    scanDecisionPromptVisibleRef.current = true;
  }, [materials]);

  const confirmAddDetected = useCallback(() => {
    if (!pendingDetection?.type || !Number.isFinite(Number(pendingDetection?.lbs))) {
      finishDetectionDecision(false);
      return;
    }
    const count = normalizeLiveDetectionCount(pendingDetection.count);
    const lbs = normalizeLiveDetectionLbs(pendingDetection.lbs, count);
    if (lbs <= 0) {
      finishDetectionDecision(false);
      return;
    }
    setManualRows((prev) => {
      const existingIdx = prev.findIndex((row) => row.type === pendingDetection.type);
      if (existingIdx === -1) {
        return [...prev, { id: String(Date.now()), type: pendingDetection.type, lbs, count }];
      }
      const next = [...prev];
      const existing = next[existingIdx];
      next[existingIdx] = {
        ...existing,
        lbs: Math.round((Number(existing.lbs || 0) + lbs) * 10) / 10,
        count: normalizeLiveDetectionCount(existing.count) + count,
      };
      return next;
    });
    finishDetectionDecision(true);
  }, [finishDetectionDecision, pendingDetection]);

  const skipDetected = useCallback(() => {
    finishDetectionDecision(false);
  }, [finishDetectionDecision]);

  const startLivePreview = useCallback(async () => {
    if (startingLive || liveRunning) return;
    setStartingLive(true);
    const permission = cameraPermission?.granted ? cameraPermission : await requestCameraPermission();
    if (!permission?.granted) {
      setMessage("Camera permission is required for Live AI Preview");
      setStartingLive(false);
      return;
    }
    if (!cameraReady) {
      setMessage("Camera is initializing. Wait 1-2 seconds and tap Start Live Preview again.");
      setStartingLive(false);
      return;
    }

    const start = await api.startLiveVisionSession({});
    if (!start.ok) {
      if (start.status === 404) {
        setLiveSupported(false);
        setMessage(`Live session start failed: backend missing /api/live-vision routes at ${API_BASE_URL}.`);
      } else {
        setMessage(formatApiFailure("Live session start", start));
      }
      setStartingLive(false);
      return;
    }

    const sessionId = start.data?.session_id;
    if (!sessionId) {
      setMessage("Live session did not return session_id");
      setStartingLive(false);
      return;
    }

    try {
      setLiveSession(start.data);
      liveSessionIdRef.current = sessionId;
      setLiveRunning(true);
      setLivePausedForReview(false);
      livePausedForReviewRef.current = false;
      setPendingDetection(null);
      pendingDetectionRef.current = null;
      setPendingDetectionQueue([]);
      pendingDetectionQueueRef.current = [];
      setLatestFrameDetections([]);
      setScanDecisionPromptVisible(false);
      scanDecisionPromptVisibleRef.current = false;
      lastPromptSignatureRef.current = "";
      setAiSource(start.data?.source_mode || "");
      await sendLiveFrame(sessionId);
      runLiveLoop(sessionId);
    } catch (error) {
      setMessage(`Live session start failed: ${error?.message || "Unknown error"}`);
      await api.stopLiveVisionSession(sessionId);
      liveSessionIdRef.current = "";
      setLiveSession(null);
      setLiveRunning(false);
    } finally {
      setStartingLive(false);
    }
  }, [cameraPermission, cameraReady, liveRunning, requestCameraPermission, runLiveLoop, sendLiveFrame, startingLive]);

  useEffect(() => {
    return () => {
      void stopLivePreview();
    };
  }, [stopLivePreview]);

  useEffect(() => {
    const locked = new Set(lockedTypes);
    setAiMaterials((prev) => prev.filter((row) => !locked.has(row.type)));
  }, [lockedTypes]);

  const resetAiSuggestions = () => {
    setLockedTypes([]);
    setAiMaterials([]);
    setAiSource("");
    setPendingDetection(null);
    pendingDetectionRef.current = null;
    setPendingDetectionQueue([]);
    pendingDetectionQueueRef.current = [];
    setLatestFrameDetections([]);
    setScanDecisionPromptVisible(false);
    scanDecisionPromptVisibleRef.current = false;
    setLivePausedForReview(false);
    livePausedForReviewRef.current = false;
    lastPromptSignatureRef.current = "";
    setMessage("AI suggestion locks reset. You can restart live preview to refill suggestions.");
  };

  const submitListing = async () => {
    const effectiveName = (useProfileContact ? profileName : form.household_name).trim();
    const effectivePhone = (useProfileContact ? profilePhone : form.phone).trim();
    if (!effectiveName || !form.address.trim()) {
      setMessage("Name and address are required");
      return;
    }

    const locked = new Set(lockedTypes);
    const merged = [
      ...aiMaterials
        .filter((m) => !locked.has(m.type))
        .map((m) => ({ type: m.type, lbs: Number(m.lbs) })),
      ...manualRows.map((m) => ({ type: m.type, lbs: Number(m.lbs) })),
    ].filter((m) => m.type && m.lbs > 0);

    if (!merged.length) {
      setMessage("Add at least one material");
      return;
    }

    setLoadingSubmit(true);
    const { lat, lng } = randomLatLng();
    const response = await api.createListing({
      ...form,
      household_name: effectiveName,
      phone: effectivePhone,
      lat,
      lng,
      materials: merged,
    });
    setLoadingSubmit(false);

    if (!response.ok) {
      setMessage(formatApiFailure("Post", response));
      return;
    }

    setMessage("Listing posted successfully");
    onListingPosted(response?.data?.listing?.id || "");
    setForm((prev) => ({
      listing_kind: prev.listing_kind,
      household_name: useProfileContact ? profileName : prev.household_name,
      address: "",
      phone: useProfileContact ? profilePhone : prev.phone,
      notes: "",
    }));
    setAiMaterials([]);
    setAiSource("");
    setManualRows([]);
    setManualLbs("");
    setLockedTypes([]);
    stopLivePreview();
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <SectionTitle title="Post Listing" subtitle="Household or small business pickup request" />

      <Card>
        <Text style={styles.label}>Listing Type</Text>
        <View style={styles.toggleRow}>
          {["household", "business"].map((kind) => (
            <Pressable
              key={kind}
              style={[styles.toggle, form.listing_kind === kind ? styles.toggleActive : null]}
              onPress={() => setForm((prev) => ({ ...prev, listing_kind: kind }))}
            >
              <Text style={form.listing_kind === kind ? styles.toggleTextActive : styles.toggleText}>
                {kind === "household" ? "Household" : "Business"}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.labelSecondary}>Contact Source</Text>
        <View style={styles.toggleRow}>
          <Pressable
            style={[styles.toggle, useProfileContact ? styles.toggleActive : null, !profileHasContact ? styles.toggleDisabled : null]}
            onPress={() => {
              if (!profileHasContact) return;
              setUseProfileContact(true);
            }}
          >
            <Text style={useProfileContact ? styles.toggleTextActive : styles.toggleText}>
              Use Profile
            </Text>
          </Pressable>
          <Pressable
            style={[styles.toggle, !useProfileContact ? styles.toggleActive : null]}
            onPress={() => setUseProfileContact(false)}
          >
            <Text style={!useProfileContact ? styles.toggleTextActive : styles.toggleText}>
              Custom
            </Text>
          </Pressable>
        </View>
        {useProfileContact ? (
          <Text style={styles.contactHint}>
            Posting as {profileName || "profile user"} {profilePhone ? `(${profilePhone})` : ""}.
          </Text>
        ) : null}

        <TextInput
          value={form.household_name}
          onChangeText={(text) => setForm((prev) => ({ ...prev, household_name: text }))}
          placeholder="Name"
          placeholderTextColor={SCAN_PLACEHOLDER}
          style={styles.inputField}
          editable={!useProfileContact}
        />
        <TextInput
          value={form.address}
          onChangeText={(text) => setForm((prev) => ({ ...prev, address: text }))}
          placeholder="Address"
          placeholderTextColor={SCAN_PLACEHOLDER}
          style={styles.inputField}
        />
        <TextInput
          value={form.phone}
          onChangeText={(text) => setForm((prev) => ({ ...prev, phone: text }))}
          placeholder="Phone"
          placeholderTextColor={SCAN_PLACEHOLDER}
          keyboardType="phone-pad"
          style={styles.inputField}
          editable={!useProfileContact}
        />
        <TextInput
          value={form.notes}
          onChangeText={(text) => setForm((prev) => ({ ...prev, notes: text }))}
          placeholder="Notes"
          placeholderTextColor={SCAN_PLACEHOLDER}
          multiline
          style={[styles.inputField, styles.multiline]}
        />
      </Card>

      <Card>
        <Text style={styles.subTitle}>AI Classify (Live Preview)</Text>

        {cameraPermission?.granted ? (
          <CameraView
            ref={cameraRef}
            style={styles.cameraPreview}
            facing="back"
            onCameraReady={() => setCameraReady(true)}
            onMountError={(event) => {
              setCameraReady(false);
              setMessage(`Camera mount failed: ${event?.nativeEvent?.message || "Unknown camera error"}`);
            }}
          />
        ) : (
          <View style={styles.permissionBox}>
            <Text style={styles.permissionText}>Camera permission required for live preview.</Text>
            <SecondaryButton title="Enable Camera" onPress={requestCameraPermission} />
          </View>
        )}

        <View style={styles.liveButtonRow}>
          <PrimaryButton
            title={liveRunning ? "Stop Live Preview" : startingLive ? "Starting Live Preview..." : "Start Live Preview"}
            onPress={liveRunning ? stopLivePreview : startLivePreview}
            loading={startingLive}
            disabled={
              startingLive ||
              (cameraPermission?.granted && !cameraReady && !liveRunning) ||
              !liveSupported
            }
          />
          <SecondaryButton title="Reset AI Suggestions" onPress={resetAiSuggestions} />
        </View>

        {activelyScanning ? (
          <Animated.View
            style={[
              styles.scanBanner,
              {
                opacity: scanPulseOpacity,
                transform: [{ scale: scanPulseScale }],
              },
            ]}
          >
            <ActivityIndicator color={colors.primaryDark} />
            <Text style={styles.scanBannerText}>AI scanning frame stream...</Text>
          </Animated.View>
        ) : null}

        <Text style={styles.liveHint}>
          Frame cadence: {LIVE_PREVIEW_FRAME_INTERVAL_MS}ms. Manual edits lock types from AI overwrite.
        </Text>

        <View style={styles.flowCard}>
          <Text style={styles.flowTitle}>Live Flow</Text>
          <View style={styles.flowRow}>
            <View style={[styles.flowPill, liveFlowStage !== "idle" ? styles.flowPillActive : null]}>
              <Text style={styles.flowPillText}>Start</Text>
            </View>
            <View style={[styles.flowPill, liveFlowStage === "scanning" ? styles.flowPillActive : null]}>
              <Text style={styles.flowPillText}>Detect</Text>
            </View>
            <View style={[styles.flowPill, liveFlowStage === "review" ? styles.flowPillActive : null]}>
              <Text style={styles.flowPillText}>Confirm</Text>
            </View>
            <View style={[styles.flowPill, liveFlowStage === "decision" ? styles.flowPillActive : null]}>
              <Text style={styles.flowPillText}>Continue</Text>
            </View>
          </View>
          <Text style={styles.flowCaption}>{liveFlowMessage}</Text>
        </View>

        {pendingDetection ? (
          <View style={styles.confirmBox}>
            <Text style={styles.confirmTitle}>Detected Item</Text>
            <Text style={styles.confirmText}>
              {materialDisplayName(materials, pendingDetection.type)}
              {Number(pendingDetection.count || 1) > 1 ? ` x${Number(pendingDetection.count || 1)}` : ""}
              {" - "}
              {Number(pendingDetection.lbs || 0).toFixed(1)} lbs
            </Text>
            <Text style={styles.confirmText}>Add this item to the listing?</Text>

            {latestFrameDetections.length > 1 ? (
              <View style={styles.detectedGroup}>
                <Text style={styles.detectedGroupTitle}>All Categories In Current Frame</Text>
                {latestFrameDetections.map((row, idx) => (
                  <Text key={`${row.type}-${idx}`} style={styles.detectedGroupRow}>
                    {materialDisplayName(materials, row.type)}
                    {Number(row.count || 1) > 1 ? ` x${Number(row.count || 1)}` : ""}
                    {" - "}
                    {Number(row.lbs || 0).toFixed(1)} lbs
                  </Text>
                ))}
              </View>
            ) : null}

            <View style={styles.confirmActions}>
              <PrimaryButton title="Add Item" onPress={confirmAddDetected} />
              <SecondaryButton title="Skip Item" onPress={skipDetected} />
            </View>
          </View>
        ) : null}

        {scanDecisionPromptVisible ? (
          <View style={styles.confirmBox}>
            <Text style={styles.confirmTitle}>Continue Live Scan?</Text>
            <View style={styles.confirmActions}>
              <PrimaryButton title="Keep Scanning" onPress={resumeScanning} />
              <SecondaryButton title="End Live Preview" onPress={stopLivePreview} />
            </View>
          </View>
        ) : null}

        {aiMaterials.length ? (
          <View style={styles.materialList}>
            <Text style={styles.sourceTag}>Source: {aiSource || "unknown"}</Text>
            {aiMaterials.map((m, idx) => (
              <View style={styles.materialRow} key={`${m.type}-${idx}`}>
                <Text style={styles.materialName}>
                  {materialDisplayName(materials, m.type)}
                  {Number(m.count || 1) > 1 ? ` x${Number(m.count || 1)}` : ""}
                </Text>
                <Text style={styles.materialWeight}>{Number(m.lbs).toFixed(1)} lbs</Text>
              </View>
            ))}
          </View>
        ) : null}
      </Card>

      <Card>
        <Text style={styles.subTitle}>Manual Materials</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.horizontalList}>
          {materialKeys.map((key) => (
            <Pressable
              key={key}
              style={[styles.chip, manualType === key ? styles.chipActive : null]}
              onPress={() => setManualType(key)}
            >
              <Text style={manualType === key ? styles.chipTextActive : styles.chipText}>
                {materialDisplayName(materials, key)}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        <View style={styles.inlineInputs}>
          <TextInput
            value={manualLbs}
            onChangeText={setManualLbs}
            keyboardType="decimal-pad"
            placeholder="Lbs"
            placeholderTextColor={SCAN_PLACEHOLDER}
            style={[styles.inputField, styles.inlineInput]}
          />
          <Pressable style={styles.addIconButton} onPress={addManualRow}>
            <Text style={styles.addIconText}>+</Text>
          </Pressable>
        </View>

        {manualRows.map((row) => (
          <View key={row.id} style={styles.manualRow}>
            <Text style={styles.manualText}>
              {materialDisplayName(materials, row.type)}
              {normalizeLiveDetectionCount(row.count) > 1 ? ` x${normalizeLiveDetectionCount(row.count)}` : ""}
              {" - "}
              {row.lbs.toFixed(1)} lbs
            </Text>
            <TextInput
              value={String(row.lbs)}
              onChangeText={(text) => updateManualRowLbs(row.id, text)}
              keyboardType="decimal-pad"
              placeholderTextColor={SCAN_PLACEHOLDER}
              style={styles.manualLbsInput}
            />
            <Pressable style={styles.binButton} onPress={() => removeManualRow(row.id)}>
              <Text style={styles.binButtonText}>🗑</Text>
            </Pressable>
          </View>
        ))}
      </Card>

      {message ? (
        <View style={styles.messageBar}>
          <Text style={styles.message}>{message}</Text>
        </View>
      ) : null}

      <PrimaryButton
        title={loadingSubmit ? "Posting..." : "Post Listing"}
        onPress={submitListing}
        loading={loadingSubmit}
        disabled={loadingSubmit}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 120,
    backgroundColor: "transparent",
  },
  label: {
    color: colors.ink,
    fontWeight: "800",
    fontSize: 20,
    marginBottom: 10,
    letterSpacing: 0.3,
  },
  labelSecondary: {
    color: colors.muted,
    marginBottom: 6,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  toggleRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 12,
  },
  toggle: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.cardSoft,
  },
  toggleActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.26,
    shadowRadius: 14,
    elevation: 5,
  },
  toggleDisabled: {
    opacity: 0.5,
  },
  toggleText: {
    color: colors.ink,
    fontWeight: "700",
    fontSize: 15,
  },
  toggleTextActive: {
    color: colors.primaryDark,
    fontWeight: "800",
    fontSize: 15,
  },
  contactHint: {
    color: colors.muted,
    marginBottom: 8,
    fontSize: 12,
  },
  inputField: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    minHeight: 50,
    marginBottom: 10,
    backgroundColor: colors.cardSoft,
    color: colors.ink,
    fontSize: 16,
    fontWeight: "600",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  multiline: {
    minHeight: 90,
    textAlignVertical: "top",
  },
  subTitle: {
    fontWeight: "800",
    fontSize: 20,
    letterSpacing: 0.3,
    color: colors.ink,
    marginBottom: 12,
  },
  cameraPreview: {
    width: "100%",
    height: 260,
    borderRadius: 18,
    marginBottom: 12,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.border,
  },
  permissionBox: {
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 12,
    backgroundColor: colors.cardSoft,
  },
  permissionText: {
    color: colors.ink,
    marginBottom: 10,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
  },
  liveButtonRow: {
    gap: 10,
  },
  scanBanner: {
    marginTop: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(0, 232, 122, 0.42)",
    backgroundColor: colors.primary,
    paddingVertical: 10,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  scanBannerText: {
    color: colors.primaryDark,
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  liveHint: {
    marginTop: 10,
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "600",
  },
  flowCard: {
    marginTop: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    backgroundColor: colors.cardSoft,
  },
  flowTitle: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: "800",
    marginBottom: 10,
  },
  flowRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 8,
  },
  flowPill: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingVertical: 7,
    alignItems: "center",
    backgroundColor: colors.surface,
  },
  flowPillActive: {
    borderColor: colors.primary,
    backgroundColor: "rgba(0, 232, 122, 0.14)",
  },
  flowPillText: {
    color: colors.ink,
    fontSize: 12,
    fontWeight: "700",
  },
  flowCaption: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "600",
  },
  confirmBox: {
    marginTop: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    backgroundColor: colors.cardSoft,
    gap: 8,
  },
  confirmTitle: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: "800",
  },
  confirmText: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 20,
  },
  detectedGroup: {
    marginTop: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.surface,
    gap: 6,
  },
  detectedGroupTitle: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  detectedGroupRow: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: "600",
  },
  confirmActions: {
    gap: 10,
    marginTop: 6,
  },
  materialList: {
    marginTop: 12,
    gap: 8,
  },
  sourceTag: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  materialRow: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingVertical: 9,
    paddingHorizontal: 10,
    backgroundColor: colors.surface,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  materialName: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: "700",
    flex: 1,
    marginRight: 8,
  },
  materialWeight: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: "800",
  },
  horizontalList: {
    marginBottom: 10,
  },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 11,
    marginRight: 8,
    backgroundColor: colors.cardSoft,
  },
  chipActive: {
    borderColor: colors.primary,
    backgroundColor: "rgba(0, 232, 122, 0.12)",
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 4,
  },
  chipText: {
    color: colors.ink,
    fontSize: 12,
    fontWeight: "700",
  },
  chipTextActive: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: "800",
  },
  inlineInputs: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  inlineInput: {
    flex: 1,
    marginBottom: 0,
  },
  addIconButton: {
    width: 52,
    height: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(0, 232, 122, 0.45)",
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 14,
    elevation: 6,
  },
  addIconText: {
    color: colors.primaryDark,
    fontSize: 32,
    lineHeight: 32,
    fontWeight: "800",
    marginTop: -2,
  },
  manualRow: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  manualText: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: "700",
    flex: 1,
    marginRight: 8,
  },
  manualLbsInput: {
    width: 72,
    marginRight: 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 7,
    backgroundColor: colors.cardSoft,
    color: colors.ink,
    fontSize: 13,
    fontWeight: "700",
  },
  binButton: {
    width: 46,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255, 107, 107, 0.5)",
    backgroundColor: "rgba(255, 107, 107, 0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  binButtonText: {
    fontSize: 18,
    color: colors.danger,
  },
  messageBar: {
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.cardSoft,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  message: {
    color: colors.ink,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
  },
});
