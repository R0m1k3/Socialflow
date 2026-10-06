# Social Flow - Design Guidelines

Interface sobre et lisible, en français, pensée d'abord pour être comprise sans formation.
Toutes les couleurs passent par les tokens de `client/src/index.css` (modes clair et sombre).

## Identité

- **Logo** : `components/brand/logo.tsx` (`<Logo />`, `<LogoMark />`) — deux ondes qui s'écoulent vers un point, sur un carré arrondi en dégradé indigo → corail. Même dessin dans `client/public/favicon.svg`.
- **Primaire** : indigo `#4F46E5` (`primary`) — actions, éléments actifs, focus.
- **Accent** : corail `#F97362` (`brand-accent`) — uniquement dans le dégradé de marque.
- **Dégradé de marque** (`.gradient-brand`, bouton `variant="brand"`) : réservé au logo et à **une seule** action principale par écran (publier, créer, se connecter).
- **Statuts** : `success` (publié, actif), `warning` (bientôt expiré), `destructive` (échec, suppression), `info` (en cours).
- **Plateformes** : `facebook`, `instagram`, `tiktok` — via `components/platform-icon.tsx`.
- Ne jamais utiliser de couleurs Tailwind brutes (`bg-blue-500`, `#1877F2`…) ni `text-white` sur une surface de l'interface.

## Typographie

- Inter (400–700), JetBrains Mono pour les identifiants et le SQL.
- Titre de page : `PageHeader` (`text-2xl sm:text-[28px] font-semibold`).
- Titre de carte : `CardTitle` (`text-base font-semibold`), description en `text-muted-foreground`.

## Mise en page

- **Shell** : `components/layout/app-shell.tsx` — sidebar groupée sur desktop (≥ lg), en-tête + barre de navigation basse sur mobile (Accueil, Calendrier, **Créer**, Médias, Menu). La navigation est définie une seule fois dans `components/layout/nav-config.ts`.
- **Contenu** : chaque page commence par `<Page width="narrow|default|wide">` puis `<PageHeader icon title description actions />`.
  - `narrow` (max-w-3xl) : formulaires simples
  - `default` (max-w-6xl) : la plupart des pages
  - `wide` (1400px) : tableau de bord, calendrier, médiathèque
- Une seule version responsive par écran : pas de pages mobiles séparées.

## Composants

- **Cartes** : `Card` sans surcharge de style (`rounded-xl border shadow-soft`).
- **États vides** : `components/empty-state.tsx` avec une action suggérée.
- **Parcours de création** : `components/stepper.tsx` (`Stepper` + `StepNavigation`), utilisé par Publication et Reel. On explique toujours pourquoi une étape est verrouillée.
- **Choix exclusifs** : cartes sélectionnables (`RadioGroup` dans un `label` bordé), pas de listes déroulantes quand il y a 2 à 4 options.
- **Suppressions** : toujours confirmées par `AlertDialog`, jamais `confirm()`.
- **Badges** : variantes `success`, `warning`, `info`, `danger`, `muted`.

## Rédaction

- Verbes d'action clairs : « Importer », « Programmer », « Connecter un compte ».
- Pas d'anglicismes (« Uploader », « Token ») ni de jargon technique visible par défaut : les détails vont dans un bloc « Besoin d'aide ? » repliable.
