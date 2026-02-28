"""
AI image classification endpoint.
Owner: Atharva
"""
from flask import Blueprint, request, jsonify
from backend.services.vision import VisionClassifier
from backend.services.validation import validate_classify_payload
from backend.utils.http import error

classify_bp = Blueprint("classify", __name__, url_prefix="/api")
classifier = VisionClassifier()

@classify_bp.post("/classify")
def classify():
    image_b64, errors = validate_classify_payload(request.get_json(silent=True))
    if errors:
        return error(code="validation_error", message="Invalid classify payload", status=400, errors=errors)

    result = classifier.classify(image_b64)
    if not result:
        return error(code="classifier_failed", message="Vision classifier did not return a response", status=502)
    return jsonify(result), 200
