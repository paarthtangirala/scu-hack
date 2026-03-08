export type LiveVisionBBoxNorm = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type LiveVisionTrackSummary = {
  track_id: string;
  bbox_norm: LiveVisionBBoxNorm;
  first_seen_ms: number;
  last_seen_ms: number;
  stable_frames: number;
  stable_ms: number;
  motion_score: number;
  area_score: number;
  local_confidence: number;
  coarse_label: string;
  is_stable: boolean;
};

export type LiveVisionDetectionsPayload = {
  timestamp_ms: number;
  width: number;
  height: number;
  detector_latency_ms: number;
  detections: LiveVisionTrackSummary[];
};

export type LiveVisionPipelineCapabilities = {
  is_native_module: boolean;
  supports_native_pipeline: boolean;
  supports_frame_processor: boolean;
  supported_platforms: string[];
  plugin_name: string;
  transport_mode_hint: string;
};

export type LiveVisionPipelineModuleEvents = Record<string, never>;
