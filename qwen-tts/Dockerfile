FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
        libsndfile1 sox ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# PyTorch : « cpu » (image légère) ou « cu128 » pour les GPU NVIDIA, cartes
# RTX 50xx (Blackwell) comprises. torch et torchaudio doivent avoir la même
# version, sinon torchaudio ne se charge pas.
ARG TORCH_VARIANT=cpu
RUN pip install --no-cache-dir torch==2.8.0 torchaudio==2.8.0 \
        --index-url https://download.pytorch.org/whl/${TORCH_VARIANT}
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Modèles téléchargés au build : aucun accès réseau au premier rendu.
# CustomVoice : voix prédéfinies pilotées par une consigne (ton, émotion).
# Base : clonage d'une voix de référence (voices/*.wav), chargé seulement s'il y en a.
ARG QWEN_TTS_MODEL=Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice
ARG QWEN_TTS_CLONE_MODEL=Qwen/Qwen3-TTS-12Hz-0.6B-Base
ENV QWEN_TTS_MODEL=${QWEN_TTS_MODEL} \
    QWEN_TTS_CLONE_MODEL=${QWEN_TTS_CLONE_MODEL} \
    HF_HOME=/opt/hf-cache \
    HOME=/tmp
RUN python -c "from huggingface_hub import snapshot_download as d; d('${QWEN_TTS_MODEL}'); d('${QWEN_TTS_CLONE_MODEL}') if '${QWEN_TTS_CLONE_MODEL}' else None"
ENV HF_HUB_OFFLINE=1

COPY main.py .
COPY voices ./voices

EXPOSE 8001

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"]
