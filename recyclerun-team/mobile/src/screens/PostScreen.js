import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImagePicker from "expo-image-picker";

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

export function PostScreen() {
  const [materials, setMaterials] = useState(FALLBACK_MATERIALS);
  const [form, setForm] = useState({
    listing_kind: "household",
    household_name: "",
    address: "",
    phone: "",
    notes: "",
  });
  const [message, setMessage] = useState("");
  const [imageUri, setImageUri] = useState("");
  const [aiMaterials, setAiMaterials] = useState([]);
  const [manualRows, setManualRows] = useState([]);
  const [lockedTypes, setLockedTypes] = useState([]);
  const lockedTypesRef = useRef([]);
  const [manualType, setManualType] = useState("cardboard");
  const [manualLbs, setManualLbs] = useState("");
  const [loadingClassify, setLoadingClassify] = useState(false);
  const [loadingSubmit, setLoadingSubmit] = useState(false);
  const [captureMode, setCaptureMode] = useState("photo");
  const [liveSupported, setLiveSupported] = useState(true);
  const [aiSource, setAiSource] = useState("");
  const [liveSession, setLiveSession] = useState(null);
  const [liveRunning, setLiveRunning] = useState(false);
  const [startingLive, setStartingLive] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const cameraRef = useRef(null);
  const liveSessionIdRef = useRef("");
  const frameLoopRef = useRef(null);
  const frameBusyRef = useRef(false);

  const materialKeys = useMemo(() => Object.keys(materials), [materials]);

  useEffect(() => {
    lockedTypesRef.current = lockedTypes;
  }, [lockedTypes]);

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
      setCaptureMode("photo");
      setMessage(
        `Live preview unavailable on backend (${API_BASE_URL}). Deploy backend with /api/live-vision routes.`,
      );
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

  const normalizeAiRows = useCallback(
    (rows) => {
      const locked = new Set(lockedTypesRef.current);
      const merged = new Map();
      const order = [];
      (Array.isArray(rows) ? rows : []).forEach((row) => {
        const type = typeof row?.type === "string" ? row.type.trim() : "";
        const lbs = Number(row?.lbs);
        if (!type || !Number.isFinite(lbs) || lbs <= 0 || locked.has(type)) return;
        if (!merged.has(type)) {
          merged.set(type, lbs);
          order.push(type);
          return;
        }
        merged.set(type, merged.get(type) + lbs);
      });
      return order.map((type) => ({
        type,
        lbs: Math.round(merged.get(type) * 10) / 10,
      }));
    },
    [],
  );

  const addManualRow = () => {
    const lbs = Number(manualLbs);
    if (!manualType || Number.isNaN(lbs) || lbs <= 0) {
      setMessage("Enter a valid material type and lbs > 0");
      return;
    }
    upsertManualLock(manualType);
    setManualRows((prev) => [...prev, { id: String(Date.now()), type: manualType, lbs }]);
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

  const pickAndClassifyImage = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setMessage("Photo permission is required for AI classify");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: "images",
      allowsEditing: true,
      quality: 0.7,
      base64: true,
    });
    if (result.canceled || !result.assets?.length) {
      return;
    }

    const asset = result.assets[0];
    setImageUri(asset.uri || "");
    setLoadingClassify(true);
    setMessage("");

    const classify = await api.classifyImage(asset.base64 || "");
    if (!classify.ok) {
      setMessage(formatApiFailure("Classify", classify));
      setAiMaterials([]);
      setAiSource("");
    } else {
      setAiMaterials(normalizeAiRows(classify.data?.materials || []));
      setAiSource(classify.data?.source || "amd");
      setMessage("AI materials detected. Review and submit listing.");
    }
    setLoadingClassify(false);
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
    frameBusyRef.current = false;
    const sessionId = liveSessionIdRef.current;
    liveSessionIdRef.current = "";
    setLiveSession(null);
    if (!sessionId) return;
    await api.stopLiveVisionSession(sessionId);
  }, [clearLiveFrameLoop]);

  const sendLiveFrame = useCallback(
    async (sessionId) => {
      if (!sessionId || frameBusyRef.current || !cameraRef.current) return;
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
            setCaptureMode("photo");
            setMessage(
              `Live preview unavailable on backend (${API_BASE_URL}). Deploy backend with /api/live-vision routes.`,
            );
            return;
          }
          setMessage(formatApiFailure("Live preview", response));
          return;
        }
        setAiSource(response.data?.source || "gemini_live");
        setAiMaterials(normalizeAiRows(response.data?.materials || []));
        if (response.data?.source === "gemini_live_demo") {
          const fallbackReason = String(response.data?.notes || "")
            .replace(/^Live fallback:\s*/i, "")
            .trim();
          const detail = fallbackReason ? ` (${fallbackReason})` : "";
          setMessage(`Live AI fallback mode active${detail}. You can still add/edit materials manually.`);
        } else {
          setMessage("Live AI preview active.");
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
    [normalizeAiRows, stopLivePreview],
  );

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
        setCaptureMode("photo");
        setMessage(
          `Live session start failed: backend missing /api/live-vision routes at ${API_BASE_URL}.`,
        );
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
      setAiSource(start.data?.source_mode || "");
      await sendLiveFrame(sessionId);
      clearLiveFrameLoop();
      frameLoopRef.current = setInterval(() => {
        sendLiveFrame(sessionId);
      }, LIVE_PREVIEW_FRAME_INTERVAL_MS);
    } catch (error) {
      setMessage(`Live session start failed: ${error?.message || "Unknown error"}`);
      await api.stopLiveVisionSession(sessionId);
      liveSessionIdRef.current = "";
      setLiveSession(null);
      setLiveRunning(false);
    } finally {
      setStartingLive(false);
    }
  }, [
    cameraPermission,
    cameraReady,
    clearLiveFrameLoop,
    liveRunning,
    requestCameraPermission,
    sendLiveFrame,
    startingLive,
  ]);

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
    setMessage("AI suggestion locks reset. You can restart live preview to refill suggestions.");
  };

  const submitListing = async () => {
    if (!form.household_name.trim() || !form.address.trim()) {
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
    setForm({
      listing_kind: "household",
      household_name: "",
      address: "",
      phone: "",
      notes: "",
    });
    setImageUri("");
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

        <TextInput
          value={form.household_name}
          onChangeText={(text) => setForm((prev) => ({ ...prev, household_name: text }))}
          placeholder="Name"
          style={styles.input}
        />
        <TextInput
          value={form.address}
          onChangeText={(text) => setForm((prev) => ({ ...prev, address: text }))}
          placeholder="Address"
          style={styles.input}
        />
        <TextInput
          value={form.phone}
          onChangeText={(text) => setForm((prev) => ({ ...prev, phone: text }))}
          placeholder="Phone"
          style={styles.input}
        />
        <TextInput
          value={form.notes}
          onChangeText={(text) => setForm((prev) => ({ ...prev, notes: text }))}
          placeholder="Notes"
          multiline
          style={[styles.input, styles.multiline]}
        />
      </Card>

      <Card>
        <Text style={styles.subTitle}>AI Classify (Photo)</Text>
        <View style={styles.captureModeRow}>
          {["photo", "live"].map((mode) => (
            <Pressable
              key={mode}
              style={[
                styles.captureModeToggle,
                captureMode === mode ? styles.captureModeToggleActive : null,
                mode === "live" && !liveSupported ? styles.captureModeToggleDisabled : null,
              ]}
              onPress={() => {
                if (mode === "live" && !liveSupported) return;
                setCaptureMode(mode);
              }}
            >
              <Text style={captureMode === mode ? styles.captureModeTextActive : styles.captureModeText}>
                {mode === "photo" ? "Photo Upload" : liveSupported ? "Live AI Preview" : "Live AI (Unavailable)"}
              </Text>
            </Pressable>
          ))}
        </View>

        {captureMode === "photo" ? (
          <>
            {imageUri ? <Image source={{ uri: imageUri }} style={styles.preview} /> : null}
            <PrimaryButton
              title={loadingClassify ? "Classifying..." : "Pick Image and Classify"}
              onPress={pickAndClassifyImage}
              loading={loadingClassify}
              disabled={loadingClassify}
            />
          </>
        ) : (
          <>
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
                  loadingClassify ||
                  startingLive ||
                  (cameraPermission?.granted && !cameraReady && !liveRunning)
                }
              />
              <SecondaryButton title="Reset AI Suggestions" onPress={resetAiSuggestions} />
            </View>
            <Text style={styles.liveHint}>
              Frame cadence: {LIVE_PREVIEW_FRAME_INTERVAL_MS}ms. Manual edits lock types from AI overwrite.
            </Text>
          </>
        )}
        {aiMaterials.length ? (
          <View style={styles.materialList}>
            <Text style={styles.sourceTag}>Source: {aiSource || "unknown"}</Text>
            {aiMaterials.map((m, idx) => (
              <Text style={styles.materialRow} key={`${m.type}-${idx}`}>
                {materials[m.type]?.emoji || "♻️"} {m.type} - {Number(m.lbs).toFixed(1)} lbs
              </Text>
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
                {materials[key]?.emoji || "♻️"} {key}
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
            style={[styles.input, styles.inlineInput]}
          />
          <PrimaryButton title="Add" onPress={addManualRow} />
        </View>
        {manualRows.map((row) => (
          <View key={row.id} style={styles.manualRow}>
            <Text style={styles.manualText}>
              {materials[row.type]?.emoji || "♻️"} {row.type} - {row.lbs.toFixed(1)} lbs
            </Text>
            <TextInput
              value={String(row.lbs)}
              onChangeText={(text) => updateManualRowLbs(row.id, text)}
              keyboardType="decimal-pad"
              style={styles.manualLbsInput}
            />
            <SecondaryButton title="Remove" onPress={() => removeManualRow(row.id)} />
          </View>
        ))}
      </Card>

      {message ? <Text style={styles.message}>{message}</Text> : null}
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
    padding: 14,
    paddingBottom: 120,
    backgroundColor: colors.bg,
  },
  label: {
    color: colors.ink,
    marginBottom: 8,
    fontWeight: "700",
  },
  toggleRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 10,
  },
  toggle: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
    backgroundColor: "#FCFBF6",
  },
  toggleActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  toggleText: { color: colors.ink, fontWeight: "600" },
  toggleTextActive: { color: "#fff", fontWeight: "700" },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    marginBottom: 8,
    backgroundColor: "#fff",
  },
  multiline: {
    minHeight: 70,
    textAlignVertical: "top",
  },
  subTitle: {
    fontWeight: "700",
    color: colors.ink,
    marginBottom: 10,
  },
  preview: {
    width: "100%",
    height: 170,
    borderRadius: 12,
    marginBottom: 10,
  },
  cameraPreview: {
    width: "100%",
    height: 220,
    borderRadius: 12,
    marginBottom: 10,
    overflow: "hidden",
  },
  captureModeRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 10,
  },
  captureModeToggle: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 8,
    alignItems: "center",
    backgroundColor: "#fff",
  },
  captureModeToggleActive: {
    backgroundColor: "#EAF8F3",
    borderColor: colors.primary,
  },
  captureModeToggleDisabled: {
    opacity: 0.5,
  },
  captureModeText: {
    color: colors.ink,
    fontSize: 12,
    fontWeight: "600",
  },
  captureModeTextActive: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: "700",
  },
  permissionBox: {
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 10,
    backgroundColor: "#fff",
  },
  permissionText: {
    color: colors.ink,
    marginBottom: 8,
    fontSize: 12,
  },
  liveButtonRow: {
    gap: 8,
  },
  liveHint: {
    marginTop: 8,
    color: colors.muted,
    fontSize: 11,
  },
  materialList: {
    marginTop: 10,
    gap: 4,
  },
  sourceTag: {
    color: colors.muted,
    marginBottom: 4,
    fontSize: 11,
    fontWeight: "600",
  },
  materialRow: {
    color: colors.ink,
    fontSize: 13,
  },
  horizontalList: {
    marginBottom: 8,
  },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    paddingVertical: 7,
    paddingHorizontal: 10,
    marginRight: 8,
    backgroundColor: "#fff",
  },
  chipActive: {
    borderColor: colors.primary,
    backgroundColor: "#EAF8F3",
  },
  chipText: { color: colors.ink, fontSize: 12 },
  chipTextActive: { color: colors.primary, fontSize: 12, fontWeight: "700" },
  inlineInputs: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  inlineInput: {
    flex: 1,
    marginBottom: 0,
  },
  manualRow: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  manualText: {
    flex: 1,
    marginRight: 8,
    color: colors.ink,
    fontSize: 13,
  },
  manualLbsInput: {
    width: 64,
    marginRight: 6,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: "#fff",
    fontSize: 12,
  },
  message: {
    marginBottom: 8,
    color: colors.ink,
    fontSize: 13,
  },
});
