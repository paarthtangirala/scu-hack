"""
WSGI entrypoint for production servers (gunicorn/uwsgi).
"""
from backend.app import create_app

app = create_app()

