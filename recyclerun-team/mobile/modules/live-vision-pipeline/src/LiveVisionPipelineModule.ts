import { NativeModule, requireNativeModule } from "expo";

import type { LiveVisionPipelineCapabilities, LiveVisionPipelineModuleEvents } from "./LiveVisionPipeline.types";

declare class LiveVisionPipelineModule extends NativeModule<LiveVisionPipelineModuleEvents> {
  getCapabilities(): LiveVisionPipelineCapabilities;
  getPluginName(): string;
}

export default requireNativeModule<LiveVisionPipelineModule>("LiveVisionPipeline");
