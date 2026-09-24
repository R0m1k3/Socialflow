from app.tts.gemini import build_prompt
from app.voices import GEMINI_VOICES, edge_fallbacks, resolve_edge_voice, resolve_gemini_voice


def test_thirty_gemini_voices():
    assert len(GEMINI_VOICES) == 30


def test_legacy_gemini_identifiers_still_resolve():
    assert resolve_gemini_voice("fr-FR-Standard-B").id == "Charon"
    assert resolve_gemini_voice("fr-FR-Standard-A").id == "Kore"
    assert resolve_gemini_voice("puck").id == "Puck"


def test_edge_fallbacks_are_french_and_same_gender():
    voice = resolve_edge_voice("Fenrir")  # voix Gemini masculine
    assert voice.gender == "male"
    assert all(v.id.startswith("fr-FR") and v.gender == "male" for v in edge_fallbacks(voice))


def test_style_prompt_precedes_text():
    assert build_prompt("Salut", "neutral") == "Salut"
    assert build_prompt("Salut", "dynamic").endswith(":\nSalut")
