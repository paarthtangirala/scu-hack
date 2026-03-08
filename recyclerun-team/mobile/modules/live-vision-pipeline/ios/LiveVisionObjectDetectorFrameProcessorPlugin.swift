import Foundation
import MLKitObjectDetection
import MLKitVision
import VisionCamera

private final class LiveVisionTrackState {
  var firstSeenMs: Double
  var lastSeenMs: Double
  var stableSinceMs: Double
  var stableFrames: Int
  var lastRect: CGRect

  init(firstSeenMs: Double, lastSeenMs: Double, stableSinceMs: Double, stableFrames: Int, lastRect: CGRect) {
    self.firstSeenMs = firstSeenMs
    self.lastSeenMs = lastSeenMs
    self.stableSinceMs = stableSinceMs
    self.stableFrames = stableFrames
    self.lastRect = lastRect
  }
}

@objc(LiveVisionObjectDetectorFrameProcessorPlugin)
public final class LiveVisionObjectDetectorFrameProcessorPlugin: FrameProcessorPlugin {
  private let detector: ObjectDetector
  private var histories: [String: LiveVisionTrackState] = [:]
  private let stableFramesThreshold: Int
  private let stableMsThreshold: Double
  private let motionThreshold: Double

  public override init(proxy: VisionCameraProxyHolder, options: [AnyHashable: Any]? = nil) {
    let config = options ?? [:]
    stableFramesThreshold = max(1, (config["stableFramesThreshold"] as? NSNumber)?.intValue ?? 2)
    stableMsThreshold = max(100.0, (config["stableMsThreshold"] as? NSNumber)?.doubleValue ?? 900.0)
    motionThreshold = max(0.0, (config["motionThreshold"] as? NSNumber)?.doubleValue ?? 0.08)

    let detectorOptions = ObjectDetectorOptions()
    detectorOptions.detectorMode = .stream
    detectorOptions.shouldEnableMultipleObjects = true
    detectorOptions.shouldEnableClassification = true
    detector = ObjectDetector.objectDetector(options: detectorOptions)
    super.init(proxy: proxy, options: options)
  }

  public override func callback(_ frame: Frame!, withArguments arguments: [AnyHashable: Any]! = nil) -> Any! {
    let startedAt = CFAbsoluteTimeGetCurrent()
    let visionImage = VisionImage(buffer: frame.buffer)
    visionImage.orientation = frame.orientation
    let timestampMs = frame.timestamp / 1000.0
    let width = max(Double(frame.width), 1.0)
    let height = max(Double(frame.height), 1.0)

    let objects: [Object]
    do {
      objects = try detector.results(in: visionImage)
    } catch {
      objects = []
    }

    var activeTrackKeys = Set<String>()
    let detections: [[String: Any]] = objects.prefix(5).map { object in
      let trackKey = buildTrackKey(object)
      activeTrackKeys.insert(trackKey)
      let rect = object.frame
      let areaScore = max(0.0, min(1.0, (rect.width / CGFloat(width)) * (rect.height / CGFloat(height))))
      let history = histories[trackKey]
      let motionScore = history.map { calculateMotionScore(previous: $0.lastRect, current: rect, width: width, height: height) } ?? 0.0

      let nextHistory: LiveVisionTrackState
      if let history {
        if motionScore <= motionThreshold {
          history.stableFrames += 1
        } else {
          history.stableFrames = 1
          history.stableSinceMs = timestampMs
        }
        history.lastSeenMs = timestampMs
        history.lastRect = rect
        nextHistory = history
      } else {
        nextHistory = LiveVisionTrackState(
          firstSeenMs: timestampMs,
          lastSeenMs: timestampMs,
          stableSinceMs: timestampMs,
          stableFrames: 1,
          lastRect: rect
        )
      }
      histories[trackKey] = nextHistory

      let stableMs = max(0.0, timestampMs - nextHistory.stableSinceMs)
      let primaryLabel = object.labels.first
      return [
        "track_id": trackKey,
        "bbox_norm": [
          "x": max(0.0, min(1.0, rect.minX / CGFloat(width))),
          "y": max(0.0, min(1.0, rect.minY / CGFloat(height))),
          "width": max(0.0, min(1.0, rect.width / CGFloat(width))),
          "height": max(0.0, min(1.0, rect.height / CGFloat(height))),
        ],
        "first_seen_ms": nextHistory.firstSeenMs,
        "last_seen_ms": nextHistory.lastSeenMs,
        "stable_frames": nextHistory.stableFrames,
        "stable_ms": stableMs,
        "motion_score": max(0.0, min(1.0, motionScore)),
        "area_score": areaScore,
        "local_confidence": max(0.0, min(1.0, primaryLabel?.confidence ?? 0.0)),
        "coarse_label": primaryLabel?.text.lowercased() ?? "",
        "is_stable": nextHistory.stableFrames >= stableFramesThreshold && stableMs >= stableMsThreshold,
      ]
    }

    pruneInactiveTracks(activeTrackKeys: activeTrackKeys, nowMs: timestampMs)

    return [
      "timestamp_ms": timestampMs,
      "width": width,
      "height": height,
      "detector_latency_ms": (CFAbsoluteTimeGetCurrent() - startedAt) * 1000.0,
      "detections": detections,
    ]
  }

  private func buildTrackKey(_ object: Object) -> String {
    if object.trackingID != 0 {
      return "track_\(object.trackingID)"
    }
    let frame = object.frame
    let label = object.labels.first?.text.lowercased() ?? "object"
    return "track_\(label)_\(Int(frame.minX))_\(Int(frame.minY))_\(Int(frame.width))_\(Int(frame.height))"
  }

  private func calculateMotionScore(previous: CGRect, current: CGRect, width: Double, height: Double) -> Double {
    let prevCx = Double(previous.midX) / width
    let prevCy = Double(previous.midY) / height
    let currCx = Double(current.midX) / width
    let currCy = Double(current.midY) / height
    let centerDelta = hypot(currCx - prevCx, currCy - prevCy)
    let widthDelta = abs(Double(current.width - previous.width)) / width
    let heightDelta = abs(Double(current.height - previous.height)) / height
    return min(1.0, centerDelta + widthDelta + heightDelta)
  }

  private func pruneInactiveTracks(activeTrackKeys: Set<String>, nowMs: Double) {
    histories = histories.filter { key, value in
      activeTrackKeys.contains(key) || (nowMs - value.lastSeenMs) <= 2500.0
    }
  }
}
