import React, { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";

import { colors } from "../ui";

export const LiveCameraSurface = forwardRef(function LiveCameraSurface(
  {
    active = false,
    onReadyChange = () => {},
  },
  ref,
) {
  const [permission, requestPermission] = useCameraPermissions();
  const [ready, setReady] = useState(false);
  const cameraRef = useRef(null);

  useImperativeHandle(ref, () => ({
    async ensurePermission() {
      if (permission?.granted) return { granted: true };
      const next = await requestPermission();
      return { granted: Boolean(next?.granted) };
    },
    isReady() {
      return ready;
    },
    supportsNativeTracking() {
      return false;
    },
    async captureCandidateFrame() {
      if (!cameraRef.current) {
        throw new Error("Fallback camera is not ready");
      }
      const photo = await cameraRef.current.takePictureAsync({
        base64: true,
        quality: 0.72,
        skipProcessing: true,
      });
      return {
        mime_type: "image/jpeg",
        captured_at_ms: Date.now(),
        full_frame_uri: photo?.uri || "",
        roi_jpeg_base64: photo?.base64 || "",
        context_jpeg_base64: photo?.base64 || "",
        width: Number(photo?.width || 0),
        height: Number(photo?.height || 0),
      };
    },
    async captureLegacyFrame() {
      if (!cameraRef.current) {
        throw new Error("Fallback camera is not ready");
      }
      const photo = await cameraRef.current.takePictureAsync({
        base64: true,
        quality: 0.62,
        skipProcessing: true,
      });
      return {
        mime_type: "image/jpeg",
        frame_base64: photo?.base64 || "",
        width: Number(photo?.width || 0),
        height: Number(photo?.height || 0),
      };
    },
  }), [permission?.granted, ready, requestPermission]);

  return (
    <View style={styles.container}>
      {permission?.granted ? (
        <CameraView
          ref={cameraRef}
          style={styles.camera}
          facing="back"
          active={active}
          onCameraReady={() => {
            setReady(true);
            onReadyChange?.(true);
          }}
          onMountError={(event) => {
            setReady(false);
            onReadyChange?.(false, event?.nativeEvent || null);
          }}
        />
      ) : (
        <View style={styles.permissionBox}>
          <Text style={styles.permissionText}>
            Native tracking is unavailable on this runtime. Grant camera access to use fallback capture mode.
          </Text>
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    borderRadius: 24,
    overflow: "hidden",
    minHeight: 320,
    backgroundColor: "#03120C",
  },
  camera: {
    minHeight: 320,
  },
  permissionBox: {
    minHeight: 320,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  permissionText: {
    color: colors.ink,
    textAlign: "center",
    fontSize: 16,
    lineHeight: 22,
  },
});
