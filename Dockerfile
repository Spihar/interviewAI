# InterviewAI: one container running the FastAPI backend, which also serves the frontend pages.
# Build:  docker build -t interviewai .
# Run:    docker run --rm -p 8000:8000 -v "${PWD}/.env:/app/.env:ro" interviewai   (PowerShell; in cmd use %cd% instead of ${PWD})
# Then open http://localhost:8000. .env is mounted read-only when the container starts and is never copied into the image.
# It's mounted rather than passed with --env-file because --env-file keeps quotes around values (KEY="abc" stays "abc"),
# while load_dotenv() in the app strips them, exactly as it does on your laptop.

# Start from an official image that already has Python 3.13.5 installed (the same version as your laptop).
# The exact version is pinned so rebuilding next month gives the same Python, not whatever 3.13.x is newest.
# "slim" leaves out compilers and docs, so the image is a few hundred MB smaller.
FROM python:3.13.5-slim

# Don't write .pyc files, and print logs straight away so `docker logs` shows them live.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_ROOT_USER_ACTION=ignore

WORKDIR /app

# Install dependencies before copying the code. Docker caches each step, so editing server.py
# later doesn't re-run this slow pip install; it only re-runs when requirements.txt changes.
COPY requirements.txt .
RUN pip install -r requirements.txt

# Copy the app. .dockerignore keeps .env, venv/, exports/ and other local files out.
COPY . .

# Run as a normal user instead of root, so a bug in the app can't change the system files in the container.
# The code stays owned by root (read-only for the app); only temp/, where uploads are briefly saved, is writable.
RUN useradd --create-home --uid 10001 appuser \
    && mkdir -p temp \
    && chown appuser:appuser temp
USER appuser

# Documents the port the server listens on; `docker run -p` is what actually opens it.
EXPOSE 8000

# Docker calls /health every 30 seconds and marks the container unhealthy if it stops answering.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3)"

# --host 0.0.0.0 accepts connections from outside the container (127.0.0.1 would only allow the container itself).
# When Caddy is added in front for HTTPS, add --proxy-headers with --forwarded-allow-ips set to Caddy's address,
# so the app sees the real https address. Trusting those headers from everyone ("*") would let anyone fake them.
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]
