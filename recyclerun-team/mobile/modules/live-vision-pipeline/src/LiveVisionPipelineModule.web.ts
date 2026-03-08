import type { LiveVisionPipelineCapabilities } from "./LiveVisionPipeline.types";

const WEB_CAPABILITIES: LiveVisionPipelineCapabilities = {
  is_native_module: false,
  supports_native_pipeline: false,
  supports_frame_processor: false,
  supported_platforms: ["web"],
  plugin_name: "bin2bucksDetectObjects",
  transport_mode_hint: "legacy_http_poll",
};

export default {
  getCapabilities(): LiveVisionPipelineCapabilities {
    return WEB_CAPABILITIES;
  },
  getPluginName(): string {
    return WEB_CAPABILITIES.plugin_name;
  },
};
