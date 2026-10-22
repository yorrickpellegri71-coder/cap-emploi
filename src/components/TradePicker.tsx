import { useI18n } from '../i18n';
import { TRADES } from '../lib/types';

/** Choix de plusieurs métiers visés ; le premier coché est le métier principal. */
export function TradePicker({ value, onChange, legend, hint, hideLegend = false }: { value: string[]; onChange: (v: string[]) => void; legend: string; hint: string; hideLegend?: boolean }) {
  const { t } = useI18n();
  const toggle = (tr: string) => {
    if (value.includes(tr)) { if (value.length > 1) onChange(value.filter((x) => x !== tr)); }
    else onChange([...value.filter((x) => x !== 'general' || tr === 'general'), tr]);
  };
  return (
    <fieldset className="field">
      <legend className={hideLegend ? 'sr-only' : undefined}>{legend}</legend>
      <span className="hint">{hint}</span>
      <div className="choice-grid">
        {TRADES.map((tr) => {
          const on = value.includes(tr);
          return (
            <label key={tr} className={`choice ${on ? 'selected' : ''}`}>
              <input type="checkbox" name="trades" value={tr} checked={on} onChange={() => toggle(tr)} />
              <strong>{t(`trades.${tr}.name`)}{on && value[0] === tr && value.length > 1 ? <span className="tag tag-main">{t('profile.mainTrade')}</span> : null}</strong>
              <span className="small muted">{t(`trades.${tr}.desc`)}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
