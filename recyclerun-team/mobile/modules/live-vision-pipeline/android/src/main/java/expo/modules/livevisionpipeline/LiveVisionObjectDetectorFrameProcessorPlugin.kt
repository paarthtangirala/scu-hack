package expo.modules.livevisionpipeline

import android.graphics.Rect
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.objects.DetectedObject
import com.google.mlkit.vision.objects.ObjectDetection
import com.google.mlkit.vision.objects.defaults.ObjectDetectorOptions
import com.mrousavy.camera.frameprocessors.Frame
import com.mrousavy.camera.frameprocessors.FrameProcessorPlugin
import kotlin.math.abs
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min

private data class TrackHistory(
  var firstSeenMs: Long,
  var lastSeenMs: Long,
  var stableSinceMs: Long,
  var stableFrames: Int,
  var lastRect: Rect
)

class LiveVisionObjectDetectorFrameProcessorPlugin(
  options: Map<String, Any>? = null
) : FrameProcessorPlugin() {
  private val detector = ObjectDetection.getClient(
    ObjectDetectorOptions.Builder()
      .setDetectorMode(ObjectDetectorOptions.STREAM_MODE)
      .enableMultipleObjects()
      .enableClassification()
      .build()
  )
  private val histories = LinkedHashMap<String, TrackHistory>()
  private val stableFramesThreshold = ((options?.get("stableFramesThreshold") as? Number)?.toInt() ?: 2).coerceAtLeast(1)
  private val stableMsThreshold = ((options?.get("stableMsThreshold") as? Number)?.toLong() ?: 900L).coerceAtLeast(100L)
  private val motionThreshold = ((options?.get("motionThreshold") as? Number)?.toDouble() ?: 0.08).coerceAtLeast(0.0)

  override fun callback(frame: Frame, params: Map<String, Any>?): Any {
    val startedAtNs = System.nanoTime()
    val image = frame.image
    val imageProxy = frame.imageProxy
    val inputImage = InputImage.fromMediaImage(image, imageProxy.imageInfo.rotationDegrees)
    val frameTimestampMs = frame.timestamp / 1_000_000.0
    val width = frame.width.toDouble().coerceAtLeast(1.0)
    val height = frame.height.toDouble().coerceAtLeast(1.0)

    val detectedObjects = try {
      Tasks.await(detector.process(inputImage))
    } catch (_: Throwable) {
      emptyList<DetectedObject>()
    }

    val activeKeys = HashSet<String>()
    val detections = detectedObjects.take(5).map { detectedObject ->
      val trackKey = buildTrackKey(detectedObject)
      activeKeys.add(trackKey)
      val rect = detectedObject.boundingBox
      val areaScore = ((rect.width().toDouble() / width) * (rect.height().toDouble() / height)).coerceIn(0.0, 1.0)
      val history = histories[trackKey]
      val motionScore = history?.let { calculateMotionScore(it.lastRect, rect, width, height) } ?: 0.0
      val nowMs = frameTimestampMs.toLong()
      val nextHistory = if (history == null) {
        TrackHistory(
          firstSeenMs = nowMs,
          lastSeenMs = nowMs,
          stableSinceMs = nowMs,
          stableFrames = 1,
          lastRect = Rect(rect)
        )
      } else {
        if (motionScore <= motionThreshold) {
          history.stableFrames += 1
        } else {
          history.stableFrames = 1
          history.stableSinceMs = nowMs
        }
        history.lastSeenMs = nowMs
        history.lastRect = Rect(rect)
        history
      }
      histories[trackKey] = nextHistory

      val stableMs = max(0L, nowMs - nextHistory.stableSinceMs)
      val primaryLabel = detectedObject.labels.firstOrNull()
      mapOf(
        "track_id" to trackKey,
        "bbox_norm" to mapOf(
          "x" to (rect.left.toDouble() / width).coerceIn(0.0, 1.0),
          "y" to (rect.top.toDouble() / height).coerceIn(0.0, 1.0),
          "width" to (rect.width().toDouble() / width).coerceIn(0.0, 1.0),
          "height" to (rect.height().toDouble() / height).coerceIn(0.0, 1.0),
        ),
        "first_seen_ms" to nextHistory.firstSeenMs.toDouble(),
        "last_seen_ms" to nextHistory.lastSeenMs.toDouble(),
        "stable_frames" to nextHistory.stableFrames.toDouble(),
        "stable_ms" to stableMs.toDouble(),
        "motion_score" to motionScore.coerceIn(0.0, 1.0),
        "area_score" to areaScore,
        "local_confidence" to ((primaryLabel?.confidence ?: 0.0f).toDouble()).coerceIn(0.0, 1.0),
        "coarse_label" to ((primaryLabel?.text ?: "").lowercase()),
        "is_stable" to (nextHistory.stableFrames >= stableFramesThreshold && stableMs >= stableMsThreshold)
      )
    }

    pruneInactiveTracks(activeKeys, frameTimestampMs.toLong())

    val detectorLatencyMs = (System.nanoTime() - startedAtNs) / 1_000_000.0
    return mapOf(
      "timestamp_ms" to frameTimestampMs,
      "width" to width,
      "height" to height,
      "detector_latency_ms" to detectorLatencyMs,
      "detections" to detections
    )
  }

  private fun buildTrackKey(detectedObject: DetectedObject): String {
    val trackingId = detectedObject.trackingId
    if (trackingId != null) {
      return "track_$trackingId"
    }
    val rect = detectedObject.boundingBox
    val label = detectedObject.labels.firstOrNull()?.text?.lowercase() ?: "object"
    return "track_${label}_${rect.left}_${rect.top}_${rect.width()}_${rect.height()}"
  }

  private fun calculateMotionScore(previous: Rect, current: Rect, width: Double, height: Double): Double {
    val prevCx = previous.exactCenterX().toDouble() / width
    val prevCy = previous.exactCenterY().toDouble() / height
    val currCx = current.exactCenterX().toDouble() / width
    val currCy = current.exactCenterY().toDouble() / height
    val centerDelta = hypot(currCx - prevCx, currCy - prevCy)
    val widthDelta = abs(current.width().toDouble() - previous.width().toDouble()) / width
    val heightDelta = abs(current.height().toDouble() - previous.height().toDouble()) / height
    return min(1.0, centerDelta + widthDelta + heightDelta)
  }

  private fun pruneInactiveTracks(activeKeys: Set<String>, nowMs: Long) {
    val iterator = histories.entries.iterator()
    while (iterator.hasNext()) {
      val entry = iterator.next()
      if (!activeKeys.contains(entry.key) && nowMs - entry.value.lastSeenMs > 2_500L) {
        iterator.remove()
      }
    }
  }
}
