// Relevé des alertes e-mail des sites d'emploi, en option, directement depuis le navigateur.
// Le jeton d'accès reste en mémoire le temps du relevé : il n'est ni enregistré ni envoyé au serveur.
// Seuls l'expéditeur, l'objet, la date et le texte des alertes repérées sont transmis à la fonction serveur,
// qui en extrait les offres ; les e-mails eux-mêmes ne sont pas conservés.
import type { AlertEmail } from './api';

export type MailProvider = 'gmail' | 'outlook';

const GOOGLE_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
const MS_ID = import.meta.env.VITE_MS_CLIENT_ID as string | undefined;

export const mailConfigured = (p: MailProvider) => Boolean(p === 'gmail' ? GOOGLE_ID : MS_ID);

/** Expéditeurs habituels des alertes d'emploi au Luxembourg et dans la Grande Région. */
export const ALERT_SENDERS = [
  'jobs.lu', 'moovijob', 'adem', 'linkedin', 'indeed', 'monster', 'jooble', 'eures', 'paperjam', 'journaldespalaces',
  'lhotellerie-restauration', 'hosco', 'stepstone', 'welcometothejungle', 'glassdoor', 'apec', 'francetravail',
];
const MAX_EMAILS = 15;
const MAX_DAYS = 14;

/** Texte lisible d'un e-mail HTML. */
export function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('style, script, head').forEach((n) => n.remove());
  // Les liens des offres sont gardés en clair, pour que l'analyse puisse les recopier.
  doc.querySelectorAll('a[href^="http"]').forEach((a) => { a.textContent = `${a.textContent?.trim() ?? ''} (${a.getAttribute('href')})`; });
  // Le document n'est pas affiché : on marque nous-mêmes les fins de blocs.
  doc.querySelectorAll('p, div, br, tr, li, h1, h2, h3, h4, td, table').forEach((n) => n.append('\n'));
  return (doc.body?.textContent ?? '').replace(/[ \t\u00a0]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export const isAlertSender = (from: string) => ALERT_SENDERS.some((s) => from.toLowerCase().replace(/[\s-]/g, '').includes(s.replace(/-/g, '')));

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const el = document.createElement('script');
    el.src = src; el.async = true; el.onload = () => resolve(); el.onerror = () => reject(new Error('mail_script'));
    document.head.appendChild(el);
  });
}

// ───────────── Gmail (Google Identity Services, lecture seule) ─────────────

interface GoogleTokenClient { requestAccessToken: () => void }
interface GoogleOauth2 { initTokenClient: (cfg: { client_id: string; scope: string; callback: (r: { access_token?: string; error?: string }) => void; error_callback?: (e: { type: string }) => void }) => GoogleTokenClient }

async function gmailToken(): Promise<string> {
  await loadScript('https://accounts.google.com/gsi/client');
  const oauth2 = (window as unknown as { google?: { accounts: { oauth2: GoogleOauth2 } } }).google?.accounts.oauth2;
  if (!oauth2 || !GOOGLE_ID) throw new Error('mail_unavailable');
  return new Promise((resolve, reject) => {
    oauth2.initTokenClient({
      client_id: GOOGLE_ID,
      scope: 'https://www.googleapis.com/auth/gmail.readonly',
      callback: (r) => (r.access_token ? resolve(r.access_token) : reject(new Error('mail_denied'))),
      error_callback: () => reject(new Error('mail_denied')),
    }).requestAccessToken();
  });
}

type GmailPart = { mimeType?: string; body?: { data?: string }; parts?: GmailPart[] };
const b64 = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));
function gmailBody(part: GmailPart): string {
  const find = (p: GmailPart, type: string): string | null => {
    if (p.mimeType === type && p.body?.data) return b64(p.body.data);
    for (const c of p.parts ?? []) { const r = find(c, type); if (r) return r; }
    return null;
  };
  const html = find(part, 'text/html');
  return html ? htmlToText(html) : (find(part, 'text/plain') ?? '');
}

async function gmailAlerts(): Promise<AlertEmail[]> {
  const token = await gmailToken();
  const get = async (path: string) => {
    const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error('mail_failed');
    return r.json();
  };
  const q = `newer_than:${MAX_DAYS}d {${ALERT_SENDERS.map((s) => `from:${s}`).join(' ')}}`;
  const list = await get(`messages?maxResults=${MAX_EMAILS}&q=${encodeURIComponent(q)}`) as { messages?: { id: string }[] };
  const out: AlertEmail[] = [];
  for (const m of list.messages ?? []) {
    const msg = await get(`messages/${m.id}?format=full`) as { payload: GmailPart & { headers: { name: string; value: string }[] } };
    const h = (n: string) => msg.payload.headers.find((x) => x.name.toLowerCase() === n)?.value ?? '';
    out.push({ from: h('from'), subject: h('subject'), date: h('date'), text: gmailBody(msg.payload).slice(0, 12000) });
  }
  return out;
}

// ───────────── Outlook (Microsoft Graph, PKCE dans une fenêtre) ─────────────

const randomString = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');
async function challenge(verifier: string) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  return btoa(String.fromCharCode(...hash)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function outlookToken(): Promise<string> {
  if (!MS_ID) throw new Error('mail_unavailable');
  const redirect = new URL(`${import.meta.env.BASE_URL}oauth-callback.html`, window.location.origin).href;
  const verifier = randomString();
  const state = randomString();
  const auth = new URL('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
  Object.entries({
    client_id: MS_ID, response_type: 'code', redirect_uri: redirect, scope: 'Mail.Read offline_access', state,
    code_challenge: await challenge(verifier), code_challenge_method: 'S256', prompt: 'select_account',
  }).forEach(([k, v]) => auth.searchParams.set(k, v));
  const popup = window.open(auth.href, 'cap-oauth', 'width=520,height=680');
  if (!popup) throw new Error('popup');
  const code = await new Promise<string>((resolve, reject) => {
    const timer = window.setInterval(() => { if (popup.closed) { cleanup(); reject(new Error('mail_denied')); } }, 800);
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.data?.type !== 'cap-oauth') return;
      const p = new URLSearchParams(e.data.search as string);
      cleanup();
      if (p.get('state') !== state || !p.get('code')) reject(new Error('mail_denied')); else resolve(p.get('code')!);
    };
    const cleanup = () => { window.clearInterval(timer); window.removeEventListener('message', onMsg); };
    window.addEventListener('message', onMsg);
  });
  const r = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: MS_ID, grant_type: 'authorization_code', code, redirect_uri: redirect, code_verifier: verifier, scope: 'Mail.Read' }),
  });
  const tok = await r.json() as { access_token?: string };
  if (!tok.access_token) throw new Error('mail_denied');
  return tok.access_token;
}

async function outlookAlerts(): Promise<AlertEmail[]> {
  const token = await outlookToken();
  const since = new Date(Date.now() - MAX_DAYS * 86400000).toISOString();
  const url = `https://graph.microsoft.com/v1.0/me/messages?$top=50&$select=from,subject,receivedDateTime,body&$orderby=receivedDateTime desc&$filter=receivedDateTime ge ${since}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Prefer: 'outlook.body-content-type="html"' } });
  if (!r.ok) throw new Error('mail_failed');
  const data = await r.json() as { value: { from?: { emailAddress?: { address?: string; name?: string } }; subject: string; receivedDateTime: string; body: { content: string } }[] };
  return data.value
    .map((m) => ({ from: `${m.from?.emailAddress?.name ?? ''} <${m.from?.emailAddress?.address ?? ''}>`, subject: m.subject, date: m.receivedDateTime, html: m.body.content }))
    .filter((m) => isAlertSender(m.from))
    .slice(0, MAX_EMAILS)
    .map(({ html, ...m }) => ({ ...m, text: htmlToText(html).slice(0, 12000) }));
}

/** Relève les alertes d'emploi des 14 derniers jours dans la boîte choisie. */
export const fetchAlertEmails = (p: MailProvider) => (p === 'gmail' ? gmailAlerts() : outlookAlerts());
