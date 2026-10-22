// L'IA est facultative : sans clé Anthropic, l'application fonctionne entièrement à 0 €.
// VITE_AI_ENABLED=true active les fonctions IA (la fonction serveur doit alors avoir CAP_ANTHROPIC_API_KEY).
export const aiEnabled = () => import.meta.env.VITE_AI_ENABLED === 'true';
