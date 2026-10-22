import { describe, expect, it } from 'vitest';
import { buildDossier } from './templateDossier';
import type { ProfileData } from './types';

const profile: ProfileData = {
  full_name: 'Alex Martin', headline: "Directeur d'exploitation", summary: '25 ans en hôtellerie de luxe.', location: 'Luxembourg',
  experiences: [{ title: "Directeur d'exploitation", company: 'Hôtel Exemple', location: 'Luxembourg', start: '2018', end: '', achievements: ['RevPAR +12 %', 'Équipe de 80 personnes'] }],
  skills: ['Pilotage P&L'], languages: [{ language: 'Anglais', level: 'C1' }], education: [], certifications: [],
};

describe('dossier sans IA', () => {
  it('reprend uniquement les faits du profil', () => {
    const d = buildDossier({ company: 'Le Royal', jobTitle: "Directeur d'hébergement", contact: '', lang: 'fr', profile, displayName: 'Alex' });
    expect(d.email_subject).toBe("Candidature – Directeur d'hébergement");
    expect(d.cv).toContain('# Alex Martin');
    expect(d.cv).toContain('- RevPAR +12 %');
    expect(d.cv).toContain('2018 – aujourd’hui');
    expect(d.letter).toContain('Madame, Monsieur,');
    expect(d.letter).toContain('- Équipe de 80 personnes');
    expect(d.letter).toMatch(/\[.+\]/);
    expect(d.email_body).toContain('RevPAR +12 %');
    expect(d.gaps).toHaveLength(1);
  });
  it('écrit dans la langue choisie, avec le contact', () => {
    const d = buildDossier({ company: 'Cravat', jobTitle: '', contact: 'Frau Klein', lang: 'de', profile, displayName: 'Alex' });
    expect(d.email_subject).toBe('Bewerbung – (Initiativbewerbung)'.replace(' – (', ' ('));
    expect(d.letter.startsWith('Guten Tag Frau Klein,')).toBe(true);
    expect(d.cv).toContain('## Berufserfahrung');
    expect(d.letter).toContain('Mit freundlichen Grüßen');
  });
});
