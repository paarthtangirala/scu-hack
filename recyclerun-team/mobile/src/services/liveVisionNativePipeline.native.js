import LiveVisionPipelineModule from "../../modules/live-vision-pipeline";
import { VisionCameraProxy } from "react-native-vision-camera";

const DEFAULT_CAPABILITIES = {
  is_native_module: false,
  supports_native_pipeline: false,
  supports_frame_processor: false,
  supported_platforms: [],
  plugin_name: "bin2bucksDetectObjects",
  transport_mode_hint: "legacy_http_poll",
};

export function getLiveVisionPipelineCapabilities() {
  try {
    const next = LiveVisionPipelineModule?.getCapabilities?.();
    if (!next || typeof next !== "object") return DEFAULT_CAPABILITIES;
    return {
      ...DEFAULT_CAPABILITIES,
      ...next,
    };
  } catch {
    return DEFAULT_CAPABILITIES;
  }
}

export function getLiveVisionPluginName() {
  try {
    return String(
      LiveVisionPipelineModule?.getPluginName?.() ||
      getLiveVisionPipelineCapabilities().plugin_name ||
      DEFAULT_CAPABILITIES.plugin_name,
    );
  } catch {
    return DEFAULT_CAPABILITIES.plugin_name;
  }
}

export function createLiveVisionFrameProcessorPlugin(options = {}) {
  try {
    return VisionCameraProxy.initFrameProcessorPlugin(getLiveVisionPluginName(), options || {});
  } catch {
    return undefined;
  }
}

export function isNativeLiveVisionReady() {
  const capabilities = getLiveVisionPipelineCapabilities();
  return Boolean(capabilities.supports_native_pipeline && capabilities.supports_frame_processor);
}
