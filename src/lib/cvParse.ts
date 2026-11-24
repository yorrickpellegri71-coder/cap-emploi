// Remplissage du profil à partir du texte d'un CV, sans IA (règles simples, gratuites, dans le navigateur).
// Le résultat n'est qu'une proposition : l'utilisateur relit et corrige chaque champ.
import type { Experience, ProfileData } from './types';

type Section = 'summary' | 'experience' | 'education' | 'skills' | 'languages' | 'certifications' | 'other';

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();

// Titres de rubriques (fr, en, de, pt, lb), comparés sans accents ni ponctuation.
const HEADINGS: [Section, RegExp][] = [
  ['experience', /^(experiences?( professionnelles?)?|parcours( professionnel)?|emplois?|historique professionnel|work experience|professional experience|experience|employment( history)?|berufserfahrung|berufliche erfahrung|experiencia profissional|experiencias? profissionais?|beruffserfahrung)$/],
  ['education', /^(formations?|formations? et diplomes?|diplomes?( et formations?)?|etudes|cursus|scolarite|education|qualifications?|ausbildung|bildung|formacao|formacao academica|schoulbildung)$/],
  ['skills', /^(competences?( cles| professionnelles| techniques)?|savoir faire|aptitudes|skills|key skills|competencies|kenntnisse|fahigkeiten|kompetenzen|competencias|kompetenzen an fahegkeeten)$/],
  ['languages', /^(langues?( parlees)?|languages?|sprachen|idiomas|linguas|sproochen)$/],
  ['certifications', /^(certifications?|certificats?|habilitations?|permis|licences?|certificates?|zertifikate|certificados?)$/],
  ['summary', /^(profil( professionnel)?|resume|a propos( de moi)?|presentation|objectif( professionnel)?|summary|profile|about me|uber mich|profil|perfil|sobre mim)$/],
  ['other', /^(centres? d interets?|loisirs|interets|hobbies|interests|references?|informations? complementaires?|divers|contact|coordonnees|freizeit|interessen|hobbys)$/],
];

function headingOf(line: string): Section | null {
  const n = norm(line.replace(/[:：]\s*$/, ''));
  if (!n || n.split(' ').length > 5) return null;
  for (const [s, re] of HEADINGS) if (re.test(n)) return s;
  return null;
}

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const PHONE = /(\+|00)?\d[\d .\-/()]{7,}\d/;
const URLISH = /(https?:\/\/|www\.|linkedin\.com)/i;
const BULLET = /^[\s•·●▪■◦\-–—*►✓]+\s*/;
const YEAR = /(19|20)\d{2}/;
const NOW = /(?:aujourd['’]hui|present|présent|actuel(?:lement)?|en cours|now|current|today|heute|derzeit|atual|actualmente|haut)/i;
const MONTH = '(?:janv?|f[eé]vr?|mars|avr|mai|juin|juil|ao[uû]t|sept?|oct|nov|d[eé]c|jan|feb|mar|apr|may|jun|jul|aug|sep|dec|januar|februar|m[aä]rz|juni|juli|oktober|dezember)[a-zéû]*\\.?';
const DATE = `(?:(?:${MONTH}|\\d{1,2})[\\s/.-]*)?(?:19|20)\\d{2}`;
const RANGE = new RegExp(`(${DATE})\\s*(?:-|–|—|à|au|to|bis|até|a)\\s*(${DATE}|${NOW.source})`, 'i');
const SINCE = new RegExp(`(?:depuis|since|seit|desde)\\s+(${DATE})`, 'i');

const LUX_PLACES = ['Luxembourg', 'Esch-sur-Alzette', 'Differdange', 'Dudelange', 'Ettelbruck', 'Diekirch', 'Wiltz', 'Echternach', 'Rumelange', 'Grevenmacher', 'Remich', 'Vianden', 'Clervaux', 'Mersch', 'Strassen', 'Bertrange', 'Mamer', 'Hesperange', 'Sanem', 'Pétange', 'Bettembourg', 'Schifflange', 'Kayl', 'Mondorf-les-Bains', 'Kirchberg', 'Howald', 'Leudelange', 'Capellen', 'Steinfort', 'Junglinster', 'Walferdange', 'Lorentzweiler', 'Mondercange', 'Käerjeng', 'Bascharage', 'Metz', 'Thionville', 'Arlon', 'Longwy', 'Trèves', 'Trier', 'Nancy'];

function findLocation(head: string[]): string | undefined {
  for (const l of head) {
    const pc = l.match(/\b(L-\d{4}|\d{5}|B-\d{4}|\d{4})\s+([A-ZÀ-Ý][\wÀ-ÿ' -]+)/);
    if (pc && !PHONE.test(pc[0].replace(/\s/g, ''))) return `${pc[2].trim()}`.replace(/\s*[,|].*$/, '');
    const city = LUX_PLACES.find((c) => new RegExp(`\\b${c}\\b`, 'i').test(l));
    if (city) return city;
  }
  return undefined;
}

const looksLikeName = (l: string) =>
  /^[A-ZÀ-Ýa-zà-ÿ' -]{3,50}$/.test(l) && l.trim().split(/\s+/).length >= 2 && l.trim().split(/\s+/).length <= 4
  && !headingOf(l) && !/\b(cv|curriculum|vitae|resume)\b/i.test(l);

function cleanDate(s: string): string { return s.replace(/\s+/g, ' ').trim(); }

/** Sépare une ligne « Poste – Entreprise, Ville » en poste / entreprise / lieu. */
function splitRole(line: string): { title: string; company: string; location: string } {
  const l = line.replace(RANGE, '').replace(SINCE, '').replace(/[()]/g, ' ').replace(/\s{2,}/g, ' ').replace(/^[\s,|–—-]+|[\s,|–—-]+$/g, '');
  const chez = l.match(/^(.*?)\s+(?:chez|at|bei|@|na|em)\s+(.*)$/i);
  let parts = chez ? [chez[1], chez[2]] : l.split(/\s+[|–—-]\s+|\s*[|]\s*/).map((x) => x.trim()).filter(Boolean);
  if (parts.length === 1 && l.includes(',')) parts = l.split(',').map((x) => x.trim());
  const [title = '', company = '', ...rest] = parts;
  let loc = rest.join(', ');
  let comp = company;
  if (!loc && comp.includes(',')) { const [c, ...r] = comp.split(','); comp = c.trim(); loc = r.join(',').trim(); }
  return { title, company: comp, location: loc };
}

function parseExperiences(lines: string[]): Experience[] {
  const out: Experience[] = [];
  let cur: Experience | null = null;
  let pendingTitle: string | null = null;
  const push = () => { if (cur && (cur.title || cur.company)) out.push(cur); cur = null; };
  const isDate = (l: string | undefined) => !!l && (RANGE.test(l) || SINCE.test(l));
  lines.forEach((raw, i) => {
    const line = raw.trim();
    // Ligne suivie d'une date : c'est l'intitulé du bloc suivant.
    if (!isDate(line) && isDate(lines[i + 1]) && !BULLET.test(raw) && line.length < 90) { push(); pendingTitle = line; return; }
    const range = line.match(RANGE);
    const since = !range && line.match(SINCE);
    if (range || since) {
      push();
      const start = cleanDate(range ? range[1] : (since as RegExpMatchArray)[1]);
      const endRaw = range ? range[2] : '';
      const end = !endRaw || NOW.test(endRaw) ? (endRaw ? cleanDate(endRaw) : '') : cleanDate(endRaw);
      const rest = splitRole(line);
      cur = { title: rest.title, company: rest.company, location: rest.location, start, end, achievements: [] };
      if (!cur.title && pendingTitle) { const p = splitRole(pendingTitle); cur.title = p.title; cur.company = cur.company || p.company; cur.location = cur.location || p.location; }
      pendingTitle = null;
      return;
    }
    if (BULLET.test(raw) && raw.replace(BULLET, '').length > 2) {
      if (cur) cur.achievements.push(raw.replace(BULLET, '').trim());
      return;
    }
    if (cur && !cur.title) { const p = splitRole(line); cur.title = p.title; cur.company = cur.company || p.company; cur.location = cur.location || p.location; return; }
    if (cur && !cur.company && line.length < 70) { const p = splitRole(line); cur.company = p.title; cur.location = cur.location || p.company; return; }
    if (cur && line.length >= 30) { cur.achievements.push(line); return; }
    if (line.length < 90) { if (cur) push(); pendingTitle = line; }
  });
  push();
  return out.slice(0, 15);
}

function parseEducation(lines: string[]): { degree: string; school: string; year: string }[] {
  const out: { degree: string; school: string; year: string }[] = [];
  for (const raw of lines) {
    const line = raw.replace(BULLET, '').trim();
    if (!line) continue;
    const years = line.match(/(19|20)\d{2}/g);
    const text = line.replace(RANGE, '').replace(/\b(19|20)\d{2}\b/g, '').replace(/[()]/g, ' ').replace(/\s{2,}/g, ' ').replace(/^[\s,|:–—-]+|[\s,|:–—-]+$/g, '');
    if (years) {
      const p = splitRole(text);
      out.push({ degree: p.title, school: [p.company, p.location].filter(Boolean).join(', '), year: years[years.length - 1] });
    } else if (out.length && !out[out.length - 1].school && text.length < 80) out[out.length - 1].school = text;
    else if (text.length < 120) { const p = splitRole(text); out.push({ degree: p.title, school: [p.company, p.location].filter(Boolean).join(', '), year: '' }); }
  }
  return out.filter((e) => e.degree).slice(0, 10);
}

const splitList = (lines: string[]) =>
  lines.flatMap((l) => l.replace(BULLET, '').split(/\s*[,;•·|]\s*/)).map((x) => x.trim()).filter((x) => x.length > 1 && x.length < 60);

const LEVEL = /\b(langue maternelle|maternelle|natif|native|courant|bilingue|fluent|interm[ée]diaire|d[ée]butant|notions?|scolaire|bon niveau|professionnel|basic|beginner|advanced|avanc[ée]|muttersprache|flie[sß]end|gut|grundkenntnisse|[ABC][12])\b/i;

function parseLanguages(lines: string[]): { language: string; level: string }[] {
  return splitList(lines.flatMap((l) => l.split(/\s{3,}/))).map((item) => {
    const m = item.match(/^([^:(–—-]+?)\s*(?:[:(–—-]\s*|\s+)(.*?)\)?$/);
    const lvl = item.match(LEVEL);
    if (m && lvl) return { language: m[1].trim(), level: m[2].trim() || lvl[0] };
    return { language: item.replace(/[:()]/g, '').trim(), level: lvl ? lvl[0] : '' };
  }).filter((x) => x.language && x.language.split(' ').length <= 3).slice(0, 8);
}

/** Propose un profil à partir du texte brut d'un CV. */
export function parseCv(text: string): ProfileData {
  const all = text.replace(/\r/g, '').split('\n').map((l) => l.replace(/\t/g, '  ').trimEnd());
  const sections: Record<Section | 'head', string[]> = { head: [], summary: [], experience: [], education: [], skills: [], languages: [], certifications: [], other: [] };
  let cur: Section | 'head' = 'head';
  for (const l of all) {
    if (!l.trim()) continue;
    const h = headingOf(l.trim());
    if (h) { cur = h; continue; }
    sections[cur].push(l);
  }
  const head = sections.head.map((l) => l.trim());
  const out: ProfileData = {};
  const nameIdx = head.findIndex((l) => looksLikeName(l) && !EMAIL.test(l) && !PHONE.test(l));
  if (nameIdx >= 0) out.full_name = head[nameIdx].split(/\s+/).map((w) => (w === w.toUpperCase() && w.length > 1 ? w[0] + w.slice(1).toLowerCase() : w)).join(' ');
  const contact = (l: string) => EMAIL.test(l) || PHONE.test(l) || URLISH.test(l) || /\b(rue|avenue|route|place|boulevard|chemin|strasse|straße|né|née|âge|nationalit|permis)\b/i.test(l) || /^\d/.test(l);
  const headline = head.slice(nameIdx + 1).find((l) => !contact(l) && l.length >= 3 && l.length <= 80 && l !== head[nameIdx]);
  if (headline) out.headline = headline.replace(BULLET, '');
  const loc = findLocation(head);
  if (loc) out.location = loc;
  // Résumé : rubrique dédiée, sinon le paragraphe le plus long de l'en-tête.
  const sum = sections.summary.join(' ').replace(/\s+/g, ' ').trim()
    || head.filter((l) => l.length > 80 && !contact(l)).join(' ');
  if (sum) out.summary = sum.slice(0, 1200);
  const exps = parseExperiences(sections.experience);
  if (exps.length) out.experiences = exps;
  const edu = parseEducation(sections.education);
  if (edu.length) out.education = edu;
  const skills = [...new Set(splitList(sections.skills))];
  if (skills.length) out.skills = skills.slice(0, 30);
  const langs = parseLanguages(sections.languages);
  if (langs.length) out.languages = langs;
  const certs = sections.certifications.map((l) => l.replace(BULLET, '').trim()).filter((l) => l.length > 2 && l.length < 140);
  if (certs.length) out.certifications = certs.slice(0, 15);
  return out;
}

const empty = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

/** Complète le profil existant sans écraser ce que l'utilisateur a déjà saisi. Renvoie aussi le nombre de champs remplis. */
export function mergeProfile(current: ProfileData, proposed: ProfileData): { data: ProfileData; filled: number } {
  const data: ProfileData = { ...current };
  let filled = 0;
  for (const k of Object.keys(proposed) as (keyof ProfileData)[]) {
    if (empty(current[k]) && !empty(proposed[k])) { (data as Record<string, unknown>)[k] = proposed[k]; filled++; }
  }
  return { data, filled };
}
