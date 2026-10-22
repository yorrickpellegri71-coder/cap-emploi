// Sources d'emploi du Luxembourg et de la Grande Région.
// Aucune collecte automatique sur ces sites : leurs conditions d'utilisation l'interdisent ou ne l'autorisent pas.
// On ouvre une recherche préremplie : directe quand l'adresse de recherche du site est stable et publique,
// sinon une recherche web limitée au site (« site: »), qui reste fiable si le site change ses adresses.
// La collecte côté serveur passe uniquement par l'API officielle de Jooble (voir supabase/functions/ai).

export type SourceTag = 'general' | 'hospitality' | 'public' | 'international';

export interface JobSource {
  id: string;
  name: string;
  home: string;
  tags: SourceTag[];
  /** Recherche directe sur le site ; à défaut, recherche web limitée au domaine. */
  search?: (q: string, where: string) => string;
  domain: string;
}

const enc = encodeURIComponent;

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
  { id: 'palaces', name: 'Journal des Palaces', home: 'https://www.journaldespalaces.com/carriere/', domain: 'journaldespalaces.com', tags: ['hospitality'] },
  { id: 'lhr', name: 'L’Hôtellerie Restauration', home: 'https://www.lhotellerie-restauration.fr/emplois/', domain: 'lhotellerie-restauration.fr', tags: ['hospitality'] },
  { id: 'hosco', name: 'Hosco', home: 'https://www.hosco.com', domain: 'hosco.com', tags: ['hospitality', 'international'] },
];

export function sourceUrl(s: JobSource, query: string, where: string): string {
  const q = query.trim();
  if (!q) return s.home;
  if (s.search) return s.search(q, where.trim() || 'Luxembourg');
  return `https://www.google.com/search?q=${enc(`site:${s.domain} ${q} ${where.trim() || 'Luxembourg'}`)}`;
}

/** Sources du métier en premier (hôtellerie : sites spécialisés d'abord). */
export function sourcesFor(trade: string): JobSource[] {
  const spec = trade === 'hospitality' || trade === 'events';
  return [...JOB_SOURCES].sort((a, b) => Number(spec && b.tags.includes('hospitality')) - Number(spec && a.tags.includes('hospitality')));
}
