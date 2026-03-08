package expo.modules.livevisionpipeline

import com.mrousavy.camera.frameprocessors.FrameProcessorPluginRegistry
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private const val PLUGIN_NAME = "bin2bucksDetectObjects"

class LiveVisionPipelineModule : Module() {
  companion object {
    @Volatile
    private var pluginRegistered = false
  }

  override fun definition() = ModuleDefinition {
    Name("LiveVisionPipeline")

    OnCreate {
      if (!pluginRegistered) {
        FrameProcessorPluginRegistry.addFrameProcessorPlugin(PLUGIN_NAME) { _, options ->
          LiveVisionObjectDetectorFrameProcessorPlugin(options)
        }
        pluginRegistered = true
      }
    }

    Function("getCapabilities") {
      mapOf(
        "is_native_module" to true,
        "supports_native_pipeline" to true,
        "supports_frame_processor" to true,
        "supported_platforms" to listOf("android"),
        "plugin_name" to PLUGIN_NAME,
        "transport_mode_hint" to "direct_native_live"
      )
    }

    Function("getPluginName") {
      PLUGIN_NAME
    }
  }
}
