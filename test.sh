#!/usr/bin/env bash
# Runs the same checks as the "test" job on GitHub (.github/workflows/ci.yml), on your laptop, inside Docker.
# Nothing is installed on your laptop: a throwaway Python container is started, used and deleted.
# How to use (in Git Bash, in the project folder):   ./test.sh
# Green ends with "3 passed". Red shows the file and line that broke.
# Keep the Python, pytest and ruff versions here the same as in .github/workflows/ci.yml.

# Work from the project folder, wherever the script is started from.
cd "$(dirname "$0")" || exit 1

# Git Bash would turn /src into a Windows path like C:/Program Files/Git/src; this stops that.
export MSYS_NO_PATHCONV=1

# The project folder is shared read-only (:ro), so the checks can never change your files.
# The project folder as Docker Desktop understands it: D:/projects/... in Git Bash, the normal path elsewhere.
PROJECT=$(pwd -W 2>/dev/null || pwd)

echo "--- installing packages inside Docker (about 1 minute, nothing prints while it works) ---"

docker run --rm \
  -e PYTHONDONTWRITEBYTECODE=1 \
  -v "$PROJECT:/src:ro" -w /src \
  python:3.13.5-slim \
  sh -c "pip install -q --root-user-action=ignore --disable-pip-version-check -r requirements.txt pytest==8.4.2 ruff==0.13.0 \
         && echo '--- ruff: looking for code errors ---' \
         && ruff check --no-cache --select E9,F63,F7,F82 . \
         && echo '--- pytest: running the tests ---' \
         && python -m pytest -v -p no:cacheprovider"
