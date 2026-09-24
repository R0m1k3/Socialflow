"""Nettoyage du texte avant synthèse et affichage."""

import re

import emoji

_HIDDEN = str.maketrans("", "", "﻿​")
_HASHTAG = re.compile(r"#[\wÀ-ɏ]+")
_URL = re.compile(r"https?://\S+")


def clean_text(text: str | None) -> str:
    """Retire emojis, hashtags, liens et caractères invisibles."""
    if not text:
        return ""
    text = text.translate(_HIDDEN)
    text = emoji.replace_emoji(text, replace="")
    text = _URL.sub("", text)
    text = _HASHTAG.sub("", text)
    return " ".join(text.split())
