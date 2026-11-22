import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Brand, LangSwitch, Notice, errorMessage } from '../components/ui';
import { useI18n } from '../i18n';
import { AiError, openBillingPortal, startCheckout } from '../lib/api';
import { FREE_DOCS, PLANS, PRICE_EUR, isPlanId, isPremium, premiumEnd, type PlanId } from '../lib/plans';
import { useSession } from '../lib/session';

const ERR_CODES = ['billing_disabled', 'already_subscribed', 'no_customer', 'billing_unavailable', 'network', 'unauthorized'];
const errKey = (e: AiError) => `pricing.err.${ERR_CODES.includes(e.code) ? e.code : 'server_error'}`;

const FEATURES: Record<PlanId, string[]> = {
  free: ['pricing.f.profile', 'pricing.f.search', 'pricing.f.freeDocs', 'pricing.f.tracking'],
  monthly: ['pricing.f.unlimited', 'pricing.f.tracking', 'pricing.f.followups', 'pricing.f.cancel'],
  pass: ['pricing.f.unlimited', 'pricing.f.tracking', 'pricing.f.followups', 'pricing.f.noRenewal'],
};

/** Page des tarifs : publique (renvoie vers l'inscription) ou connectée (renvoie vers le paiement Stripe). */
export function Pricing() {
  const { t, lang, locale } = useI18n();
  const { session, profile, reload } = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const paid = params.get('paiement');
  const wanted = params.get('formule');
  const [busy, setBusy] = useState<PlanId | 'portal' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const premium = profile ? isPremium(profile) : false;
  const end = profile ? premiumEnd(profile) : null;
  const subscribed = ['active', 'trialing', 'past_due'].includes(profile?.subscription_status ?? '');
  const money = (n: number) => new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR', maximumFractionDigits: n % 1 ? 2 : 0 }).format(n);
  const date = (d: string) => new Date(d).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });

  // Retour de Stripe : le webhook peut arriver quelques secondes après ; on recharge le profil jusqu'à le voir.
  useEffect(() => {
    if (paid !== 'ok' || !session || premium) return;
    let n = 0;
    const id = window.setInterval(() => { n += 1; void reload(); if (n >= 8) window.clearInterval(id); }, 2500);
    return () => window.clearInterval(id);
  }, [paid, session, premium, reload]);

  const choose = async (plan: PlanId) => {
    setError(null);
    if (!session) { navigate(`/inscription?formule=${plan}`); return; }
    if (plan === 'free') { navigate('/'); return; }
    setBusy(plan);
    try {
      await startCheckout(plan, lang);
    } catch (e) {
      setError(e instanceof AiError ? t(errKey(e)) : errorMessage(e, t));
      setBusy(null);
    }
  };

  const portal = async () => {
    setBusy('portal');
    try { await openBillingPortal(); } catch (e) { setError(e instanceof AiError ? t(errKey(e)) : errorMessage(e, t)); setBusy(null); }
  };

  const cta = (plan: PlanId) => {
    if (!session) return plan === 'free' ? t('pricing.ctaFree') : t('pricing.ctaSignup');
    if (plan === 'free') return premium ? t('pricing.backApp') : t('pricing.current');
    if (plan === 'monthly' && subscribed) return t('pricing.current');
    return plan === 'monthly' ? t('pricing.ctaMonthly') : premium ? t('pricing.ctaExtend') : t('pricing.ctaPass');
  };

  return (
    <div className="page stack-xl">
      <div className="row-between">
        <Brand to={session ? '/' : '/connexion'} />
        <div className="row-end">
          <LangSwitch />
          <Link className="btn btn-sm" to={session ? '/' : '/connexion'}>{session ? t('pricing.backApp') : t('auth.loginCta')}</Link>
        </div>
      </div>

      <header className="stack">
        <h1 className="h1">{t('pricing.title')}</h1>
        <p className="lead">{t('pricing.intro')}</p>
      </header>

      {paid === 'ok' && (premium
        ? <Notice tone="ok"><strong>{t('pricing.thanks')}</strong> {end ? t('pricing.activeUntil', { date: date(end) }) : ''}</Notice>
        : <Notice tone="info">{t('pricing.pending')}</Notice>)}
      {paid === 'annule' && <Notice tone="warn">{t('pricing.canceled')}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      {session && premium && paid !== 'ok' && (
        <Notice tone="ok">{end ? t('pricing.activeUntil', { date: date(end) }) : t('pricing.activeGift')}</Notice>
      )}

      <div className="plan-grid">
        {PLANS.map((plan) => {
          const highlighted = isPlanId(wanted) ? wanted === plan : plan === 'monthly';
          const disabled = !!busy || (!!session && ((plan === 'free' && !premium) || (plan === 'monthly' && subscribed)));
          return (
            <section key={plan} className={`card plan stack${highlighted ? ' plan-highlight' : ''}`} aria-labelledby={`plan-${plan}`}>
              {plan === 'monthly' && <span className="tag tag-main plan-badge">{t('pricing.popular')}</span>}
              <h2 id={`plan-${plan}`} className="h2">{t(`pricing.${plan}.name`)}</h2>
              <p className="plan-price">
                <span className="plan-amount">{money(PRICE_EUR[plan])}</span>
                <span className="small muted"> {t(`pricing.${plan}.per`)}</span>
              </p>
              <p className="small muted">{t(`pricing.${plan}.pitch`)}</p>
              <ul className="plan-features">
                {FEATURES[plan].map((f) => <li key={f}>{t(f, { n: FREE_DOCS })}</li>)}
              </ul>
              <button type="button" className={`btn ${highlighted ? 'btn-primary' : ''}`} disabled={disabled} onClick={() => void choose(plan)}>
                {busy === plan ? t('common.wait') : cta(plan)}
              </button>
            </section>
          );
        })}
      </div>

      {session && profile?.stripe_customer_id && (
        <div><button type="button" className="link-btn" disabled={!!busy} onClick={() => void portal()}>{t('pricing.manage')}</button></div>
      )}
      <p className="xs muted">{t('pricing.legal')} <Link to="/confidentialite">{t('nav.privacy')}</Link></p>
    </div>
  );
}
