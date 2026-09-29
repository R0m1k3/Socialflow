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


def test_qwen_voice_keeps_clones_and_matches_gender():
    from app.voices import qwen_instruction, resolve_qwen_voice

    assert resolve_qwen_voice("clone:camille") == "clone:camille"
    assert resolve_qwen_voice("Ryan") == "ryan"
    assert resolve_qwen_voice("Charon") == "aiden"  # voix Gemini masculine
    assert resolve_qwen_voice(None) == "serena"
    assert "French" in qwen_instruction("dynamic")


def test_qwen_voice_falls_back_to_same_gender_elsewhere():
    assert resolve_edge_voice("uncle_fu").gender == "male"
    assert resolve_gemini_voice("uncle_fu").id == "Charon"


def test_qwen_target_prefers_app_settings(monkeypatch):
    from app import config
    from app.tts.qwen import Target

    monkeypatch.setattr(config, "QWEN_TTS_URL", "http://qwen-tts:8001")
    monkeypatch.setattr(config, "QWEN_TTS_API_KEY", "env-key")
    assert Target.resolve("http://unraid:8001/ ", "k") == Target("http://unraid:8001", "k")
    assert Target.resolve(None, None) == Target("http://qwen-tts:8001", "env-key")
    monkeypatch.setattr(config, "QWEN_TTS_URL", "")
    assert Target.resolve("", None) is None
