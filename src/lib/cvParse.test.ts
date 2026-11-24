import { describe, expect, it } from 'vitest';
import { mergeProfile, parseCv } from './cvParse';

const CV = `Marie DUPONT
Réceptionniste polyvalente
12 rue de la Gare, L-4170 Esch-sur-Alzette
+352 621 123 456 · marie.dupont@mail.lu

PROFIL
Réceptionniste avec 8 ans d'expérience dans l'hôtellerie au Luxembourg, accueil multilingue et gestion des réservations.

EXPÉRIENCE PROFESSIONNELLE
Réceptionniste – Hôtel Le Royal, Luxembourg
Mars 2019 – aujourd'hui
• Accueil de 150 clients par jour en français, anglais et allemand
• Gestion des réservations sur Opera PMS

Agent d'accueil | Sofitel | Kirchberg
2015 - 2019
- Gestion du standard téléphonique

FORMATION
BTS Tourisme, Lycée Technique Hôtelier, 2015
Baccalauréat, Lycée de Thionville (2013)

COMPÉTENCES
Accueil client, Opera PMS, Gestion des réservations; Encaissement

LANGUES
Français : langue maternelle
Anglais : courant
Allemand (B1)

CENTRES D'INTÉRÊT
Randonnée`;

describe('parseCv', () => {
  const p = parseCv(CV);
  it('en-tête', () => {
    expect(p.full_name).toBe('Marie Dupont');
    expect(p.headline).toBe('Réceptionniste polyvalente');
    expect(p.location).toBe('Esch-sur-Alzette');
    expect(p.summary).toMatch(/^Réceptionniste avec 8 ans/);
  });
  it('expériences', () => {
    expect(p.experiences).toHaveLength(2);
    expect(p.experiences![0]).toMatchObject({ title: 'Réceptionniste', company: 'Hôtel Le Royal', location: 'Luxembourg', start: 'Mars 2019' });
    expect(p.experiences![0].achievements).toHaveLength(2);
    expect(p.experiences![1]).toMatchObject({ title: "Agent d'accueil", company: 'Sofitel', start: '2015', end: '2019' });
  });
  it('formation, compétences, langues', () => {
    expect(p.education?.[0]).toMatchObject({ degree: 'BTS Tourisme', year: '2015' });
    expect(p.education).toHaveLength(2);
    expect(p.skills).toEqual(['Accueil client', 'Opera PMS', 'Gestion des réservations', 'Encaissement']);
    expect(p.languages?.map((l) => l.language)).toEqual(['Français', 'Anglais', 'Allemand']);
    expect(p.languages?.[2].level).toBe('B1');
  });
  it('ne remplace pas ce qui est déjà saisi', () => {
    const { data, filled } = mergeProfile({ full_name: 'Moi', skills: [] }, p);
    expect(data.full_name).toBe('Moi');
    expect(data.skills?.length).toBe(4);
    expect(filled).toBeGreaterThan(4);
  });
});
