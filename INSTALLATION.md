# Installation de Social Flow sur un serveur privé

## Prérequis

- Docker et Docker Compose installés sur votre serveur
- Clé API OpenRouter (https://openrouter.ai/)
- (Optionnel) Tokens d'accès Facebook et Instagram

## Installation rapide

### 1. Cloner ou télécharger l'application

```bash
git clone <votre-repo> socialflow
cd socialflow
```

### 2. Configurer les variables d'environnement

Copiez le fichier d'exemple et modifiez les valeurs :

```bash
cp .env.example .env
nano .env  # ou utilisez votre éditeur préféré
```

**Variables importantes à modifier :**

- `PGPASSWORD` : Changez le mot de passe de la base de données
- `SESSION_SECRET` : Générez une clé secrète aléatoire
- `OPENROUTER_API_KEY` : Votre clé API OpenRouter
- `APP_URL` : L'URL publique de votre application

### 3. Démarrer l'application

```bash
docker-compose up -d
```

L'application sera accessible sur `http://localhost:5000` (ou le port configuré).

### 4. Vérifier le statut

```bash
# Voir les logs
docker-compose logs -f app

# Vérifier que les containers sont démarrés
docker-compose ps
```

## Commandes utiles

### Arrêter l'application
```bash
docker-compose down
```

### Redémarrer l'application
```bash
docker-compose restart
```

### Voir les logs
```bash
# Logs de l'application
docker-compose logs -f app

# Logs de la base de données
docker-compose logs -f postgres
```

### Mettre à jour l'application
```bash
# Arrêter l'application
docker-compose down

# Récupérer les dernières modifications
git pull

# Reconstruire et redémarrer
docker-compose up -d --build
```

### Sauvegarder la base de données
```bash
docker exec socialflow-db pg_dump -U socialflow socialflow > backup.sql
```

### Restaurer la base de données
```bash
docker exec -i socialflow-db psql -U socialflow socialflow < backup.sql
```

## Configuration avancée

### Changer le port d'exposition

Modifiez le fichier `docker-compose.yml` :

```yaml
services:
  app:
    ports:
      - "8080:5000"  # Exposer sur le port 8080
```

### Utiliser un domaine personnalisé

1. Configurez votre reverse proxy (Nginx, Caddy, etc.)
2. Pointez vers `http://localhost:5000`
3. Mettez à jour `APP_URL` dans `.env`

### Exemple de configuration Nginx

```nginx
server {
    listen 80;
    server_name socialflow.votredomaine.com;

    location / {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## Résolution de problèmes

### L'application ne démarre pas

1. Vérifiez les logs : `docker-compose logs -f`
2. Assurez-vous que les ports ne sont pas déjà utilisés
3. Vérifiez que Docker a suffisamment de ressources

### Erreurs de base de données

1. Vérifiez que PostgreSQL est démarré : `docker-compose ps`
2. Vérifiez les credentials dans `.env`
3. Recréez la base si nécessaire : `docker-compose down -v && docker-compose up -d`

### Problèmes de performance

1. Augmentez les ressources Docker
2. Configurez un reverse proxy avec cache
3. Utilisez un stockage SSD pour les volumes

## Sécurité

- Changez toujours `PGPASSWORD` et `SESSION_SECRET`
- Utilisez HTTPS en production (avec Let's Encrypt par exemple)
- Configurez un firewall pour limiter l'accès aux ports
- Mettez à jour régulièrement les images Docker

## Support

Pour plus d'informations ou en cas de problème, consultez la documentation ou ouvrez une issue.
