/**
 * Pages légales publiques (conditions d'utilisation et politique de confidentialité).
 *
 * TikTok exige une URL publique pour chacune lors de la création de l'application
 * développeur, et les relecteurs les ouvrent réellement pendant l'audit. Elles sont
 * servies en HTML depuis le serveur, sans authentification, pour rester lisibles
 * même par un robot qui n'exécute pas le JavaScript du client.
 *
 * Les mentions de l'exploitant se configurent par variables d'environnement :
 *   LEGAL_COMPANY_NAME, LEGAL_COMPANY_ADDRESS, LEGAL_CONTACT_EMAIL
 */

import { Router, Request, Response } from 'express';

export const legalRouter = Router();

function getCompanyInfo() {
  return {
    name: process.env.LEGAL_COMPANY_NAME || "[Raison sociale à renseigner]",
    address: process.env.LEGAL_COMPANY_ADDRESS || "[Adresse à renseigner]",
    email: process.env.LEGAL_CONTACT_EMAIL || "[Adresse e-mail de contact à renseigner]",
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderPage(title: string, body: string): string {
  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light dark; }
    body {
      max-width: 46rem;
      margin: 0 auto;
      padding: 2.5rem 1.25rem 4rem;
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      line-height: 1.65;
      color: #1f2328;
      background: #ffffff;
    }
    h1 { font-size: 1.75rem; margin-bottom: 0.25rem; }
    h2 { font-size: 1.15rem; margin-top: 2.25rem; }
    .updated { color: #6b7280; font-size: 0.875rem; margin-top: 0; }
    ul { padding-left: 1.25rem; }
    li { margin-bottom: 0.35rem; }
    code { background: rgba(127, 127, 127, 0.15); padding: 0.1rem 0.3rem; border-radius: 0.25rem; font-size: 0.9em; }
    footer { margin-top: 3rem; padding-top: 1.25rem; border-top: 1px solid rgba(127,127,127,0.3); color: #6b7280; font-size: 0.875rem; }
    a { color: #2563eb; }
    @media (prefers-color-scheme: dark) {
      body { color: #e6e6e6; background: #0f1115; }
      .updated, footer { color: #9ca3af; }
      a { color: #7aa7ff; }
    }
  </style>
</head>
<body>
${body}
</body>
</html>`;
}

function renderFooter(): string {
  const company = getCompanyInfo();
  return `<footer>
    <p>
      ${escapeHtml(company.name)}<br>
      ${escapeHtml(company.address)}<br>
      Contact : ${escapeHtml(company.email)}
    </p>
    <p><a href="/terms">Conditions d'utilisation</a> &middot; <a href="/privacy">Politique de confidentialité</a></p>
  </footer>`;
}

legalRouter.get('/terms', (_req: Request, res: Response) => {
  const company = getCompanyInfo();

  const body = `
  <h1>Conditions d'utilisation</h1>
  <p class="updated">Dernière mise à jour : 11 août 2026</p>

  <p>
    Cette application est un outil interne de gestion des réseaux sociaux exploité par
    ${escapeHtml(company.name)} (« nous »). Elle permet à nos équipes de créer des vidéos et des
    publications promotionnelles, puis de les diffuser sur les comptes et pages officiels de nos
    magasins.
  </p>

  <h2>1. Accès au service</h2>
  <p>
    L'accès est réservé aux personnes que nous avons expressément autorisées, au moyen d'un compte
    nominatif. Chaque utilisateur est responsable de la confidentialité de ses identifiants et des
    actions effectuées depuis son compte. Nous pouvons suspendre ou retirer un accès à tout moment.
  </p>

  <h2>2. Comptes de réseaux sociaux connectés</h2>
  <p>
    L'application publie sur des comptes Facebook et TikTok qui nous appartiennent ou que nous
    sommes habilités à administrer. En connectant un compte, l'utilisateur déclare disposer des
    droits nécessaires pour le faire. Un compte peut être déconnecté à tout moment depuis
    l'application, ou par le retrait de l'autorisation directement dans les réglages de la
    plateforme concernée.
  </p>

  <h2>3. Contenus publiés</h2>
  <p>
    Les utilisateurs restent responsables des contenus qu'ils créent et diffusent. Ces contenus
    doivent respecter la loi applicable ainsi que les règles des plateformes de destination,
    notamment les Conditions d'utilisation et les Règles communautaires de TikTok et de Meta.
    Sont notamment proscrits les contenus dont les utilisateurs ne détiennent pas les droits,
    y compris pour les images et les musiques utilisées.
  </p>

  <h2>4. Disponibilité</h2>
  <p>
    Le service est fourni « en l'état ». Il dépend de services tiers (plateformes de publication,
    hébergement, traitement vidéo) dont les interruptions ou modifications peuvent affecter son
    fonctionnement. Nous ne garantissons ni une disponibilité continue, ni la publication effective
    d'un contenu par une plateforme tierce, celle-ci pouvant la refuser selon ses propres règles.
  </p>

  <h2>5. Responsabilité</h2>
  <p>
    Dans les limites permises par la loi, notre responsabilité ne saurait être engagée au titre des
    dommages indirects résultant de l'utilisation du service, notamment une perte de contenu, une
    publication manquée ou la suspension d'un compte par une plateforme tierce.
  </p>

  <h2>6. Modification des conditions</h2>
  <p>
    Ces conditions peuvent être modifiées. La date de dernière mise à jour figure en tête de page.
  </p>

  <h2>7. Contact</h2>
  <p>Pour toute question relative à ces conditions : ${escapeHtml(company.email)}</p>

  ${renderFooter()}`;

  res.type('html').send(renderPage("Conditions d'utilisation", body));
});

legalRouter.get('/privacy', (_req: Request, res: Response) => {
  const company = getCompanyInfo();

  const body = `
  <h1>Politique de confidentialité</h1>
  <p class="updated">Dernière mise à jour : 11 août 2026</p>

  <p>
    Cette politique décrit les données traitées par notre outil interne de gestion des réseaux
    sociaux. Le responsable de traitement est ${escapeHtml(company.name)},
    ${escapeHtml(company.address)}.
  </p>

  <h2>1. Données de nos utilisateurs internes</h2>
  <p>
    Pour chaque personne autorisée à utiliser l'outil, nous conservons un identifiant de connexion,
    un mot de passe stocké sous forme chiffrée, un rôle et la liste des comptes auxquels elle a
    accès. Ces données servent uniquement à l'authentification et à la gestion des droits.
  </p>

  <h2>2. Données issues des comptes de réseaux sociaux connectés</h2>
  <p>
    Lorsqu'un compte TikTok est connecté, nous recevons de TikTok, avec l'autorisation explicite du
    titulaire du compte et dans le cadre du périmètre <code>user.info.basic</code> :
  </p>
  <ul>
    <li>l'identifiant technique du compte (<code>open_id</code>) ;</li>
    <li>le nom d'affichage du compte ;</li>
    <li>l'image de profil du compte ;</li>
    <li>un jeton d'accès et un jeton de renouvellement, qui nous permettent de publier en son nom.</li>
  </ul>
  <p>
    Nous procédons de manière équivalente pour les pages Facebook connectées. Nous ne collectons ni
    la liste des abonnés, ni les messages privés, ni les données de navigation des visiteurs de ces
    comptes.
  </p>

  <h2>3. Finalités</h2>
  <p>
    Ces données sont utilisées exclusivement pour identifier le compte de destination dans
    l'interface et y publier les vidéos et publications créées par nos équipes, immédiatement ou à
    l'heure programmée. Elles ne servent à aucune autre finalité.
  </p>

  <h2>4. Données que nous transmettons aux plateformes</h2>
  <p>
    Lors d'une publication, nous transmettons à la plateforme concernée le fichier vidéo ou image,
    le texte de la publication, ainsi que les paramètres de diffusion associés (niveau de
    confidentialité, autorisation des commentaires). Ces contenus sont ensuite régis par la
    politique de confidentialité de la plateforme concernée.
  </p>

  <h2>5. Conservation et sécurité</h2>
  <ul>
    <li>Les jetons d'accès et de renouvellement sont chiffrés au repos (AES-256-GCM).</li>
    <li>
      Ils sont conservés tant que le compte reste connecté à l'application, et supprimés
      immédiatement lorsque le compte en est retiré.
    </li>
    <li>Les médias sources sont supprimés automatiquement après leur publication et leur péremption.</li>
    <li>L'accès à l'application est restreint aux personnes autorisées et protégé par mot de passe.</li>
  </ul>

  <h2>6. Partage avec des tiers</h2>
  <p>
    Nous ne vendons ni ne louons ces données, et ne les transmettons à aucun tiers à des fins
    publicitaires ou de profilage. Elles ne sont communiquées qu'aux plateformes de destination
    (TikTok, Meta) dans la stricte mesure nécessaire à la publication demandée, ainsi qu'à nos
    prestataires techniques d'hébergement et de traitement vidéo agissant sur nos instructions.
  </p>

  <h2>7. Retirer une autorisation</h2>
  <p>
    Le titulaire d'un compte connecté peut retirer son autorisation à tout moment :
  </p>
  <ul>
    <li>en demandant la déconnexion du compte depuis l'application, ce qui supprime les jetons ;</li>
    <li>
      ou directement dans TikTok, via <em>Profil &rsaquo; Paramètres et confidentialité &rsaquo;
      Sécurité et autorisations &rsaquo; Gérer les autorisations des applications</em>.
    </li>
  </ul>
  <p>
    Le retrait de l'autorisation empêche toute publication ultérieure. Il n'entraîne pas la
    suppression des contenus déjà publiés sur la plateforme, qui doivent être supprimés depuis
    celle-ci.
  </p>

  <h2>8. Vos droits</h2>
  <p>
    Conformément au Règlement général sur la protection des données, vous disposez d'un droit
    d'accès, de rectification, d'effacement, de limitation et de portabilité des données vous
    concernant, ainsi que du droit d'introduire une réclamation auprès de la CNIL. Pour exercer ces
    droits, écrivez à ${escapeHtml(company.email)}.
  </p>

  <h2>9. Modification de cette politique</h2>
  <p>
    Cette politique peut être mise à jour. La date de dernière mise à jour figure en tête de page.
  </p>

  ${renderFooter()}`;

  res.type('html').send(renderPage('Politique de confidentialité', body));
});
