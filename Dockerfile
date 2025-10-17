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
    pixman

# Copier les fichiers de configuration
COPY package*.json ./

# Installer les dépendances avec npm install (plus permissif que npm ci)
RUN npm install --legacy-peer-deps

# Copier tout le code source
COPY . .

# Build du frontend et backend
RUN npm run build

# Nettoyer les fichiers inutiles pour réduire la taille
RUN rm -rf client node_modules/.cache

# Exposer le port de l'application
EXPOSE 5555

# Variables d'environnement par défaut
ENV NODE_ENV=production
ENV PORT=5555

# Démarrer l'application
CMD ["npm", "run", "start"]
