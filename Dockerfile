# Étape 1: Build de l'application
FROM node:20-alpine AS builder

WORKDIR /app

# Installer les outils de compilation pour bcrypt et canvas
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    cairo-dev \
    jpeg-dev \
    pango-dev \
    giflib-dev \
    pixman-dev

# Copier les fichiers de dépendances
COPY package*.json ./

# Installer toutes les dépendances (dev + prod)
# Utiliser --legacy-peer-deps si problèmes de dépendances
RUN npm ci --legacy-peer-deps || npm install --legacy-peer-deps

# Copier le reste du code source
COPY . .

# Build du frontend et backend
RUN npm run build

# Étape 2: Image de production
FROM node:20-alpine

WORKDIR /app

# Installer les runtime dependencies pour bcrypt et canvas
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    cairo \
    jpeg \
    pango \
    giflib \
    pixman

# Installer toutes les dépendances (drizzle-kit est nécessaire pour push)
# IMPORTANT: Ne pas utiliser --omit=dev car drizzle-kit est dans devDependencies
COPY package*.json ./
RUN npm ci --legacy-peer-deps || npm install --legacy-peer-deps

# Copier les fichiers buildés et le code serveur
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server ./server
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/drizzle.config.ts ./

# Exposer le port 5555
EXPOSE 5555

# Variables d'environnement par défaut
ENV NODE_ENV=production
ENV PORT=5555

# Démarrer l'application
CMD ["npm", "run", "start"]
