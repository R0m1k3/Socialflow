# Service de rendu Remotion des Reels (sous-titres animés, logo, effet de fin).
# Contexte de build : la racine du dépôt (les compositions vivent dans
# client/src/remotion et importent shared/captions.ts).
#   docker build -f remotion-service/Dockerfile .

# Debian slim — glibc requis par le Chrome headless shell de Remotion
FROM node:20-slim

# Dépendances du Chrome headless shell et polices de secours
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    fonts-dejavu-core \
    fontconfig \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    libxshmfence1 \
    libxtst6 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dépendances (versions épinglées, identiques au package.json racine)
COPY remotion-service/package.json remotion-service/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# Compositions et module partagé qu'elles importent (@shared/captions).
# La police Montserrat vient du paquet @fontsource/montserrat.
COPY client/src/remotion ./client/src/remotion
COPY shared/captions.ts ./shared/captions.ts
COPY remotion-service/server.mjs ./server.mjs

# Pré-bundle des compositions et téléchargement du Chrome headless shell
# (équivalent de `npx remotion browser ensure`) : aucun accès réseau au
# premier rendu.
RUN node server.mjs --prepare && rm -rf /tmp/remotion-*

ENV NODE_ENV=production \
    PORT=8100 \
    OUTPUT_DIR=/tmp/remotion-renders

# Utilisateur non privilégié ; seuls /tmp et le cache Chrome sont utilisés
RUN chown -R node:node /app
USER node

EXPOSE 8100

CMD ["node", "server.mjs"]
