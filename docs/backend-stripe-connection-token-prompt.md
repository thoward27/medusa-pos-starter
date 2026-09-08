# Backend task: implement the Stripe Terminal connection-token endpoint

This prompt is meant to be run in the **Medusa backend repository** (the server
that the `medusa-pos-starter` app talks to). The POS app is already wired to call
this endpoint — once the backend serves it correctly, card payments initialize
with no further app changes.

---

## Context

The POS app uses **Stripe Terminal** (`@stripe/stripe-terminal-react-native`) to
take in-person card payments (Tap to Pay + Bluetooth readers). Before the SDK can
do anything, it must be initialized, and initialization calls a **token
provider** that has to return a Stripe **connection token**.

The app's token provider (`contexts/stripe-terminal.tsx`) does:

```
POST /admin/stripe/connection-tokens        (Medusa admin API, admin-authenticated)
→ expects JSON:  { "secret": "pst_..." }
```

Right now that call fails, so the SDK reports *"couldn't fetch connection token.
Please check your tokenProvider method"*. The app now surfaces the real HTTP
status behind that message (e.g. `HTTP 404 from /admin/stripe/connection-tokens`).
**Report that status first — it tells us whether the route is missing (404),
erroring (500), or returning the wrong shape.**

A Stripe connection token is a short-lived credential the Terminal SDK uses to
authenticate with Stripe and to connect to a reader. It is minted server-side by
calling Stripe's [`/v1/terminal/connection_tokens`](https://docs.stripe.com/api/terminal/connection_tokens/create)
with the account's **secret key** — the secret key must never live in the app.

---

## Goal

Serve `POST /admin/stripe/connection-tokens` from the Medusa backend so it returns
`{ "secret": "<connection token secret>" }`, minted via Stripe using the server's
Stripe secret key. The endpoint must be reachable with the same admin
authentication the POS app already uses for other `/admin/*` calls.

---

## Step 1 — Investigate (report before changing anything)

Report findings with file paths / line numbers and the Medusa version in
`package.json`:

1. **Medusa version** of `@medusajs/medusa`.
2. **Does the route already exist?** Look for `src/api/admin/stripe/connection-tokens/route.ts`
   (or `.js`) — a Medusa v2 file-based route exporting a `POST` handler. If it
   exists, quote it and identify why it fails (throws? wrong response shape?
   missing key?).
3. **Is Stripe configured at all?** Check `medusa-config.{ts,js}` for a Stripe
   payment provider (e.g. `@medusajs/payment-stripe` / `@medusajs/medusa/payment-stripe`)
   and where its **API key** comes from (env var name, e.g. `STRIPE_API_KEY` /
   `STRIPE_SECRET_KEY`). Confirm the key is present in the server environment.
   The connection-token route should reuse this same secret key rather than
   introduce a second source of truth.
4. **Is the `stripe` node SDK available** as a dependency (directly or via the
   payment plugin), or should the route call Stripe's REST API with `fetch`?
5. **Admin auth**: confirm routes under `/admin/*` require admin authentication by
   default in this version, and that the POS app's session/token satisfies it
   (it already calls other `/admin/*` endpoints successfully).

---

## Step 2 — Implement

Create the admin route (Medusa v2 file-based routing):

`src/api/admin/stripe/connection-tokens/route.ts`

```ts
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import Stripe from "stripe"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const apiKey = process.env.STRIPE_API_KEY // reuse the SAME key as the payment provider
  if (!apiKey) {
    return res.status(500).json({ message: "Stripe secret key is not configured" })
  }

  const stripe = new Stripe(apiKey)

  try {
    // Optionally scope to a Terminal Location:
    //   const token = await stripe.terminal.connectionTokens.create({ location: "tml_..." })
    const token = await stripe.terminal.connectionTokens.create()
    return res.json({ secret: token.secret })
  } catch (e: any) {
    req.scope.resolve("logger")?.error?.(e)
    return res.status(500).json({ message: e?.message ?? "Failed to create connection token" })
  }
}
```

Notes / decisions:

- **Reuse the payment provider's secret key** (same env var) so there's one Stripe
  account of record. Don't hardcode.
- **Location scoping is optional** for minting the token, but the reader must be
  registered to a Terminal **Location**. The app already passes a
  `EXPO_PUBLIC_STRIPE_LOCATION_ID` when connecting a reader — make sure that
  location belongs to the **same Stripe account** as this secret key (test vs live
  must also match: a `pk_test_`/`sk_test_` pair cannot use a live location).
- **Response shape must be exactly `{ "secret": "..." }`** (top-level `secret`).
  That's what the app reads. Returning Stripe's full object also works since its
  `secret` is top-level, but prefer the minimal shape.
- If admin auth is somehow not applied to this path in your version, add the admin
  auth middleware — do **not** leave connection-token minting unauthenticated.

---

## Step 3 — Test

- `POST /admin/stripe/connection-tokens` with a valid admin session returns
  `200 { secret: "pst_..." }`.
- Missing/invalid key returns a clear `500 { message }` (the app now displays the
  message).
- Unauthenticated request is rejected (401/403).
- End-to-end: on an Android device, open Checkout → card. The SDK should
  initialize (no "couldn't fetch connection token") and reach "Connect to a
  reader".

---

## Step 4 — Report the client contract

Confirm back to us:

- Final path (`POST /admin/stripe/connection-tokens`) and that it returns
  `{ secret }`.
- Which **env var** holds the Stripe secret key, and whether **test or live** mode
  is active — the app's `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` and
  `EXPO_PUBLIC_STRIPE_LOCATION_ID` must match that account and mode.

---

## How the POS app is already prepared

- Token provider + init live in `contexts/stripe-terminal.tsx`. It calls the
  endpoint above and now surfaces the real HTTP error in-app and offers a Retry.
- Reader connection uses `EXPO_PUBLIC_STRIPE_LOCATION_ID` (`components/CardPayment.tsx`).
- No app code needs to change once the endpoint returns `{ secret }` from the
  right Stripe account/mode.
