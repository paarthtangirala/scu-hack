"""
AI image classification endpoint.
Owner: Atharva
"""
from flask import Blueprint, request, jsonify
from backend.services.vision import VisionClassifier

classify_bp = Blueprint("classify", __name__, url_prefix="/api")
classifier = VisionClassifier()

@classify_bp.post("/classify")
def classify():
    data = request.json
    image_b64 = data.get("image_base64", "")
    if not image_b64:
        return jsonify({"error": "No image provided"}), 400
    if "," in image_b64:
        image_b64 = image_b64.split(",")[1]
    result = classifier.classify(image_b64)
    return jsonify(result)
