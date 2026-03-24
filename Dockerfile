# Debian slim — glibc requis par le Chrome headless shell de Remotion (posix_fallocate64, etc.)
FROM node:20-slim

WORKDIR /app

# Augmenter la mémoire AVANT npm install + build (évite OOM sur les grosses dépendances)
ENV NODE_OPTIONS="--max-old-space-size=4096"

# Dépendances système : build tools, canvas/sharp, fonts, ffmpeg + dépendances Chrome
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    libcairo2-dev libjpeg-dev libpango1.0-dev libgif-dev libpixman-1-dev \
    libvips-dev pkg-config \
    fonts-dejavu-core fontconfig \
    curl tar bzip2 \
    ffmpeg \
    libcap2-bin \
    ca-certificates \
    # Dépendances Chrome headless
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

# Copier les fichiers de configuration
COPY package*.json ./

# Installer les dépendances
RUN npm install --legacy-peer-deps --no-audit --no-fund

# Copier tout le code source
COPY . .

# Télécharger et installer la police DejaVu Sans
RUN mkdir -p server/fonts && \
    cd server/fonts && \
    curl -L -f --retry 3 --retry-delay 2 -o dejavu.tar.bz2 "https://sourceforge.net/projects/dejavu/files/dejavu/2.37/dejavu-fonts-ttf-2.37.tar.bz2/download" && \
    tar -xjf dejavu.tar.bz2 && \
    cp dejavu-fonts-ttf-2.37/ttf/DejaVuSans.ttf . && \
    rm -rf dejavu.tar.bz2 dejavu-fonts-ttf-2.37 && \
    echo "✓ Police DejaVu Sans installée"

# Build du frontend et backend
RUN npm run build

# Nettoyer les fichiers inutiles
RUN rm -rf client/node_modules \
         client/.vite \
         node_modules/.cache \
         /tmp/remotion-*

# Pré-bundler la composition Remotion
RUN node scripts/prebundle-remotion.js || true

# Télécharger le Chrome headless shell de Remotion (binaire glibc natif sur Debian)
RUN npx remotion browser ensure && echo "✓ Remotion browser prêt"

# Exposer le port
EXPOSE 5555

ENV NODE_ENV=production
ENV PORT=5555

CMD ["npm", "run", "start"]
