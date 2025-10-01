# Étape 1: Build de l'application
FROM node:20-alpine AS builder

WORKDIR /app

# Copier les fichiers de dépendances
COPY package*.json ./

# Installer toutes les dépendances (dev + prod)
RUN npm ci

# Copier le reste du code source
COPY . .

# Générer les migrations de base de données
RUN npx drizzle-kit generate || echo "No schema changes to generate"

# Créer le dossier drizzle s'il n'existe pas
RUN mkdir -p drizzle

# Build du frontend et backend
RUN npm run build

# Compiler le script de migration
RUN npx esbuild server/migrate.ts --platform=node --packages=external --bundle --format=esm --outfile=dist/migrate.js

# Étape 2: Image de production
FROM node:20-alpine

WORKDIR /app

# Installer uniquement les dépendances de production
COPY package*.json ./
RUN npm ci --only=production

# Copier les fichiers buildés et le code serveur
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server ./server
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/drizzle.config.ts ./
COPY --from=builder /app/drizzle ./drizzle

# Exposer le port 5000
EXPOSE 5000

# Variables d'environnement par défaut
ENV NODE_ENV=production
ENV PORT=5000

# Démarrer l'application
CMD ["npm", "run", "start"]
