/**
 * Police des sous-titres et de l'effet de fin, embarquée dans le bundle : le
 * rendu ne dépend d'aucun service externe (Google Fonts).
 *
 * Chargée en CSS (@font-face) plutôt qu'avec delayRender : un onglet de rendu
 * rechargé en cours de route restait bloqué sur l'attente de la police. Les
 * sous-titres n'apparaissent qu'après le délai de la voix, la police est
 * chargée bien avant.
 */
import "@fontsource/montserrat/700.css";
import "@fontsource/montserrat/800.css";
import "@fontsource/montserrat/900.css";

export const CAPTION_FONT = "Montserrat, 'Arial Black', Arial, sans-serif";
