// Dossier sans IA : assemblé uniquement à partir des faits du profil, dans la langue choisie.
// Rien n'est inventé ; les passages à personnaliser sont signalés entre crochets.
import type { Lang, ProfileData } from './types';

export interface DossierInput { company: string; jobTitle: string; contact: string; lang: Lang; profile: ProfileData; displayName: string }
export interface DossierPieces { email_subject: string; email_body: string; letter: string; cv: string; pitch: string; gaps: string[] }

const L = {
  fr: {
    subject: (job: string) => `Candidature${job ? ` – ${job}` : ' spontanée'}`,
    greet: (c: string) => (c ? `Bonjour ${c},` : 'Madame, Monsieur,'),
    emailBody: (job: string, co: string, proof: string) => `Je vous adresse ma candidature${job ? ` au poste de ${job}` : ''} chez ${co}. Vous trouverez ci-joint mon CV et ma lettre de motivation.${proof ? `\n\nEn quelques mots : ${proof}` : ''}\n\nJe reste à votre disposition pour un entretien.`,
    close: 'Je vous prie d’agréer mes salutations distinguées.',
    closeMail: 'Bien cordialement,',
    letterIntro: (job: string, co: string) => `Je souhaite rejoindre ${co}${job ? ` en tant que ${job}` : ''}. [Précisez ici pourquoi cette entreprise et ce poste vous intéressent.]`,
    letterProofs: 'Parmi mes réalisations :',
    letterAsk: 'Je me tiens à votre disposition pour vous présenter, lors d’un entretien, ce que je peux apporter à votre équipe.',
    pitch: (who: string, head: string, summary: string, job: string, co: string) => `Je suis ${who}${head ? `, ${head}` : ''}. ${summary ? `${summary} ` : ''}Je m’intéresse${job ? ` au poste de ${job}` : ''} chez ${co}.`,
    sections: { profile: 'Profil', exp: 'Expérience', skills: 'Compétences', langs: 'Langues', edu: 'Formation', certs: 'Certifications' },
    gap: 'Dossier modèle préparé sans IA à partir de votre profil : personnalisez la lettre (passages entre crochets) et vérifiez chaque pièce avant l’envoi.',
    now: 'aujourd’hui',
  },
  en: {
    subject: (job: string) => `Application${job ? ` – ${job}` : ' (speculative)'}`,
    greet: (c: string) => (c ? `Dear ${c},` : 'Dear Sir or Madam,'),
    emailBody: (job: string, co: string, proof: string) => `Please find attached my application${job ? ` for the ${job} position` : ''} at ${co}, with my CV and cover letter.${proof ? `\n\nIn brief: ${proof}` : ''}\n\nI would welcome the opportunity to discuss it with you in an interview.`,
    close: 'Yours faithfully,',
    closeMail: 'Kind regards,',
    letterIntro: (job: string, co: string) => `I would like to join ${co}${job ? ` as ${job}` : ''}. [Explain here why this company and this role appeal to you.]`,
    letterProofs: 'Among my achievements:',
    letterAsk: 'I would be glad to tell you more about what I can bring to your team in an interview.',
    pitch: (who: string, head: string, summary: string, job: string, co: string) => `I am ${who}${head ? `, ${head}` : ''}. ${summary ? `${summary} ` : ''}I am interested in${job ? ` the ${job} position at` : ' joining'} ${co}.`,
    sections: { profile: 'Profile', exp: 'Experience', skills: 'Skills', langs: 'Languages', edu: 'Education', certs: 'Certifications' },
    gap: 'Template pack prepared without AI from your profile: personalise the letter (passages in brackets) and check every piece before sending.',
    now: 'present',
  },
  de: {
    subject: (job: string) => `Bewerbung${job ? ` – ${job}` : ' (Initiativbewerbung)'}`,
    greet: (c: string) => (c ? `Guten Tag ${c},` : 'Sehr geehrte Damen und Herren,'),
    emailBody: (job: string, co: string, proof: string) => `anbei sende ich Ihnen meine Bewerbung${job ? ` als ${job}` : ''} bei ${co} mit Lebenslauf und Anschreiben.${proof ? `\n\nKurz zu mir: ${proof}` : ''}\n\nÜber ein persönliches Gespräch würde ich mich freuen.`,
    close: 'Mit freundlichen Grüßen',
    closeMail: 'Mit freundlichen Grüßen',
    letterIntro: (job: string, co: string) => `Ich möchte ${co}${job ? ` als ${job}` : ''} verstärken. [Erläutern Sie hier, warum Sie dieses Unternehmen und diese Stelle interessieren.]`,
    letterProofs: 'Zu meinen Erfolgen zählen:',
    letterAsk: 'Gerne erläutere ich Ihnen in einem persönlichen Gespräch, was ich in Ihr Team einbringen kann.',
    pitch: (who: string, head: string, summary: string, job: string, co: string) => `Ich bin ${who}${head ? `, ${head}` : ''}. ${summary ? `${summary} ` : ''}Ich interessiere mich für${job ? ` die Stelle als ${job} bei` : ' eine Tätigkeit bei'} ${co}.`,
    sections: { profile: 'Profil', exp: 'Berufserfahrung', skills: 'Kompetenzen', langs: 'Sprachen', edu: 'Ausbildung', certs: 'Zertifikate' },
    gap: 'Mustervorlage ohne KI aus Ihrem Profil erstellt: Passen Sie das Anschreiben an (Stellen in eckigen Klammern) und prüfen Sie jedes Dokument vor dem Versand.',
    now: 'heute',
  },
} as const;

/** CV en texte avec titres simples, repris tel quel du profil. */
export function profileCv(p: ProfileData, name: string, lang: Lang): string {
  const s = L[lang].sections;
  const out: string[] = [`# ${p.full_name || name}`];
  if (p.headline) out.push(p.headline);
  if (p.location) out.push(p.location);
  if (p.summary) out.push('', `## ${s.profile}`, p.summary);
  if (p.experiences?.length) {
    out.push('', `## ${s.exp}`);
    for (const x of p.experiences) {
      out.push('', `### ${[x.title, x.company].filter(Boolean).join(' – ')}`);
      const when = [x.start, x.end || (x.start ? L[lang].now : '')].filter(Boolean).join(' – ');
      if (when || x.location) out.push([when, x.location].filter(Boolean).join(' · '));
      for (const a of x.achievements ?? []) out.push(`- ${a}`);
    }
  }
  if (p.skills?.length) out.push('', `## ${s.skills}`, ...p.skills.map((x) => `- ${x}`));
  if (p.languages?.length) out.push('', `## ${s.langs}`, ...p.languages.map((x) => `- ${x.language}${x.level ? ` : ${x.level}` : ''}`));
  if (p.education?.length) out.push('', `## ${s.edu}`, ...p.education.map((x) => `- ${[x.degree, x.school, x.year].filter(Boolean).join(', ')}`));
  if (p.certifications?.length) out.push('', `## ${s.certs}`, ...p.certifications.map((x) => `- ${x}`));
  return out.join('\n');
}

export function buildDossier(i: DossierInput): DossierPieces {
  const t = L[i.lang];
  const p = i.profile;
  const who = p.full_name || i.displayName;
  const co = i.company.trim();
  const job = i.jobTitle.trim();
  const proofs = (p.experiences ?? []).flatMap((x) => x.achievements ?? []).filter(Boolean).slice(0, 3);
  const firstProof = proofs[0] ?? '';
  const sign = `\n\n${who}`;
  const letter = [
    t.greet(i.contact.trim()),
    '',
    t.letterIntro(job, co),
    p.summary ? `\n${p.summary}` : '',
    proofs.length ? `\n${t.letterProofs}\n${proofs.map((x) => `- ${x}`).join('\n')}` : '',
    '',
    t.letterAsk,
    '',
    t.close + sign,
  ].filter((x, k, a) => !(x === '' && a[k - 1] === '')).join('\n');
  return {
    email_subject: t.subject(job),
    email_body: `${t.greet(i.contact.trim())}\n\n${t.emailBody(job, co, firstProof)}\n\n${t.closeMail}${sign}`,
    letter,
    cv: profileCv(p, i.displayName, i.lang),
    pitch: t.pitch(who, p.headline ?? '', p.summary ?? '', job, co).replace(/\s+/g, ' ').trim(),
    gaps: [t.gap],
  };
}
