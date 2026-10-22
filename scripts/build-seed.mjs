// Génère supabase/migrations/0002_modeles.sql à partir de scripts/modeles.json et src/lib/tradeKeywords.json.
import { readFileSync, writeFileSync } from 'node:fs';

const src = JSON.parse(readFileSync(new URL('./modeles.json', import.meta.url), 'utf8'));
const keywords = JSON.parse(readFileSync(new URL('../src/lib/tradeKeywords.json', import.meta.url), 'utf8'));
const q = (v) => `'${JSON.stringify(v).replaceAll("'", "''")}'::jsonb`;
const rows = [];
for (const [trade, langs] of Object.entries(src.sectors)) {
  for (const [lang, list] of Object.entries(langs)) rows.push(`('${trade}', '${lang}', 'sectors', ${q(list)})`);
}
for (const [trade, langs] of Object.entries(keywords)) {
  for (const [lang, list] of Object.entries(langs)) rows.push(`('${trade}', '${lang}', 'keywords', ${q(list)})`);
}
for (const [lang, msgs] of Object.entries(src.messages)) rows.push(`('*', '${lang}', 'messages', ${q(msgs)})`);

const sql = `-- Modèles par métier et par langue. Fichier généré par scripts/build-seed.mjs : modifier scripts/modeles.json ou src/lib/tradeKeywords.json.
insert into cap_emploi.modeles (trade, lang, kind, content) values
${rows.join(',\n')}
on conflict (trade, lang, kind) do update set content = excluded.content;
`;
writeFileSync(new URL('../supabase/migrations/0002_modeles.sql', import.meta.url), sql);
console.log(`${rows.length} modèles écrits.`);
