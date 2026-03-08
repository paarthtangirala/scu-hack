import ExpoModulesCore

private let pluginName = "bin2bucksDetectObjects"

public final class LiveVisionPipelineModule: Module {
  public func definition() -> ModuleDefinition {
    Name("LiveVisionPipeline")

    Function("getCapabilities") {
      return [
        "is_native_module": true,
        "supports_native_pipeline": true,
        "supports_frame_processor": true,
        "supported_platforms": ["ios"],
        "plugin_name": pluginName,
        "transport_mode_hint": "direct_native_live",
      ]
    }

    Function("getPluginName") {
      return pluginName
    }
  }
}
