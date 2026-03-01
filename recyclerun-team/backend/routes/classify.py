"""
AI image classification endpoint.
Owner: Atharva
"""
import logging

from flask import Blueprint, request, jsonify
from backend.services.vision import VisionClassifier
from backend.services.validation import validate_classify_payload
from backend.utils.http import error

classify_bp = Blueprint("classify", __name__, url_prefix="/api")
classifier = VisionClassifier()
logger = logging.getLogger(__name__)

@classify_bp.post("/classify")
def classify():
    image_b64, errors = validate_classify_payload(request.get_json(silent=True))
    if errors:
        return error(code="validation_error", message="Invalid classify payload", status=400, errors=errors)

    try:
        result = classifier.classify(image_b64)
    except Exception as exc:  # defensive guard: keep errors machine-readable
        logger.exception("classify failed exception_type=%s", exc.__class__.__name__)
        return error(
            code="classifier_failed",
            message="Vision classifier did not return a response",
            status=502,
            errors=[{"field": "classifier", "message": "Internal classifier failure"}],
        )
    if not result:
        return error(code="classifier_failed", message="Vision classifier did not return a response", status=502)
    return jsonify(result), 200
