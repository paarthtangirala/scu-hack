import React from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { Card, PrimaryButton, SecondaryButton, colors } from "../ui";
import { LiveCameraSurface } from "./LiveCameraSurface";

function renderDetectionLabel(row) {
  if (!row) return "";
  const label = String(row.label || row.type || row.coarse_label || "candidate")
    .replace(/_/g, " ")
    .trim();
  const suffix = Number(row.count || 1) > 1 ? ` x${Number(row.count || 1)}` : "";
  return `${label}${suffix}`;
}

export function LiveScanPanel({
  visible = false,
  cameraSurfaceRef,
  active = false,
  overlayTracks = [],
  highlightedTrackId = "",
  statusText = "",
  flowMessage = "",
  liveRunning = false,
  startingLive = false,
  pendingDetection = null,
  pendingDetectionQueue = [],
  latestFrameDetections = [],
  message = "",
  onReadyChange = () => {},
  onNativeTracks = () => {},
  onClose = () => {},
  onStart = () => {},
  onStop = () => {},
  onReset = () => {},
  onConfirm = () => {},
  onEdit = () => {},
  onSkip = () => {},
}) {
  return (
    <Modal animationType="slide" presentationStyle="fullScreen" visible={visible} onRequestClose={onClose}>
      <View style={styles.screen}>
        <View style={styles.header}>
          <View>
            <Text style={styles.kicker}>Live Scan</Text>
            <Text style={styles.title}>Native AI Preview</Text>
          </View>
          <Pressable onPress={onClose} style={styles.closeButton}>
            <Text style={styles.closeButtonText}>Close</Text>
          </Pressable>
        </View>

        <LiveCameraSurface
          ref={cameraSurfaceRef}
          active={active}
          overlayTracks={overlayTracks}
          highlightedTrackId={highlightedTrackId}
          statusText={statusText}
          onReadyChange={onReadyChange}
          onNativeTracks={onNativeTracks}
        />

        <View style={styles.actions}>
          <PrimaryButton
            title={liveRunning ? "Stop Live Preview" : startingLive ? "Starting..." : "Start Live Preview"}
            onPress={liveRunning ? onStop : onStart}
            disabled={startingLive}
            loading={startingLive}
          />
          <SecondaryButton title="Reset AI Suggestions" onPress={onReset} />
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          <Card style={styles.infoCard}>
            <Text style={styles.infoTitle}>Scanner State</Text>
            <Text style={styles.infoText}>{flowMessage || "Open the live scanner to start tracking recyclable objects."}</Text>
          </Card>

          {pendingDetection ? (
            <Card style={styles.reviewCard}>
              <Text style={styles.reviewTitle}>Stable Candidate Ready</Text>
              <Text style={styles.reviewText}>
                {renderDetectionLabel(pendingDetection)} · {Number(pendingDetection.lbs || 0).toFixed(1)} lbs
              </Text>
              <Text style={styles.reviewText}>
                Confidence {Math.round(Number(pendingDetection.confidence || 0) * 100)}% · AI estimate, editable
              </Text>
              <Text style={styles.reviewTextMuted}>
                Queue {pendingDetectionQueue.length} more candidate{pendingDetectionQueue.length === 1 ? "" : "s"} pending
              </Text>
              <View style={styles.reviewActions}>
                <PrimaryButton title="Add" onPress={onConfirm} />
                <SecondaryButton title="Edit" onPress={onEdit} />
                <SecondaryButton title="Skip" onPress={onSkip} />
              </View>
            </Card>
          ) : null}

          {latestFrameDetections.length ? (
            <Card>
              <Text style={styles.infoTitle}>Latest Suggestions</Text>
              {latestFrameDetections.map((row, index) => (
                <Text key={`${row.type || row.track_id || "row"}-${index}`} style={styles.listRow}>
                  {renderDetectionLabel(row)} · {Number(row.lbs || 0).toFixed(1)} lbs
                </Text>
              ))}
            </Card>
          ) : null}

          {message ? (
            <Card>
              <Text style={styles.infoTitle}>Status</Text>
              <Text style={styles.infoText}>{message}</Text>
            </Card>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#041109",
    paddingTop: 58,
    paddingHorizontal: 16,
    paddingBottom: 20,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  kicker: {
    color: colors.muted,
    textTransform: "uppercase",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 2,
  },
  title: {
    marginTop: 6,
    color: colors.ink,
    fontSize: 32,
    fontWeight: "900",
  },
  closeButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: "rgba(11,24,16,0.85)",
  },
  closeButtonText: {
    color: colors.ink,
    fontWeight: "700",
  },
  actions: {
    marginTop: 14,
    gap: 10,
  },
  content: {
    paddingTop: 14,
    paddingBottom: 80,
  },
  infoCard: {
    marginBottom: 12,
  },
  infoTitle: {
    color: colors.ink,
    fontSize: 18,
    fontWeight: "800",
    marginBottom: 8,
  },
  infoText: {
    color: colors.ink,
    fontSize: 15,
    lineHeight: 22,
  },
  reviewCard: {
    marginBottom: 12,
    borderColor: "rgba(245,166,35,0.35)",
  },
  reviewTitle: {
    color: colors.ink,
    fontSize: 20,
    fontWeight: "900",
    marginBottom: 6,
  },
  reviewText: {
    color: colors.ink,
    fontSize: 15,
    lineHeight: 22,
  },
  reviewTextMuted: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 4,
  },
  reviewActions: {
    marginTop: 14,
    gap: 10,
  },
  listRow: {
    color: colors.ink,
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 6,
  },
});
