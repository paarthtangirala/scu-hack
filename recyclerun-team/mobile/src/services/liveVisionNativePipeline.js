const DEFAULT_CAPABILITIES = {
  is_native_module: false,
  supports_native_pipeline: false,
  supports_frame_processor: false,
  supported_platforms: ["web"],
  plugin_name: "bin2bucksDetectObjects",
  transport_mode_hint: "legacy_http_poll",
};

export function getLiveVisionPipelineCapabilities() {
  return DEFAULT_CAPABILITIES;
}

export function getLiveVisionPluginName() {
  return DEFAULT_CAPABILITIES.plugin_name;
}

export function createLiveVisionFrameProcessorPlugin() {
  return undefined;
}

export function isNativeLiveVisionReady() {
  return false;
}
