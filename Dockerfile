# Utiliser Node.js 20 Alpine pour une image légère
FROM node:20-alpine

WORKDIR /app

# Installer les dépendances système nécessaires pour bcrypt, canvas et sharp
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    cairo-dev \
    jpeg-dev \
    pango-dev \
    giflib-dev \
    pixman-dev \
    cairo \
    jpeg \
    pango \
    giflib \
    pixman \
    vips-dev \
    pkgconfig \
    ttf-dejavu \
    fontconfig \
    curl \
    tar \
    bzip2 \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    ffmpeg \
    libcap

# Copier les fichiers de configuration
COPY package*.json ./

# Installer les dépendances avec npm install (plus permissif que npm ci)
RUN npm install --legacy-peer-deps

# Copier tout le code source
COPY . .

# Télécharger et installer la police DejaVu Sans pour le rendu de texte
RUN mkdir -p server/fonts && \
    cd server/fonts && \
    echo "Téléchargement de la police DejaVu Sans..." && \
    curl -L -f --retry 3 --retry-delay 2 -o dejavu.tar.bz2 "https://sourceforge.net/projects/dejavu/files/dejavu/2.37/dejavu-fonts-ttf-2.37.tar.bz2/download" && \
    echo "Extraction de l'archive..." && \
    tar -xjf dejavu.tar.bz2 && \
    echo "Installation de la police..." && \
    cp dejavu-fonts-ttf-2.37/ttf/DejaVuSans.ttf . && \
    ls -lh DejaVuSans.ttf && \
    rm -rf dejavu.tar.bz2 dejavu-fonts-ttf-2.37 && \
    echo "✓ Police DejaVu Sans installée avec succès"

# Augmenter la mémoire pour le build (résout les problèmes de mémoire avec Vite)
ENV NODE_OPTIONS="--max-old-space-size=4096"

# Build du frontend et backend avec logs détaillés
# Build du frontend et backend (Exit on error)
RUN npm run build

# Nettoyer les fichiers inutiles pour réduire la taille
# On garde client/src/remotion car le serveur en a besoin au runtime pour le bundling
RUN rm -rf client/node_modules \
         client/.vite \
         node_modules/.cache \
         /tmp/remotion-*

# Pré-bundler la composition Remotion pendant le build (speedup au premier rendu)
RUN node scripts/prebundle-remotion.js || true

# Vérifier que le binaire Chromium système est bien présent (utilisé à la place du binaire Remotion)
# Note: npx remotion browser ensure télécharge un binaire glibc qui ne fonctionne pas sur Alpine (musl)
RUN which chromium-browser && echo "✓ chromium-browser trouvé à $(which chromium-browser)" || \
    (which chromium && echo "✓ chromium trouvé à $(which chromium)") || \
    echo "⚠ Aucun chromium système trouvé — le rendu échouera"


# Exposer le port de l'application
EXPOSE 5555

# Variables d'environnement par défaut
ENV NODE_ENV=production
ENV PORT=5555

# Démarrer l'application
CMD ["npm", "run", "start"]
