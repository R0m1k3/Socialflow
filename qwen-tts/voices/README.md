# Voix clonées (Qwen3-TTS)

Pour une voix française native, déposez ici un court extrait (5 à 15 s,
une seule personne, sans musique) et sa transcription exacte :

```
voices/
  camille.wav   # extrait de référence
  camille.txt   # texte prononcé dans l'extrait
  camille.json  # optionnel : {"label": "Camille — chaleureuse", "gender": "female"}
```

La voix apparaît alors dans le choix des voix Qwen sous l'identifiant
`clone:camille`. Le dossier peut aussi être monté en volume
(`QWEN_TTS_VOICES_DIR`) pour ajouter des voix sans reconstruire l'image.

Utilisez uniquement des voix dont vous avez les droits.
