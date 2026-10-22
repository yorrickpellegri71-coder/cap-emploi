// Les trois langues doivent avoir exactement les mêmes clés et les mêmes variables.
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import de from './de.json';
import en from './en.json';
import fr from './fr.json';

type Dict = { [k: string]: string | Dict };
const flat = (d: Dict, p = ''): Record<string, string> =>
  Object.entries(d).reduce<Record<string, string>>((acc, [k, v]) => Object.assign(acc, typeof v === 'string' ? { [p + k]: v } : flat(v, `${p}${k}.`)), {});
const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');

const F = flat(fr), E = flat(en), D = flat(de);

describe('fichiers de traduction', () => {
  it('ont les mêmes clés', () => {
    expect(Object.keys(E).sort()).toEqual(Object.keys(F).sort());
    expect(Object.keys(D).sort()).toEqual(Object.keys(F).sort());
  });
  it('gardent les mêmes variables', () => {
    for (const k of Object.keys(F)) {
      expect(vars(E[k]), `en:${k}`).toBe(vars(F[k]));
      expect(vars(D[k]), `de:${k}`).toBe(vars(F[k]));
    }
  });
  it('couvrent toutes les clés statiques du code', () => {
    const dir = new URL('../', import.meta.url);
    const files = ['App.tsx', ...['pages', 'components'].flatMap((d) => readdirSync(new URL(d, dir)).map((f) => `${d}/${f}`))];
    const missing: string[] = [];
    for (const f of files) {
      const src = readFileSync(new URL(f, dir), 'utf8');
      for (const m of src.matchAll(/\bt\('([a-zA-Z_.]+)'/g)) if (!(m[1] in F)) missing.push(`${f}: ${m[1]}`);
    }
    expect(missing).toEqual([]);
  });
});
