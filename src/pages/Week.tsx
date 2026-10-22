import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Empty, ErrorState, Notice, errorMessage, fmtDate } from '../components/ui';
import { useI18n } from '../i18n';
import { bumpCounter, countNewOffers, fetchWeek, moveTarget } from '../lib/api';
import { daysBetween, dueFollowups, isoDay, isoWeek, shiftWeek, weekMonday } from '../lib/dates';
import { useApp } from '../lib/session';
import { COUNTERS, STAGES, type CounterKey, type Counters, type Target } from '../lib/types';

function weekLabel(week: string, locale: string) {
  const start = weekMonday(week);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const f = (d: Date) => d.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
  return `${f(start)} – ${f(end)}`;
}

export function Week() {
  const { t, locale } = useI18n();
  const { profile, targets, setTargets } = useApp();
  const current = isoWeek();
  const [week, setWeek] = useState(current);
  const [counters, setCounters] = useState<Counters | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setCounters(null);
    try { setCounters(await fetchWeek(week)); } catch (e) { setError(e); }
  }, [week]);
  useEffect(() => { void load(); }, [load]);
  const [fresh, setFresh] = useState(0);
  useEffect(() => { countNewOffers().then(setFresh).catch(() => undefined); }, []);

  const bump = async (key: CounterKey, delta: number) => {
    setActionError(null);
    // Affichage immédiat, puis valeur confirmée par la base.
    setCounters((c) => ({ ...c, [key]: Math.max((c?.[key] ?? 0) + delta, 0) }));
    try { setCounters(await bumpCounter(key, delta, week)); } catch (e) { setActionError(e); void load(); }
  };

  const followupSent = async (target: Target) => {
    setBusy(target.id);
    setActionError(null);
    try {
      const row = await moveTarget(target, 'followed_up');
      setTargets((list) => list.map((x) => (x.id === row.id ? row : x)));
      if (week === current) setCounters(await fetchWeek(week));
    } catch (e) { setActionError(e); } finally { setBusy(null); }
  };

  const due = dueFollowups(targets, profile.followup_days);
  const today = isoDay();
  const [y, w] = week.split('-W');

  return (
    <div className="page stack-xl">
      <header className="page-head">
        <div>
          <p className="eyebrow">{t('week.eyebrow', { n: Number(w), year: y })}</p>
          <h1 className="h1">{t('week.title')}</h1>
        </div>
        <div className="week-nav">
          <button type="button" className="btn btn-sm" aria-label={t('week.prev')} onClick={() => setWeek((x) => shiftWeek(x, -1))}>←</button>
          <span className="small">{weekLabel(week, locale)}</span>
          <button type="button" className="btn btn-sm" aria-label={t('week.next')} onClick={() => setWeek((x) => shiftWeek(x, 1))}>→</button>
          {week !== current && <button type="button" className="link-btn small" onClick={() => setWeek(current)}>{t('week.today')}</button>}
        </div>
      </header>

      {fresh > 0 && (
        <Notice tone="warn">
          <span className="alert-banner"><strong>🔔 {t('offers.alertWeek', { n: fresh })}</strong> <Link className="btn btn-sm" to="/offres">{t('offers.see')}</Link></span>
        </Notice>
      )}
      {actionError != null && <Notice tone="error">{errorMessage(actionError, t)}</Notice>}

      <section aria-labelledby="goals-h" className="stack">
        <h2 id="goals-h" className="h2">{t('week.goals')}</h2>
        {error != null ? <ErrorState error={error} onRetry={() => void load()} /> : (
          <div className="counter-grid">
            {COUNTERS.map((k) => {
              const value = counters?.[k] ?? 0;
              const goal = profile.goals[k] ?? 0;
              const pct = goal ? Math.min(100, Math.round((value / goal) * 100)) : 0;
              return (
                <div key={k} className={`card counter ${goal && value >= goal ? 'done' : ''}`}>
                  <div className="row-between">
                    <span className="small strong">{t(`counters.${k}`)}</span>
                    <span className="mono">{counters ? value : '…'}<span className="muted"> / {goal}</span></span>
                  </div>
                  <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={goal} aria-valuenow={value} aria-label={t(`counters.${k}`)}><span style={{ width: `${pct}%` }} /></div>
                  <div className="row-end">
                    <button type="button" className="btn btn-sm" disabled={!counters || value === 0} aria-label={`${t('week.minus')} ${t(`counters.${k}`)}`} onClick={() => void bump(k, -1)}>−</button>
                    <button type="button" className="btn btn-sm btn-primary" disabled={!counters} aria-label={`${t('week.plus')} ${t(`counters.${k}`)}`} onClick={() => void bump(k, 1)}>+</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section aria-labelledby="due-h" className="stack">
        <div className="row-between">
          <h2 id="due-h" className="h2">{t('week.followups')} {due.length > 0 && <span className="pill">{due.length}</span>}</h2>
          <span className="small muted">{t('week.followupRule', { n: profile.followup_days })}</span>
        </div>
        {due.length === 0 ? (
          <Empty title={t('week.noFollowups')}>{t('week.noFollowupsHint')}</Empty>
        ) : (
          <ul className="list">
            {due.map((tg) => (
              <li key={tg.id} className="list-item">
                <div className="grow">
                  <strong>{tg.company}</strong>
                  <span className="small muted"> · {tg.contact_name || t('targets.noContact')} · {t(`channels.${tg.channel}`)}</span>
                  <div className="xs muted">{t('week.lastContact', { date: fmtDate(tg.last_contact_on, locale), n: daysBetween(tg.last_contact_on!, today) })}</div>
                </div>
                <div className="row-end">
                  <Link className="btn btn-sm" to={`/messages?cible=${tg.id}&type=followup`}>{t('week.copyFollowup')}</Link>
                  <button type="button" className="btn btn-sm btn-primary" disabled={busy === tg.id} onClick={() => void followupSent(tg)}>{t('week.followupSent')}</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="pipe-h" className="stack">
        <div className="row-between">
          <h2 id="pipe-h" className="h2">{t('week.pipeline')}</h2>
          <Link to="/cibles" className="small">{t('week.seeTargets')} →</Link>
        </div>
        <div className="stage-strip">
          {STAGES.map((s) => (
            <Link key={s} to={`/cibles#${s}`} className={`stage-chip st-${s}`}>
              <span className="mono strong">{targets.filter((x) => x.stage === s).length}</span>
              <span className="xs">{t(`stages.${s}`)}</span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
