"""Dossiers de travail des rendus et purge des fichiers oubliés."""

import re
import shutil
import time
import uuid
from pathlib import Path

from . import config

_SAFE_ID = re.compile(r"^[0-9a-f-]{36}$")
_SAFE_NAME = re.compile(r"^[\w.-]+$")


def new_job() -> tuple[str, Path]:
    job_id = str(uuid.uuid4())
    workdir = config.TEMP_DIR / job_id
    workdir.mkdir(parents=True)
    return job_id, workdir


def job_file(job_id: str, name: str) -> Path | None:
    """Fichier d'un job, ou None si l'identifiant ou le nom sont suspects."""
    if not _SAFE_ID.match(job_id) or not _SAFE_NAME.match(name):
        return None
    path = config.TEMP_DIR / job_id / name
    return path if path.is_file() else None


def remove_job(job_id: str) -> None:
    if _SAFE_ID.match(job_id):
        shutil.rmtree(config.TEMP_DIR / job_id, ignore_errors=True)


def purge_expired() -> int:
    """Supprime les dossiers plus vieux que FILE_TTL_SECONDS."""
    config.TEMP_DIR.mkdir(parents=True, exist_ok=True)
    limit = time.time() - config.FILE_TTL_SECONDS
    removed = 0
    for entry in config.TEMP_DIR.iterdir():
        if entry.is_dir() and entry.stat().st_mtime < limit:
            shutil.rmtree(entry, ignore_errors=True)
            removed += 1
    return removed
