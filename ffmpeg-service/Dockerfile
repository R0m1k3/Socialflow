FROM python:3.11-slim

# Polices des sous-titres (Montserrat) et des emojis, installées au build
# plutôt que téléchargées à chaque démarrage.
RUN apt-get update && apt-get install -y --no-install-recommends \
        wget xz-utils ca-certificates fontconfig \
        fonts-montserrat fonts-dejavu-core fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

# FFmpeg statique (vidstab, zimg pour le tone-mapping HDR, libass).
# Version épinglée : une mise à jour ne change plus le rendu à notre insu.
ARG FFMPEG_VERSION=7.0.2
RUN wget -q https://johnvansickle.com/ffmpeg/releases/ffmpeg-${FFMPEG_VERSION}-amd64-static.tar.xz \
        || wget -q https://johnvansickle.com/ffmpeg/old-releases/ffmpeg-${FFMPEG_VERSION}-amd64-static.tar.xz \
    && tar xf ffmpeg-${FFMPEG_VERSION}-amd64-static.tar.xz \
    && mv ffmpeg-*-amd64-static/ffmpeg ffmpeg-*-amd64-static/ffprobe /usr/local/bin/ \
    && rm -rf ffmpeg-* \
    && fc-cache -f

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Modèle Whisper (calage des sous-titres) téléchargé au build : aucun accès
# réseau nécessaire au premier rendu.
ARG WHISPER_MODEL=base
ENV WHISPER_MODEL=${WHISPER_MODEL} \
    HF_HOME=/opt/hf-cache \
    HOME=/tmp \
    XDG_CACHE_HOME=/tmp/.cache
RUN python -c "from faster_whisper import WhisperModel; WhisperModel('${WHISPER_MODEL}', device='cpu', compute_type='int8')"

COPY main.py .
COPY app ./app

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
