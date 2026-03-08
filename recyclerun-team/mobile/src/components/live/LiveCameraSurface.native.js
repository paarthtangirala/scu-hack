import React, { forwardRef, useImperativeHandle, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Camera, runAtTargetFps, useCameraDevice, useCameraPermission, useFrameProcessor } from "react-native-vision-camera";
import { Worklets } from "react-native-worklets-core";
import * as FileSystem from "expo-file-system";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";

import { colors } from "../ui";
import { createLiveVisionFrameProcessorPlugin, getLiveVisionPipelineCapabilities } from "../../services/liveVisionNativePipeline";

const DEFAULT_PROCESSOR_OPTIONS = {
  stableFramesThreshold: 2,
  stableMsThreshold: 900,
  motionThreshold: 0.08,
};

function clamp01(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(1, parsed));
}

function withFileScheme(path) {
  if (!path) return "";
  return String(path).startsWith("file://") ? String(path) : `file://${path}`;
}

function expandBBox(bboxNorm, ratio = 0.18) {
  const bbox = bboxNorm && typeof bboxNorm === "object" ? bboxNorm : {};
  const width = clamp01(bbox.width);
  const height = clamp01(bbox.height);
  const x = clamp01(bbox.x);
  const y = clamp01(bbox.y);
  const padX = width * ratio;
  const padY = height * ratio;
  const nextX = Math.max(0, x - padX);
  const nextY = Math.max(0, y - padY);
  const nextWidth = Math.min(1 - nextX, width + padX * 2);
  const nextHeight = Math.min(1 - nextY, height + padY * 2);
  return { x: nextX, y: nextY, width: nextWidth, height: nextHeight };
}

async function cropToBase64(uri, imageSize, bboxNorm) {
  const width = Math.max(1, Number(imageSize?.width || 1));
  const height = Math.max(1, Number(imageSize?.height || 1));
  const bbox = expandBBox(bboxNorm, 0);
  const cropWidth = Math.max(32, Math.round(width * clamp01(bbox.width)));
  const cropHeight = Math.max(32, Math.round(height * clamp01(bbox.height)));
  const originX = Math.max(0, Math.min(width - cropWidth, Math.round(width * clamp01(bbox.x))));
  const originY = Math.max(0, Math.min(height - cropHeight, Math.round(height * clamp01(bbox.y))));
  const result = await manipulateAsync(
    uri,
    [{ crop: { originX, originY, width: cropWidth, height: cropHeight } }],
    { compress: 0.82, format: SaveFormat.JPEG, base64: true },
  );
  return result?.base64 || "";
}

export const LiveCameraSurface = forwardRef(function LiveCameraSurface(
  {
    active = false,
    overlayTracks = [],
    highlightedTrackId = "",
    processorOptions = DEFAULT_PROCESSOR_OPTIONS,
    processorFps = 6,
    onReadyChange = () => {},
    onNativeTracks = () => {},
    statusText = "",
  },
  ref,
) {
  const device = useCameraDevice("back");
  const { hasPermission, requestPermission } = useCameraPermission();
  const cameraRef = useRef(null);
  const [isReady, setIsReady] = useState(false);
  const capabilities = useMemo(() => getLiveVisionPipelineCapabilities(), []);
  const plugin = useMemo(
    () => createLiveVisionFrameProcessorPlugin(DEFAULT_PROCESSOR_OPTIONS),
    [],
  );
  const runTracksOnJS = useMemo(
    () =>
      Worklets.createRunOnJS((payload) => {
        onNativeTracks?.(payload);
      }),
    [onNativeTracks],
  );

  const frameProcessor = useFrameProcessor(
    (frame) => {
      "worklet";
      if (!plugin) {
        return;
      }
      runAtTargetFps(Math.max(1, Number(processorFps || 6)), () => {
        const payload = plugin.call(frame, processorOptions || DEFAULT_PROCESSOR_OPTIONS);
        if (payload) {
          runTracksOnJS(payload);
        }
      });
    },
    [plugin, processorFps, processorOptions, runTracksOnJS],
  );

  useImperativeHandle(
    ref,
    () => ({
      async ensurePermission() {
        if (hasPermission) return { granted: true };
        const granted = await requestPermission();
        return { granted: Boolean(granted) };
      },
      isReady() {
        return isReady;
      },
      supportsNativeTracking() {
        return Boolean(capabilities.supports_native_pipeline && plugin);
      },
      async captureCandidateFrame({ bboxNorm }) {
        if (!cameraRef.current) {
          throw new Error("Live camera is not ready");
        }
        const snapshot = await cameraRef.current.takeSnapshot({ quality: 90 });
        const snapshotUri = withFileScheme(snapshot?.path);
        const contextBbox = expandBBox(bboxNorm, 0.22);
        const roiBase64 = bboxNorm
          ? await cropToBase64(snapshotUri, snapshot, bboxNorm)
          : await FileSystem.readAsStringAsync(snapshotUri, { encoding: FileSystem.EncodingType.Base64 });
        const contextBase64 = bboxNorm
          ? await cropToBase64(snapshotUri, snapshot, contextBbox)
          : roiBase64;
        return {
          mime_type: "image/jpeg",
          captured_at_ms: Date.now(),
          full_frame_uri: snapshotUri,
          roi_jpeg_base64: roiBase64,
          context_jpeg_base64: contextBase64,
          width: Number(snapshot?.width || 0),
          height: Number(snapshot?.height || 0),
        };
      },
      async captureLegacyFrame() {
        if (!cameraRef.current) {
          throw new Error("Live camera is not ready");
        }
        const snapshot = await cameraRef.current.takeSnapshot({ quality: 82 });
        const snapshotUri = withFileScheme(snapshot?.path);
        const base64 = await FileSystem.readAsStringAsync(snapshotUri, { encoding: FileSystem.EncodingType.Base64 });
        return {
          mime_type: "image/jpeg",
          frame_base64: base64,
          width: Number(snapshot?.width || 0),
          height: Number(snapshot?.height || 0),
        };
      },
    }),
    [capabilities.supports_native_pipeline, hasPermission, isReady, plugin, requestPermission],
  );

  if (!device) {
    return (
      <View style={styles.unavailable}>
        <Text style={styles.unavailableText}>No rear camera device is available on this build.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {hasPermission ? (
        <Camera
          ref={cameraRef}
          style={styles.camera}
          device={device}
          isActive={active}
          photo
          video
          pixelFormat="yuv"
          frameProcessor={active && plugin ? frameProcessor : undefined}
          onInitialized={() => {
            setIsReady(true);
            onReadyChange?.(true);
          }}
          onError={(error) => {
            setIsReady(false);
            onReadyChange?.(false, error);
          }}
        />
      ) : (
        <View style={styles.unavailable}>
          <Text style={styles.unavailableText}>Camera permission is required for live AI scan.</Text>
        </View>
      )}
      <View pointerEvents="none" style={styles.overlay}>
        {Array.isArray(overlayTracks)
          ? overlayTracks.map((track) => {
            const bbox = track?.bbox_norm || {};
            return (
              <View
                key={String(track?.track_id || Math.random())}
                style={[
                  styles.trackBox,
                  highlightedTrackId && highlightedTrackId === track?.track_id ? styles.trackBoxHighlighted : null,
                  {
                    left: `${clamp01(bbox.x) * 100}%`,
                    top: `${clamp01(bbox.y) * 100}%`,
                    width: `${clamp01(bbox.width) * 100}%`,
                    height: `${clamp01(bbox.height) * 100}%`,
                  },
                ]}
              >
                <Text style={styles.trackLabel}>
                  {track?.coarse_label || "candidate"} · {Math.round(clamp01(track?.local_confidence) * 100)}%
                </Text>
              </View>
            );
          })
          : null}
        {statusText ? (
          <View style={styles.statusBadge}>
            <Text style={styles.statusText}>{statusText}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    borderRadius: 24,
    overflow: "hidden",
    minHeight: 420,
    backgroundColor: "#02110A",
  },
  camera: {
    minHeight: 420,
  },
  unavailable: {
    minHeight: 320,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    backgroundColor: "#03120C",
  },
  unavailableText: {
    color: colors.ink,
    fontSize: 16,
    lineHeight: 22,
    textAlign: "center",
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
  },
  trackBox: {
    position: "absolute",
    borderWidth: 2,
    borderColor: "rgba(0,232,122,0.82)",
    backgroundColor: "rgba(0,232,122,0.08)",
    borderRadius: 16,
  },
  trackBoxHighlighted: {
    borderColor: "#F5A623",
    backgroundColor: "rgba(245,166,35,0.12)",
  },
  trackLabel: {
    position: "absolute",
    top: -2,
    left: -2,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderTopLeftRadius: 14,
    borderBottomRightRadius: 14,
    backgroundColor: "rgba(0,0,0,0.72)",
    color: "#F4FFF7",
    fontSize: 11,
    fontWeight: "800",
  },
  statusBadge: {
    position: "absolute",
    top: 14,
    left: 14,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "rgba(2,17,10,0.82)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  statusText: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: "700",
  },
});
