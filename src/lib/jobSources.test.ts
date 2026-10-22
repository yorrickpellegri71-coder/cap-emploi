import { describe, expect, it } from 'vitest';
import { JOB_SOURCES, sourceUrl, sourcesFor } from './jobSources';

describe('sources d’emploi', () => {
  it('construisent une adresse https valide avec la recherche encodée', () => {
    for (const s of JOB_SOURCES) {
      const url = new URL(sourceUrl(s, 'directeur d’hôtel & spa', 'Luxembourg'));
      expect(url.protocol).toBe('https:');
      expect(decodeURIComponent(url.search.replace(/\+/g, ' '))).toContain('directeur d’hôtel & spa');
    }
  });
  it('ouvrent l’accueil du site sans recherche', () => {
    expect(sourceUrl(JOB_SOURCES[0], '  ', '')).toBe(JOB_SOURCES[0].home);
  });
  it('placent les sites spécialisés en premier pour l’hôtellerie', () => {
    expect(sourcesFor('hospitality')[0].tags).toContain('hospitality');
    expect(sourcesFor('general')[0].id).toBe(JOB_SOURCES[0].id);
  });
});
