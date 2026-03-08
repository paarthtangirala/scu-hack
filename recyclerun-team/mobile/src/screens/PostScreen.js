import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { Card, PrimaryButton, SectionTitle, SecondaryButton, colors } from "../components/ui";
import { LIVE_PREVIEW_FRAME_INTERVAL_MS } from "../config";
import { LiveScanPanel } from "../components/live/LiveScanPanel";
import { useLiveVisionController } from "../hooks/useLiveVisionController";
import { api } from "../services/api";
import { FALLBACK_MATERIALS } from "../services/materialsFallback";

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
  const [manualRows, setManualRows] = useState([]);
  const [lockedTypes, setLockedTypes] = useState([]);
  const [manualType, setManualType] = useState("cardboard");
  const [manualLbs, setManualLbs] = useState("");
  const [loadingSubmit, setLoadingSubmit] = useState(false);
  const [liveScanVisible, setLiveScanVisible] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const cameraSurfaceRef = useRef(null);

  const materialKeys = useMemo(() => Object.keys(materials), [materials]);

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

  const upsertManualLock = useCallback((type) => {
    const normalized = String(type || "").trim();
    if (!normalized) return;
    setLockedTypes((prev) => (prev.includes(normalized) ? prev : [...prev, normalized]));
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
  const addSuggestedManualRow = useCallback((suggestion) => {
    const lbs = normalizeLiveDetectionLbs(suggestion?.lbs, suggestion?.count);
    if (!suggestion?.type || lbs <= 0) return;
    upsertManualLock(suggestion.type);
    setManualRows((prev) => {
      const existingIdx = prev.findIndex((row) => row.type === suggestion.type);
      if (existingIdx === -1) {
        return [
          ...prev,
          {
            id: String(Date.now()),
            type: suggestion.type,
            lbs,
            count: normalizeLiveDetectionCount(suggestion.count),
          },
        ];
      }
      const next = prev.slice();
      const existing = next[existingIdx];
      next[existingIdx] = {
        ...existing,
        lbs: Math.round((Number(existing.lbs || 0) + lbs) * 10) / 10,
        count: normalizeLiveDetectionCount(existing.count) + normalizeLiveDetectionCount(suggestion.count),
      };
      return next;
    });
  }, [upsertManualLock]);

  const liveController = useLiveVisionController({
    cameraSurfaceRef,
    lockedTypes,
    profileId: profile?.id || "",
    onEditSuggestion: addSuggestedManualRow,
  });

  const aiMaterials = liveController.aiMaterials;
  const aiSource = liveController.aiSource;
  const lastSourceSessionId = liveController.sourceSessionId;
  const liveRunning = liveController.liveRunning;
  const startingLive = liveController.startingLive;
  const pendingDetection = liveController.pendingDetection;
  const pendingDetectionQueue = liveController.pendingDetectionQueue;
  const latestFrameDetections = liveController.latestFrameDetections;
  const activelyScanning = liveController.activelyScanning;
  const combinedMessage = liveController.message || message;

  const liveFlowStage = useMemo(() => {
    if (startingLive) return "starting";
    if (!liveRunning) return "idle";
    if (pendingDetection) return "review";
    return "scanning";
  }, [liveRunning, pendingDetection, startingLive]);

  const liveFlowMessage = useMemo(() => {
    if (liveFlowStage === "starting") return "Provisioning Live API token and opening direct AI stream.";
    if (liveFlowStage === "review") return "Review the stable suggestion. Camera preview stays live behind the review card.";
    if (liveController.controllerState === "degraded_fallback") return "Direct live path degraded. Using structured fallback mode.";
    if (liveFlowStage === "scanning") return "Streaming frames and waiting for a stable recyclable suggestion.";
    return "Tap Start Live Preview to begin guided scan mode.";
  }, [liveController.controllerState, liveFlowStage]);

  const resetAiSuggestions = useCallback(() => {
    setLockedTypes([]);
    liveController.reset();
    setMessage("AI suggestion locks reset. Restart live preview or continue editing manually.");
  }, [liveController]);

  const openLiveScanner = useCallback(() => {
    setLiveScanVisible(true);
  }, []);

  const closeLiveScanner = useCallback(() => {
    setLiveScanVisible(false);
    if (liveController.liveRunning || liveController.startingLive) {
      void liveController.stop("Live preview stopped.");
    }
  }, [liveController]);

  const liveStatusText = useMemo(() => {
    if (liveController.controllerState === "reconnecting") return "Reconnecting AI";
    if (liveController.controllerState === "tracking_only") return "Tracking only";
    if (liveController.controllerState === "degraded_fallback") return "Legacy fallback";
    if (pendingDetection) return "Review suggestion";
    if (activelyScanning) return "Scanning";
    return "Ready";
  }, [activelyScanning, liveController.controllerState, pendingDetection]);

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

    const estimatedRows = (aiMaterials.length ? aiMaterials : merged)
      .map((row) => ({ type: row.type, lbs: Number(row.lbs) }))
      .filter((row) => row.type && row.lbs > 0);
    const estimatedTotalLbs = Math.round(
      estimatedRows.reduce((sum, row) => sum + Number(row.lbs || 0), 0) * 10,
    ) / 10;
    const captureMode = aiSource ? "live_ai" : "manual";
    const estimatedConfidence = aiSource
      ? Math.round(
        ((aiMaterials.reduce((sum, row) => sum + Number(row.confidence || 0.82), 0) / Math.max(aiMaterials.length, 1)) || 0.82) * 100,
      ) / 100
      : 1.0;

    setLoadingSubmit(true);
    const response = await api.createListing({
      ...form,
      household_name: effectiveName,
      phone: effectivePhone,
      materials: merged,
      estimated_materials: estimatedRows,
      capture_mode: captureMode,
      source_session_id: lastSourceSessionId || "",
      estimated_total_lbs: estimatedTotalLbs,
      estimated_confidence: estimatedConfidence,
    });
    setLoadingSubmit(false);

    if (!response.ok) {
      setMessage(formatApiFailure("Post", response));
      return;
    }

    const geocode = response?.data?.listing?.geocode || {};
    if (geocode?.success) {
      setMessage(`Listing posted successfully (pinpointed via ${geocode.provider || "geocoder"})`);
    } else {
      setMessage("Listing posted successfully (using fallback coordinates)");
    }
    onListingPosted(response?.data?.listing?.id || "");
    setForm((prev) => ({
      listing_kind: prev.listing_kind,
      household_name: useProfileContact ? profileName : prev.household_name,
      address: "",
      phone: useProfileContact ? profilePhone : prev.phone,
      notes: "",
    }));
    setManualRows([]);
    setManualLbs("");
    setLockedTypes([]);
    liveController.reset();
    void liveController.stop("Listing posted. Live preview stopped.");
  };

  return (
    <>
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
        <View style={styles.liveButtonRow}>
          <PrimaryButton
            title={liveRunning ? "Return to Scanner" : "Open Live Scanner"}
            onPress={openLiveScanner}
          />
          <SecondaryButton title="Reset AI Suggestions" onPress={resetAiSuggestions} />
        </View>

        <Text style={styles.liveHint}>
          Native VisionCamera + ML Kit tracking runs first on dev builds. Legacy classification fallback remains available when native tracking or direct live transport is unavailable.
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
              <Text style={styles.flowPillText}>Review</Text>
            </View>
          </View>
          <Text style={styles.flowCaption}>{liveFlowMessage}</Text>
        </View>

        <View style={styles.liveSummaryCard}>
          <Text style={styles.liveSummaryTitle}>{liveStatusText}</Text>
          <Text style={styles.liveSummaryText}>
            {combinedMessage || "Live scanner uses native tracking when available, then falls back to structured backend modes."}
          </Text>
          <Text style={styles.liveSummaryMeta}>
            Transport {liveController.directAvailable ? "direct Gemini Live" : "legacy/demo"} · frame cadence fallback {LIVE_PREVIEW_FRAME_INTERVAL_MS}ms
          </Text>
        </View>

        {aiMaterials.length ? (
          <View style={styles.materialList}>
            <Text style={styles.sourceTag}>Source: {aiSource || "unknown"} · session {String(lastSourceSessionId || "").slice(0, 12) || "n/a"}</Text>
            {aiMaterials.map((m, idx) => (
              <View style={styles.materialRow} key={`${m.type}-${idx}`}>
                <Text style={styles.materialName}>
                  {materialDisplayName(materials, m.type)}
                  {Number(m.count || 1) > 1 ? ` x${Number(m.count || 1)}` : ""}
                </Text>
                <Text style={styles.materialWeight}>
                  {Number(m.lbs).toFixed(1)} lbs
                  {Number.isFinite(Number(m.confidence))
                    ? ` · ${Math.round(Number(m.confidence) * 100)}%`
                    : ""}
                </Text>
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
              <MaterialCommunityIcons name="delete-outline" size={20} color={colors.danger} />
            </Pressable>
          </View>
        ))}
      </Card>

      {combinedMessage ? (
        <View style={styles.messageBar}>
          <Text style={styles.message}>{combinedMessage}</Text>
        </View>
      ) : null}

      <PrimaryButton
        title={loadingSubmit ? "Posting..." : "Post Listing"}
        onPress={submitListing}
        loading={loadingSubmit}
        disabled={loadingSubmit}
      />
      </ScrollView>

      <LiveScanPanel
        visible={liveScanVisible}
        cameraSurfaceRef={cameraSurfaceRef}
        active={liveScanVisible && (liveRunning || startingLive || activelyScanning)}
        overlayTracks={liveController.overlayTracks}
        highlightedTrackId={liveController.highlightedTrackId}
        statusText={liveStatusText}
        flowMessage={liveFlowMessage}
        liveRunning={liveRunning}
        startingLive={startingLive}
        pendingDetection={pendingDetection ? {
          ...pendingDetection,
          label: materialDisplayName(materials, pendingDetection.type),
        } : null}
        pendingDetectionQueue={pendingDetectionQueue}
        latestFrameDetections={latestFrameDetections.map((row) => ({
          ...row,
          label: materialDisplayName(materials, row.type),
        }))}
        message={combinedMessage}
        onReadyChange={(ready, error) => {
          setCameraReady(Boolean(ready));
          if (!ready && error?.message) {
            setMessage(`Camera mount failed: ${error.message}`);
          }
        }}
        onNativeTracks={liveController.handleNativeTracks}
        onClose={closeLiveScanner}
        onStart={() => void liveController.start()}
        onStop={() => void liveController.stop("Live preview stopped.")}
        onReset={resetAiSuggestions}
        onConfirm={liveController.confirmPendingCandidate}
        onEdit={liveController.editPendingCandidate}
        onSkip={liveController.skipPendingCandidate}
      />
    </>
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
  liveSummaryCard: {
    marginTop: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    backgroundColor: "rgba(5, 19, 12, 0.72)",
  },
  liveSummaryTitle: {
    color: colors.ink,
    fontSize: 18,
    fontWeight: "800",
    marginBottom: 6,
  },
  liveSummaryText: {
    color: colors.ink,
    fontSize: 14,
    lineHeight: 21,
  },
  liveSummaryMeta: {
    marginTop: 8,
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "700",
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
