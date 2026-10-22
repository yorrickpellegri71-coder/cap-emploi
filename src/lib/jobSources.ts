// Sources d'emploi du Luxembourg et de la Grande Région.
// Aucune collecte automatique sur ces sites : leurs conditions d'utilisation l'interdisent ou ne l'autorisent pas.
// On ouvre une recherche préremplie : directe quand l'adresse de recherche du site est stable et publique,
// sinon une recherche web limitée au site (« site: »), qui reste fiable si le site change ses adresses.
// La collecte côté serveur passe uniquement par l'API officielle de Jooble (voir supabase/functions/ai).

export type SourceTag = 'general' | 'specialized' | 'recruiter' | 'public' | 'international';

export interface JobSource {
  id: string;
  name: string;
  home: string;
  tags: SourceTag[];
  /** Métiers pour lesquels la source est spécialisée. */
  trades?: string[];
  /** Recherche directe sur le site ; à défaut, recherche web limitée au domaine. */
  search?: (q: string, where: string) => string;
  domain: string;
}

const enc = encodeURIComponent;

/** Métiers d'encadrement hors hôtellerie, couverts par les cabinets de recrutement généralistes. */
const MANAGEMENT = ['operations', 'facility', 'property', 'customer', 'luxury_retail', 'purchasing', 'quality', 'project', 'health_seniors', 'consulting'];

export const JOB_SOURCES: JobSource[] = [
  { id: 'jobs-lu', name: 'jobs.lu', home: 'https://www.jobs.lu', domain: 'jobs.lu', tags: ['general'] },
  { id: 'moovijob', name: 'Moovijob', home: 'https://www.moovijob.com', domain: 'moovijob.com', tags: ['general'] },
  { id: 'adem', name: 'ADEM JobBoard', home: 'https://jobboard.adem.lu', domain: 'adem.lu', tags: ['public'] },
  {
    id: 'linkedin', name: 'LinkedIn', home: 'https://www.linkedin.com/jobs', domain: 'linkedin.com', tags: ['general', 'international'],
    search: (q, w) => `https://www.linkedin.com/jobs/search/?keywords=${enc(q)}&location=${enc(w)}`,
  },
  {
    id: 'indeed', name: 'Indeed', home: 'https://lu.indeed.com', domain: 'lu.indeed.com', tags: ['general'],
    search: (q, w) => `https://lu.indeed.com/jobs?q=${enc(q)}&l=${enc(w)}`,
  },
  { id: 'monster', name: 'Monster', home: 'https://www.monster.lu', domain: 'monster.lu', tags: ['general'] },
  {
    id: 'jooble', name: 'Jooble', home: 'https://lu.jooble.org', domain: 'jooble.org', tags: ['general'],
    search: (q, w) => `https://lu.jooble.org/SearchResult?ukw=${enc(q)}&rgns=${enc(w)}`,
  },
  { id: 'eures', name: 'EURES', home: 'https://europa.eu/eures/portal/jv-se/home', domain: 'europa.eu/eures', tags: ['public', 'international'] },
  { id: 'paperjam', name: 'Paperjam Jobs', home: 'https://jobs.paperjam.lu', domain: 'paperjam.lu', tags: ['general'] },
  { id: 'palaces', name: 'Journal des Palaces', home: 'https://www.journaldespalaces.com/carriere/', domain: 'journaldespalaces.com', tags: ['specialized'], trades: ['hospitality', 'events', 'consulting'] },
  { id: 'lhr', name: 'L’Hôtellerie Restauration', home: 'https://www.lhotellerie-restauration.fr/emplois/', domain: 'lhotellerie-restauration.fr', tags: ['specialized'], trades: ['hospitality', 'events', 'consulting'] },
  { id: 'hosco', name: 'Hosco', home: 'https://www.hosco.com', domain: 'hosco.com', tags: ['specialized', 'international'], trades: ['hospitality', 'events', 'consulting', 'luxury_retail', 'customer'] },
  { id: 'michael-page', name: 'Michael Page', home: 'https://www.michaelpage.lu', domain: 'michaelpage.lu', tags: ['recruiter'], trades: MANAGEMENT },
  { id: 'hays', name: 'Hays', home: 'https://www.hays.lu', domain: 'hays.lu', tags: ['recruiter'], trades: MANAGEMENT },
  { id: 'lvmh', name: 'LVMH Careers', home: 'https://www.lvmh.com/join-us', domain: 'lvmh.com', tags: ['specialized', 'international'], trades: ['luxury_retail', 'customer'] },
  { id: 'servior', name: 'Servior', home: 'https://www.servior.lu', domain: 'servior.lu', tags: ['specialized'], trades: ['health_seniors'] },
];

export function sourceUrl(s: JobSource, query: string, where: string): string {
  const q = query.trim();
  if (!q) return s.home;
  if (s.search) return s.search(q, where.trim() || 'Luxembourg');
  return `https://www.google.com/search?q=${enc(`site:${s.domain} ${q} ${where.trim() || 'Luxembourg'}`)}`;
}

/** Sites spécialisés dans les métiers visés, puis cabinets de recrutement, puis généralistes ; le hors sujet à la fin. */
export function sourcesFor(trades: string[]): JobSource[] {
  const rank = (s: JobSource) => (!s.trades ? 2 : !s.trades.some((t) => trades.includes(t)) ? 3 : s.tags.includes('recruiter') ? 1 : 0);
  return [...JOB_SOURCES].sort((a, b) => rank(a) - rank(b));
}
