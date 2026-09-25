# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS node-runtime

FROM python:3.12-slim-bookworm AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DATA_DIR=/data

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# yt-dlp's current YouTube challenge support uses an external JS runtime.
COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node

WORKDIR /app
COPY server/requirements.txt /app/server/requirements.txt
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --disable-pip-version-check -r /app/server/requirements.txt

COPY server/ /app/server/
RUN useradd --uid 10001 --create-home --home-dir /home/appuser --shell /usr/sbin/nologin appuser \
    && mkdir -p /data \
    && chown appuser:appuser /data

USER appuser
EXPOSE 8000
CMD ["uvicorn", "server.app:app", "--host", "0.0.0.0", "--port", "8000"]
