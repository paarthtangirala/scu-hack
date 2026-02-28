"""
RecycleRun Flask application entry point.
"""
from flask import Flask
from flask_cors import CORS
from backend.routes import listings_bp, classify_bp, optimize_bp, impact_bp

def create_app():
    app = Flask(__name__)
    CORS(app)
    app.register_blueprint(listings_bp)
    app.register_blueprint(classify_bp)
    app.register_blueprint(optimize_bp)
    app.register_blueprint(impact_bp)
    return app

if __name__ == "__main__":
    app = create_app()
    print("♻️  RecycleRun backend — http://localhost:5000")
    app.run(debug=True, port=5000)
