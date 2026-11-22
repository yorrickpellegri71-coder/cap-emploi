// Cap Emploi — paiements Stripe (Supabase Edge Function, Deno).
// Actions (POST, session utilisateur requise) :
//   checkout : crée une page de paiement Stripe Checkout pour { plan: 'monthly' | 'pass' } et renvoie son adresse ;
//   portal   : ouvre l'espace client Stripe (factures, carte, résiliation) ;
//   cancel   : résilie immédiatement l'abonnement (appelé avant la suppression du compte).
// Webhook (POST avec en-tête stripe-signature) : vérifie la signature puis met à jour les droits dans la base.
// Les prix sont créés à la volée (price_data) : aucun produit à créer dans Stripe.
// Secrets : CAP_STRIPE_SECRET_KEY, CAP_STRIPE_WEBHOOK_SECRET ; facultatifs : CAP_APP_URL, CAP_PRICE_MONTHLY_CENTS (990),
// CAP_PRICE_PASS_CENTS (2400), CAP_SCHEMA, CAP_ALLOWED_ORIGIN.

import Stripe from 'npm:stripe@17.7.0';
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';

const SCHEMA = Deno.env.get('CAP_SCHEMA') ?? 'cap_emploi';
const APP_URL = (Deno.env.get('CAP_APP_URL') ?? 'https://yorrickpellegri71-coder.github.io/cap-emploi/').replace(/\/?$/, '/');
const PRICES = {
  monthly: Number(Deno.env.get('CAP_PRICE_MONTHLY_CENTS') ?? 990),
  pass: Number(Deno.env.get('CAP_PRICE_PASS_CENTS') ?? 2400),
};
const STRIPE_LOCALES: Record<string, Stripe.Checkout.SessionCreateParams.Locale> = { fr: 'fr', en: 'en', de: 'de', lb: 'fr', pt: 'pt' };

const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('CAP_ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

class Fail extends Error {
  constructor(public code: string, public status = 400) { super(code); }
}

let stripeClient: Stripe | null = null;
function stripe(): Stripe {
  const key = Deno.env.get('CAP_STRIPE_SECRET_KEY');
  if (!key) throw new Fail('billing_disabled', 501);
  return (stripeClient ??= new Stripe(key, { httpClient: Stripe.createFetchHttpClient() }));
}

const url = Deno.env.get('SUPABASE_URL')!;
const admin = () => createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { db: { schema: SCHEMA } });

// ───────────────────────── Actions utilisateur ─────────────────────────

async function checkout(userId: string, email: string | undefined, body: Record<string, unknown>) {
  const plan = body.plan === 'pass' ? 'pass' : body.plan === 'monthly' ? 'monthly' : null;
  if (!plan) throw new Fail('bad_plan');
  const { data: profile, error } = await admin().from('profiles')
    .select('stripe_customer_id, subscription_status, premium_until').eq('id', userId).single();
  if (error) throw error;
  if (plan === 'monthly' && ['active', 'trialing', 'past_due'].includes(profile.subscription_status ?? '')) throw new Fail('already_subscribed', 409);

  const lang = typeof body.lang === 'string' ? body.lang : 'fr';
  const product_data = { name: plan === 'monthly' ? 'Cap Emploi Premium' : 'Cap Emploi Pass 3 mois' };
  const session = await stripe().checkout.sessions.create({
    mode: plan === 'monthly' ? 'subscription' : 'payment',
    line_items: [{
      quantity: 1,
      price_data: plan === 'monthly'
        ? { currency: 'eur', unit_amount: PRICES.monthly, recurring: { interval: 'month' }, product_data }
        : { currency: 'eur', unit_amount: PRICES.pass, product_data },
    }],
    client_reference_id: userId,
    metadata: { user_id: userId, plan },
    ...(profile.stripe_customer_id ? { customer: profile.stripe_customer_id } : { customer_email: email }),
    ...(plan === 'monthly'
      ? { subscription_data: { metadata: { user_id: userId } } }
      : { ...(profile.stripe_customer_id ? {} : { customer_creation: 'always' as const }), payment_intent_data: { metadata: { user_id: userId } } }),
    allow_promotion_codes: true,
    automatic_tax: { enabled: false },
    locale: STRIPE_LOCALES[lang] ?? 'auto',
    success_url: `${APP_URL}tarifs?paiement=ok`,
    cancel_url: `${APP_URL}tarifs?paiement=annule`,
  });
  return { url: session.url };
}

async function portal(userId: string) {
  const { data, error } = await admin().from('profiles').select('stripe_customer_id').eq('id', userId).single();
  if (error) throw error;
  if (!data.stripe_customer_id) throw new Fail('no_customer', 404);
  const session = await stripe().billingPortal.sessions.create({ customer: data.stripe_customer_id, return_url: `${APP_URL}profil` });
  return { url: session.url };
}

async function cancelNow(userId: string) {
  const { data, error } = await admin().from('profiles').select('stripe_subscription_id, subscription_status').eq('id', userId).single();
  if (error) throw error;
  if (data.stripe_subscription_id && data.subscription_status !== 'canceled') {
    await stripe().subscriptions.cancel(data.stripe_subscription_id);
  }
  return { ok: true };
}

// ───────────────────────── Webhook Stripe ─────────────────────────

/** Fin de période : sur l'abonnement (anciennes versions de l'API) ou sur sa ligne (versions récentes). */
function periodEnd(sub: Stripe.Subscription): string | null {
  // deno-lint-ignore no-explicit-any
  const s = sub as any;
  const end = s.current_period_end ?? s.items?.data?.[0]?.current_period_end;
  return typeof end === 'number' ? new Date(end * 1000).toISOString() : null;
}

async function applySubscription(sub: Stripe.Subscription, fallbackUser?: string | null) {
  const db = admin();
  const customer = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
  let uid = sub.metadata?.user_id || fallbackUser || null;
  if (!uid) {
    const { data } = await db.from('profiles').select('id').eq('stripe_customer_id', customer).maybeSingle();
    uid = data?.id ?? null;
  }
  if (!uid) { console.warn('Abonnement sans utilisateur', sub.id); return; }
  const { error } = await db.rpc('billing_set_subscription', { uid, customer, sub_id: sub.id, status: sub.status, period_end: periodEnd(sub) });
  if (error) throw error;
}

async function webhook(req: Request) {
  const secret = Deno.env.get('CAP_STRIPE_WEBHOOK_SECRET');
  if (!secret) throw new Fail('billing_disabled', 501);
  const signature = req.headers.get('stripe-signature') ?? '';
  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe().webhooks.constructEventAsync(raw, signature, secret, undefined, Stripe.createSubtleCryptoProvider());
  } catch {
    throw new Fail('bad_signature', 400);
  }

  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded': {
      const s = event.data.object as Stripe.Checkout.Session;
      const uid = s.client_reference_id ?? s.metadata?.user_id;
      if (!uid) break;
      const customer = typeof s.customer === 'string' ? s.customer : s.customer?.id ?? null;
      if (s.mode === 'payment' && s.payment_status === 'paid') {
        // Identifiant de la session (et non de l'événement) : le pass n'est accordé qu'une fois par paiement.
        const { error } = await admin().rpc('billing_grant_pass', { uid, customer, event_id: s.id, months: 3 });
        if (error) throw error;
      } else if (s.mode === 'subscription' && s.subscription) {
        const sub = typeof s.subscription === 'string' ? await stripe().subscriptions.retrieve(s.subscription) : s.subscription;
        await applySubscription(sub, uid);
      }
      break;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      await applySubscription(event.data.object as Stripe.Subscription);
      break;
    default:
      break;
  }
  return { received: true };
}

// ───────────────────────── Point d'entrée ─────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  try {
    if (req.headers.has('stripe-signature')) return json(await webhook(req));

    const authHeader = req.headers.get('Authorization') ?? '';
    const db = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await db.auth.getUser(authHeader.replace(/^Bearer\s+/i, ''));
    if (!user) throw new Fail('unauthorized', 401);

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    if (body.action === 'checkout') return json(await checkout(user.id, user.email, body));
    if (body.action === 'portal') return json(await portal(user.id));
    if (body.action === 'cancel') return json(await cancelNow(user.id));
    throw new Fail('unknown_action');
  } catch (e) {
    if (e instanceof Fail) return json({ error: e.code }, e.status);
    if (e instanceof Stripe.errors.StripeError) {
      console.error('Stripe', e.type, e.message);
      return json({ error: 'billing_unavailable' }, 502);
    }
    console.error(e);
    return json({ error: 'server_error' }, 500);
  }
});
