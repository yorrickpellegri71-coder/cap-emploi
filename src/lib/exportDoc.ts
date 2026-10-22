// Export des documents générés : Word (.docx) et PDF (impression du navigateur).
// Le texte suit une syntaxe minimale : « # » nom, « ## » section, « - » puce.

type Line = { kind: 'title' | 'heading' | 'bullet' | 'text' | 'blank'; text: string };

export function parseLines(text: string): Line[] {
  return text.split(/\r?\n/).map((raw) => {
    const l = raw.trimEnd();
    if (!l.trim()) return { kind: 'blank', text: '' };
    if (l.startsWith('# ')) return { kind: 'title', text: l.slice(2) };
    if (l.startsWith('## ')) return { kind: 'heading', text: l.slice(3) };
    if (/^\s*[-•*]\s+/.test(l)) return { kind: 'bullet', text: l.replace(/^\s*[-•*]\s+/, '') };
    return { kind: 'text', text: l };
  });
}

/** Retire le gras markdown (**texte**) pour Word et l'impression. */
const plain = (s: string) => s.replace(/\*\*(.+?)\*\*/g, '$1');

export function fileName(kind: string, company: string, ext: string) {
  const safe = company.replace(/[^\p{L}\p{N} _-]+/gu, '').trim().slice(0, 60);
  return `${kind}${safe ? ` - ${safe}` : ''}.${ext}`;
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function exportDocx(text: string, name: string) {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import('docx');
  const children = parseLines(text).map((l) => {
    switch (l.kind) {
      case 'title': return new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(plain(l.text))] });
      case 'heading': return new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 240 }, children: [new TextRun(plain(l.text))] });
      case 'bullet': return new Paragraph({ bullet: { level: 0 }, children: [new TextRun(plain(l.text))] });
      case 'blank': return new Paragraph({ children: [] });
      default: return new Paragraph({ spacing: { after: 80 }, children: [new TextRun(plain(l.text))] });
    }
  });
  const doc = new Document({
    styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
    sections: [{ properties: { page: { margin: { top: 1000, bottom: 1000, left: 1100, right: 1100 } } }, children }],
  });
  download(await Packer.toBlob(doc), name);
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function toHtml(text: string): string {
  const out: string[] = [];
  let list = false;
  for (const l of parseLines(text)) {
    if (l.kind !== 'bullet' && list) { out.push('</ul>'); list = false; }
    const inner = esc(l.text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    if (l.kind === 'title') out.push(`<h1>${inner}</h1>`);
    else if (l.kind === 'heading') out.push(`<h2>${inner}</h2>`);
    else if (l.kind === 'bullet') { if (!list) { out.push('<ul>'); list = true; } out.push(`<li>${inner}</li>`); }
    else if (l.kind === 'text') out.push(`<p>${inner}</p>`);
  }
  if (list) out.push('</ul>');
  return out.join('\n');
}

/** Ouvre une page d'impression : l'utilisateur choisit « Enregistrer en PDF ». */
export function exportPdf(text: string, title: string, lang: string) {
  const w = window.open('', '_blank');
  if (!w) throw new Error('popup');
  w.document.write(`<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>@page{margin:18mm}body{font:11pt/1.45 Calibri,Arial,sans-serif;color:#111;max-width:180mm;margin:0 auto}
h1{font-size:20pt;margin:0 0 4pt}h2{font-size:12pt;text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid #999;margin:14pt 0 6pt;padding-bottom:2pt}
p{margin:0 0 6pt}ul{margin:0 0 6pt;padding-left:16pt}li{margin:0 0 2pt}</style></head><body>${toHtml(text)}</body></html>`);
  w.document.close();
  w.focus();
  w.setTimeout(() => w.print(), 300);
}
