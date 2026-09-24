"""Configuration lue dans l'environnement."""

import os
from pathlib import Path

# Pas de clé par défaut : un service exposé avec une clé connue de tous
# n'est pas protégé. Le démarrage échoue si elle manque.
API_KEY = os.environ.get("API_KEY", "")

TEMP_DIR = Path(os.environ.get("TEMP_DIR", "/tmp/ffmpeg_processing"))

# Durée de conservation des fichiers produits (téléchargés par l'application
# puis supprimés ; la purge ne rattrape que les oublis).
FILE_TTL_SECONDS = int(os.environ.get("FILE_TTL_SECONDS", "3600"))

GEMINI_TTS_MODEL = os.environ.get("GEMINI_TTS_MODEL", "gemini-2.5-flash-preview-tts")

# Modèle Whisper utilisé pour caler les sous-titres sur la voix.
WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "base")
WHISPER_COMPUTE_TYPE = os.environ.get("WHISPER_COMPUTE_TYPE", "int8")

# Proxy sortant éventuel pour Edge TTS (aiohttp ne lit pas HTTPS_PROXY seul).
OUTBOUND_PROXY = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy") or None

# Rendu
WIDTH = 1080
HEIGHT = 1920
FPS = 30
# La voix démarre après ce délai (le temps de capter l'attention).
VOICE_DELAY = 2.0

SUBTITLE_FONT = os.environ.get("SUBTITLE_FONT", "Montserrat")
