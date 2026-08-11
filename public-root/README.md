# Fichiers servis à la racine du domaine

Le contenu de ce dossier est exposé publiquement, sans authentification, à la
racine du domaine (`https://<domaine>/<nom-du-fichier>`).

Il sert aux fichiers de vérification de propriété du domaine réclamés par les
plateformes : TikTok (`tiktok<clé>.txt`, requis par « URL properties » avant de
pouvoir utiliser la Content Posting API), Google Search Console, Meta, etc.

Pour en ajouter un, il suffit de déposer le fichier ici — aucune modification de
code n'est nécessaire, et le fichier est servi sans reconstruire le frontend.
