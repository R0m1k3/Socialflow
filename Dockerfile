# SocialFlow — image de l'application : serveur Rust + frontend React compilé.
#
# Trois étapes : le frontend est compilé par Vite, le serveur par Cargo, et
# l'image finale ne contient que le binaire, les fichiers statiques et FFmpeg
# (vignettes vidéo, durée des pistes audio). Pas de Node à l'exécution.

# ---------------------------------------------------------------------------
# 1. Frontend (Vite)
# ---------------------------------------------------------------------------
FROM node:20-slim AS frontend
WORKDIR /app

COPY package.json package-lock.json ./
# Aucune dépendance native n'est utile au build du frontend
RUN npm ci --ignore-scripts --no-audit --no-fund

COPY client ./client
COPY shared ./shared
COPY attached_assets ./attached_assets
COPY vite.config.ts tsconfig.json tailwind.config.ts postcss.config.js components.json ./
RUN npx vite build

# ---------------------------------------------------------------------------
# 2. Serveur (Rust)
# ---------------------------------------------------------------------------
FROM rust:1-slim-bookworm AS backend
WORKDIR /app/server

# Dépendances compilées dans une couche à part : elles ne sont recompilées que
# si Cargo.toml / Cargo.lock changent.
COPY server/Cargo.toml server/Cargo.lock ./
RUN mkdir src && echo 'fn main() {}' > src/main.rs \
    && cargo build --release --locked \
    && rm -rf src target/release/socialflow target/release/deps/socialflow-* target/release/.fingerprint/socialflow-*

COPY server/src ./src
RUN cargo build --release --locked

# ---------------------------------------------------------------------------
# 3. Image d'exécution
# ---------------------------------------------------------------------------
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        ffmpeg \
        fonts-dejavu-core \
        fontconfig \
        curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=backend /app/server/target/release/socialflow /usr/local/bin/socialflow
COPY --from=frontend /app/dist/public ./dist/public
COPY public-root ./public-root
COPY server/fonts ./server/fonts

RUN mkdir -p uploads/media uploads/logos uploads/stories uploads/audio uploads/temp

ENV NODE_ENV=production
ENV PORT=5555
EXPOSE 5555

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS "http://localhost:${PORT}/healthz" > /dev/null || exit 1

CMD ["socialflow"]
