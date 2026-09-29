# Qwen TTS : voix locale sur un serveur GPU (ex. Unraid)

Service de synthèse vocale Qwen3-TTS appelé par SocialFlow (via ffmpeg-api).
Sur une carte graphique NVIDIA, le gros modèle 1.7B (ton et émotion pilotés)
génère une voix bien plus vite qu'en temps réel ; sur CPU, il est 5 à 7 fois plus lent.

## Installation sur Unraid

1. **Pilote NVIDIA** : Apps → installer le plugin **Nvidia Driver**, redémarrer,
   puis vérifier dans un terminal : `nvidia-smi -L` (liste les cartes et leur numéro).
2. **Récupérer ce dossier** sur le serveur, par exemple :
   ```bash
   cd /mnt/user/appdata
   git clone https://github.com/R0m1k3/Socialflow.git
   cd Socialflow/qwen-tts
   ```
3. **Choisir la carte et la clé** dans un fichier `.env` à côté de `docker-compose.gpu.yml` :
   ```bash
   QWEN_TTS_API_KEY=une-longue-cle-secrete   # openssl rand -hex 32
   QWEN_TTS_GPU=0                            # numéro ou UUID donné par nvidia-smi -L
   # QWEN_TTS_PORT=8001
   ```
   Une RTX 3060 12 Go suffit largement (le modèle 1.7B occupe ~5–6 Go) : autant
   la dédier à la voix et garder la plus grosse carte pour le reste.
4. **Construire et lancer** (le premier build télécharge les modèles, quelques Go) :
   ```bash
   docker compose -f docker-compose.gpu.yml up -d --build
   docker logs -f socialflow-qwen-tts   # « Modèle … chargé sur NVIDIA GeForce … »
   ```
5. **Dans SocialFlow** : Paramètres → **Qwen TTS (voix locale)** → adresse
   `http://IP-DE-L-UNRAID:8001` + la clé → **Tester la connexion** → **Enregistrer**.
   Le moteur « Qwen (locale) » devient disponible dans le choix des voix.

## Sécurité

Le service ne doit pas être exposé sur Internet. Si SocialFlow tourne sur un
autre réseau que l'Unraid, reliez les deux par **Tailscale** (ou WireGuard)
et utilisez l'adresse Tailscale de l'Unraid (`http://100.x.y.z:8001`).
La clé d'accès est obligatoire.

## Voix clonées (voix française native)

Déposez dans `voices/` un extrait de 5 à 15 s et sa transcription (voir
`voices/README.md`), puis `docker restart socialflow-qwen-tts`. Utilisez
uniquement des voix dont vous avez les droits.

## Réglages

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `QWEN_TTS_MODEL` | `Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice` | Modèle des voix prédéfinies (build) |
| `QWEN_TTS_CLONE_MODEL` | `Qwen/Qwen3-TTS-12Hz-1.7B-Base` | Modèle de clonage, vide pour désactiver (build) |
| `QWEN_TTS_GPU` | `0` | Carte NVIDIA utilisée |
| `QWEN_TTS_DEVICE` | `auto` | `cuda:0`, `cpu`… (auto : GPU si disponible) |
| `QWEN_TTS_DTYPE` | `bfloat16` sur GPU, `float32` sur CPU | Précision du calcul |
