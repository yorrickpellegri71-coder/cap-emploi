// Lecture du texte d'un PDF dans le navigateur (pdf.js), sans envoi à un serveur.
// Les morceaux de texte sont regroupés en lignes selon leur position verticale.
export async function pdfToText(buf: ArrayBuffer): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  const pages: string[] = [];
  for (let n = 1; n <= Math.min(doc.numPages, 10); n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    const rows: { y: number; x: number; s: string }[] = [];
    for (const it of content.items) {
      if (!('str' in it) || !it.str.trim()) continue;
      rows.push({ y: Math.round(it.transform[5]), x: it.transform[4], s: it.str });
    }
    rows.sort((a, b) => b.y - a.y || a.x - b.x);
    const lines: string[] = [];
    let y = Number.NaN;
    for (const r of rows) {
      if (Number.isNaN(y) || Math.abs(r.y - y) > 3) { lines.push(r.s); y = r.y; }
      else lines[lines.length - 1] += (/\s$/.test(lines[lines.length - 1]) || /^\s/.test(r.s) ? '' : ' ') + r.s;
    }
    pages.push(lines.join('\n'));
  }
  return pages.join('\n\n');
}
