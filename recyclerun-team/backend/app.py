"""
Bin2Bucks Flask application entry point.
"""
import os
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask
from flask_cors import CORS
from backend.routes import listings_bp, classify_bp, optimize_bp, impact_bp, live_vision_bp

def create_app():
    # Load .env from repo root by default so API keys work in hackathon demos.
    repo_root = Path(__file__).resolve().parents[1]
    load_dotenv(repo_root / ".env")
    load_dotenv(repo_root / ".env.local")
    load_dotenv(repo_root / "backend" / ".env")

    app = Flask(__name__)
    CORS(app)
    app.register_blueprint(listings_bp)
    app.register_blueprint(classify_bp)
    app.register_blueprint(optimize_bp)
    app.register_blueprint(impact_bp)
    app.register_blueprint(live_vision_bp)
    return app

if __name__ == "__main__":
    app = create_app()
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", "5050"))
    debug = os.getenv("FLASK_DEBUG", "0") == "1"
    print(f"♻️  Bin2Bucks backend — http://{host}:{port}")
    app.run(host=host, port=port, debug=debug)
