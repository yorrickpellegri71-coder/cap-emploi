import { useRef, useState, type ChangeEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Notice, errorMessage } from '../components/ui';
import { useI18n } from '../i18n';
import { AiError, deleteMyAccount, exportMyData, extractProfile } from '../lib/api';
import { useApp } from '../lib/session';
import { COUNTERS, LANGS, TRADES, type Counters, type Experience, type Lang, type ProfileData } from '../lib/types';

const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);

function toBase64(buf: ArrayBuffer): string {
  let bin = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Édition du profil extrait : chaque champ reste modifiable, l'IA ne fait que proposer. */
function ProfileEditor({ data, onChange }: { data: ProfileData; onChange: (d: ProfileData) => void }) {
  const { t } = useI18n();
  const set = <K extends keyof ProfileData>(k: K, v: ProfileData[K]) => onChange({ ...data, [k]: v });
  const exps = data.experiences ?? [];
  const setExp = (i: number, patch: Partial<Experience>) => set('experiences', exps.map((e, j) => (j === i ? { ...e, ...patch } : e)));

  return (
    <div className="stack-lg">
      <div className="grid-2">
        <div className="field">
          <label htmlFor="pd-name">{t('profile.fullName')}</label>
          <input id="pd-name" className="input" value={data.full_name ?? ''} onChange={(e) => set('full_name', e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="pd-headline">{t('profile.headline')}</label>
          <input id="pd-headline" className="input" value={data.headline ?? ''} onChange={(e) => set('headline', e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="pd-location">{t('profile.location')}</label>
          <input id="pd-location" className="input" value={data.location ?? ''} onChange={(e) => set('location', e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="pd-summary">{t('profile.summary')}</label>
        <textarea id="pd-summary" className="input" rows={4} value={data.summary ?? ''} onChange={(e) => set('summary', e.target.value)} />
      </div>

      <fieldset className="stack">
        <legend className="h3">{t('profile.experiences')}</legend>
        {exps.map((x, i) => (
          <div key={i} className="card card-flat stack">
            <div className="grid-2">
              <input className="input" aria-label={t('profile.expTitle')} placeholder={t('profile.expTitle')} value={x.title} onChange={(e) => setExp(i, { title: e.target.value })} />
              <input className="input" aria-label={t('profile.expCompany')} placeholder={t('profile.expCompany')} value={x.company} onChange={(e) => setExp(i, { company: e.target.value })} />
              <input className="input" aria-label={t('profile.expStart')} placeholder={t('profile.expStart')} value={x.start} onChange={(e) => setExp(i, { start: e.target.value })} />
              <input className="input" aria-label={t('profile.expEnd')} placeholder={t('profile.expEnd')} value={x.end} onChange={(e) => setExp(i, { end: e.target.value })} />
            </div>
            <label className="small" htmlFor={`exp-ach-${i}`}>{t('profile.achievements')}</label>
            <textarea id={`exp-ach-${i}`} className="input" rows={4} value={x.achievements.join('\n')}
              onChange={(e) => setExp(i, { achievements: e.target.value.split('\n') })} />
            <button type="button" className="link-btn danger small" style={{ alignSelf: 'flex-start' }}
              onClick={() => set('experiences', exps.filter((_, j) => j !== i))}>{t('common.delete')}</button>
          </div>
        ))}
        <button type="button" className="btn btn-sm" style={{ alignSelf: 'flex-start' }}
          onClick={() => set('experiences', [...exps, { title: '', company: '', location: '', start: '', end: '', achievements: [] }])}>+ {t('profile.addExperience')}</button>
      </fieldset>

      <div className="grid-2">
        <div className="field">
          <label htmlFor="pd-skills">{t('profile.skills')}</label>
          <textarea id="pd-skills" className="input" rows={5} value={(data.skills ?? []).join('\n')} onChange={(e) => set('skills', e.target.value.split('\n'))} />
          <span className="hint">{t('profile.onePerLine')}</span>
        </div>
        <div className="field">
          <label htmlFor="pd-langs">{t('profile.languages')}</label>
          <textarea id="pd-langs" className="input" rows={5}
            value={(data.languages ?? []).map((l) => (l.level ? `${l.language} – ${l.level}` : l.language)).join('\n')}
            onChange={(e) => set('languages', e.target.value.split('\n').map((l) => { const [language, ...rest] = l.split(/\s+[–-]\s+/); return { language, level: rest.join(' – ') }; }))} />
          <span className="hint">{t('profile.langFormat')}</span>
        </div>
        <div className="field">
          <label htmlFor="pd-edu">{t('profile.education')}</label>
          <textarea id="pd-edu" className="input" rows={4}
            value={(data.education ?? []).map((d) => [d.degree, d.school, d.year].filter(Boolean).join(' – ')).join('\n')}
            onChange={(e) => set('education', e.target.value.split('\n').map((l) => { const [degree = '', school = '', year = ''] = l.split(/\s+[–-]\s+/); return { degree, school, year }; }))} />
          <span className="hint">{t('profile.eduFormat')}</span>
        </div>
        <div className="field">
          <label htmlFor="pd-certs">{t('profile.certifications')}</label>
          <textarea id="pd-certs" className="input" rows={4} value={(data.certifications ?? []).join('\n')} onChange={(e) => set('certifications', e.target.value.split('\n'))} />
        </div>
      </div>
    </div>
  );
}

/** Nettoie les listes saisies ligne par ligne avant l'enregistrement. */
function clean(d: ProfileData): ProfileData {
  return {
    ...d,
    skills: lines((d.skills ?? []).join('\n')),
    certifications: lines((d.certifications ?? []).join('\n')),
    languages: (d.languages ?? []).filter((l) => l.language.trim()),
    education: (d.education ?? []).filter((x) => x.degree.trim() || x.school.trim()),
    experiences: (d.experiences ?? []).map((x) => ({ ...x, achievements: lines(x.achievements.join('\n')) })).filter((x) => x.title.trim() || x.company.trim()),
  };
}

export function Profile() {
  const { t } = useI18n();
  const { profile, updateProfile } = useApp();
  const [params] = useSearchParams();
  const welcome = params.get('bienvenue') === '1';
  const fileRef = useRef<HTMLInputElement>(null);

  const [cvText, setCvText] = useState(profile.cv_text);
  const [data, setData] = useState<ProfileData>(profile.profile_data);
  const [name, setName] = useState(profile.display_name);
  const [trade, setTrade] = useState(profile.trade);
  const [docLang, setDocLang] = useState<Lang>(profile.doc_lang);
  const [goals, setGoals] = useState<Counters>(profile.goals);
  const [days, setDays] = useState(profile.followup_days);

  const [extracting, setExtracting] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error' | 'info'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState('');

  const aiMessage = (e: unknown) => (e instanceof AiError ? t(`errors.ai.${e.code}`) : errorMessage(e, t));

  const runExtract = async (input: { cv_text?: string; pdf_base64?: string }) => {
    setExtracting(true);
    setNotice({ tone: 'info', text: t('profile.extracting') });
    try {
      const { profile: p } = await extractProfile(input);
      const { cv_text, ...rest } = p;
      if (cv_text && !input.cv_text) setCvText(cv_text);
      setData(rest);
      setNotice({ tone: 'ok', text: t('profile.extracted') });
    } catch (e) {
      setNotice({ tone: 'error', text: aiMessage(e) });
    } finally { setExtracting(false); }
  };

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { setNotice({ tone: 'error', text: t('errors.ai.file_too_large') }); return; }
    try {
      const name = file.name.toLowerCase();
      if (name.endsWith('.pdf')) return void (await runExtract({ pdf_base64: toBase64(await file.arrayBuffer()) }));
      let text: string;
      if (name.endsWith('.docx')) {
        const mammoth = await import('mammoth');
        text = (await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value;
      } else text = await file.text();
      setCvText(text);
      await runExtract({ cv_text: text });
    } catch (err) {
      setNotice({ tone: 'error', text: errorMessage(err, t) });
    }
  };

  const save = async () => {
    setSaving(true);
    setNotice(null);
    try {
      const cleaned = clean(data);
      await updateProfile({ display_name: name.trim(), trade, doc_lang: docLang, goals, followup_days: days, cv_text: cvText, profile_data: cleaned });
      setData(cleaned);
      setNotice({ tone: 'ok', text: t('common.saved') });
    } catch (e) {
      setNotice({ tone: 'error', text: errorMessage(e, t) });
    } finally { setSaving(false); }
  };

  const exportData = async () => {
    try {
      const blob = await exportMyData();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'cap-emploi-donnees.json';
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) { setNotice({ tone: 'error', text: errorMessage(e, t) }); }
  };

  const deleteWord = t('profile.deleteWord');

  return (
    <div className="page stack-xl">
      <header className="page-head">
        <div>
          <p className="eyebrow">{t('profile.eyebrow')}</p>
          <h1 className="h1">{t('profile.title')}</h1>
        </div>
        <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void save()}>{saving ? t('common.wait') : t('common.save')}</button>
      </header>

      {welcome && <Notice tone="info">{t('profile.welcome')}</Notice>}
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

      <section className="card stack-lg" aria-labelledby="cv-h">
        <h2 id="cv-h" className="h2">{t('profile.cvTitle')}</h2>
        <p className="small muted">{t('profile.cvIntro')}</p>
        <div className="row-end wrap" style={{ justifyContent: 'flex-start' }}>
          <input ref={fileRef} type="file" accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" hidden onChange={(e) => void onFile(e)} />
          <button type="button" className="btn btn-primary" disabled={extracting} onClick={() => fileRef.current?.click()}>{t('profile.import')}</button>
          <button type="button" className="btn" disabled={extracting || cvText.trim().length < 50} onClick={() => void runExtract({ cv_text: cvText })}>{t('profile.extract')}</button>
        </div>
        <details>
          <summary className="small">{t('profile.cvText')}</summary>
          <textarea className="input" rows={12} aria-label={t('profile.cvText')} value={cvText} onChange={(e) => setCvText(e.target.value)} />
        </details>
      </section>

      <section className="card stack-lg" aria-labelledby="pd-h">
        <h2 id="pd-h" className="h2">{t('profile.dataTitle')}</h2>
        <p className="small muted">{t('profile.dataIntro')}</p>
        <ProfileEditor data={data} onChange={setData} />
      </section>

      <section className="card stack-lg" aria-labelledby="set-h">
        <h2 id="set-h" className="h2">{t('profile.settings')}</h2>
        <div className="grid-2">
          <div className="field">
            <label htmlFor="p-name">{t('profile.name')}</label>
            <input id="p-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="p-trade">{t('profile.trade')}</label>
            <select id="p-trade" className="input" value={trade} onChange={(e) => setTrade(e.target.value)}>
              {TRADES.map((x) => <option key={x} value={x}>{t(`trades.${x}.name`)}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="p-doc">{t('profile.docLang')}</label>
            <select id="p-doc" className="input" value={docLang} onChange={(e) => setDocLang(e.target.value as Lang)}>
              {LANGS.map((l) => <option key={l} value={l}>{t(`langs.${l}`)}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="p-days">{t('profile.followupDays')}</label>
            <input id="p-days" className="input" type="number" min={1} max={60} value={days} onChange={(e) => setDays(Math.min(60, Math.max(1, Number(e.target.value) || 7)))} />
          </div>
        </div>
        <fieldset className="stack">
          <legend className="h3">{t('profile.goals')}</legend>
          <div className="goal-grid">
            {COUNTERS.map((k) => (
              <div key={k} className="field">
                <label htmlFor={`g-${k}`}>{t(`counters.${k}`)}</label>
                <input id={`g-${k}`} className="input" type="number" min={0} max={50} value={goals[k] ?? 0}
                  onChange={(e) => setGoals((g) => ({ ...g, [k]: Math.min(50, Math.max(0, Number(e.target.value) || 0)) }))} />
              </div>
            ))}
          </div>
        </fieldset>
        <div className="row-end"><button type="button" className="btn btn-primary" disabled={saving} onClick={() => void save()}>{t('common.save')}</button></div>
      </section>

      <section className="card stack-lg" aria-labelledby="acc-h">
        <h2 id="acc-h" className="h2">{t('profile.account')}</h2>
        <p className="small muted">{t('profile.accountIntro')}</p>
        <div><button type="button" className="btn" onClick={() => void exportData()}>{t('profile.export')}</button></div>
        <div className="field">
          <label htmlFor="del-confirm">{t('profile.deleteLabel', { word: deleteWord })}</label>
          <div className="row-end wrap" style={{ justifyContent: 'flex-start' }}>
            <input id="del-confirm" className="input" value={confirmDelete} onChange={(e) => setConfirmDelete(e.target.value)} />
            <button type="button" className="btn btn-danger" disabled={confirmDelete.trim().toUpperCase() !== deleteWord.toUpperCase()}
              onClick={async () => { try { await deleteMyAccount(); } catch (e) { setNotice({ tone: 'error', text: errorMessage(e, t) }); } }}>
              {t('profile.delete')}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
