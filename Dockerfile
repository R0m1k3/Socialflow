# Alpine léger + gcompat pour la compatibilité glibc (requis par Remotion Chrome headless)
FROM node:20-alpine

WORKDIR /app

# Augmenter la mémoire dès le début (npm install + build)
ENV NODE_OPTIONS="--max-old-space-size=4096"

# Dépendances système
RUN apk add --no-cache \
    python3 make g++ \
    cairo-dev jpeg-dev pango-dev giflib-dev pixman-dev \
    vips-dev pkgconfig \
    ttf-dejavu fontconfig \
    curl tar bzip2 \
    ffmpeg \
    libcap \
    # gcompat = couche de compatibilité glibc → permet au Chrome headless de Remotion de tourner sur Alpine
    gcompat \
    libc6-compat \
    # Dépendances Chromium pour le rendu headless
    chromium \
    nss freetype harfbuzz ca-certificates

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

# Télécharger le Chrome headless shell de Remotion
# gcompat permet au binaire glibc de tourner sur Alpine
RUN npx remotion browser ensure && echo "✓ Remotion browser prêt"

# Exposer le port
EXPOSE 5555

ENV NODE_ENV=production
ENV PORT=5555

CMD ["npm", "run", "start"]
