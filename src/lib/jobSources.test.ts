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
  it('placent en premier les sites spécialisés dans les métiers visés', () => {
    expect(sourcesFor(['hospitality'])[0].trades).toContain('hospitality');
    expect(sourcesFor(['health_seniors'])[0].id).toBe('servior');
    expect(sourcesFor(['facility', 'hospitality']).slice(0, 4).every((s) => s.tags.includes('specialized') || s.tags.includes('recruiter'))).toBe(true);
    expect(sourcesFor(['general'])[0].id).toBe(JOB_SOURCES[0].id);
  });
});
