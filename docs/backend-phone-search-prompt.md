# Backend task: enable customer search by phone number

This prompt is meant to be run in the **Medusa backend repository** (the server
that the `medusa-pos-starter` app talks to). The POS app has already been made
forward-compatible — once the backend supports phone search, flipping a single
constant in the app turns it on (details at the end).

---

## Context

The POS app lets operators look up customers by typing into a single search box.
Their most common lookups are **phone number** and **email**. Today the app
calls the admin customer list endpoint:

```
GET /admin/customers?q=<text>
```

Medusa's `q` parameter searches **name + email only** — it does **not** search
the `phone` column, and the admin customer list endpoint exposes **no `phone`
filter**. As a workaround, the POS app stores walk-in customers with a synthetic
email that embeds their phone digits (`pos-customer+<digits>@example.com`), so a
digits-only `q` matches those via email. That only covers customers created by
the POS without a real email. Customers created elsewhere (storefront/admin) or
POS customers given a real email **cannot be found by phone**.

We want phone to be a first-class, reliable search key for **every** customer.

---

## Goal

Allow the admin customer list endpoint to find customers by **partial phone
match**, alongside the existing name/email search, in a way the POS app can call
without fetching and filtering the whole customer table client-side.

---

## Step 1 — Investigate (report before changing anything)

Confirm the following in this repo and report findings with file paths / line
numbers and the Medusa version in `package.json`:

1. **Medusa version** of `@medusajs/medusa` (and the customer module if pinned).
2. **What `q` searches today** for customers. Find where the customer model's
   free-text/searchable fields are defined (in recent Medusa this is the
   `searchable: true` flag on `model.define` properties in the customer module,
   or the module service's free-text-search config). Quote the current
   searchable field list and whether `phone` is included.
3. **The admin route + validator** for `GET /admin/customers`. Find the Zod
   query schema (often via `createFindParams()` / a `AdminGetCustomersParams`
   validator and the route's `middlewares`/`validateAndTransformQuery`). Confirm
   whether an unknown query param like `phone` is **stripped** or **rejected
   (400)** — this tells us whether the POS app could pass `phone` safely.
4. Whether the `phone` column is **indexed** (matters for `ILIKE` performance).

---

## Step 2 — Choose an approach

Pick whichever is cleanest for this Medusa version and least likely to break on
upgrade. In rough order of preference:

- **A. Add `phone` to the customer free-text search fields.** Mark the customer
  model's `phone` property searchable so the existing `q` also matches phone.
  Simplest for the client (no new param), but note `q` then does a substring
  match on raw stored phone text — formatting differences (spaces, `+`, country
  code) can cause misses. Consider normalizing stored phone on write, or:

- **B. Add a dedicated `phone` filter** to the admin customers list (partial
  match, e.g. `ILIKE %digits%`). Extend the query validator to accept `phone`
  and map it into the list filters. Most explicit and predictable for the POS.

- **C. Custom admin route** (e.g. `GET /admin/customers/search?phone=`) if
  extending the core list endpoint is awkward in this version.

If you implement B or C, prefer matching on **normalized digits** on both sides
(strip non-digits from the stored value and the query) so `0412 345 678`,
`+61412345678`, and `(0412) 345-678` all match. A common technique: compare
`REGEXP_REPLACE(phone, '\D', '', 'g')` against the query digits, or store a
normalized `phone_normalized` field maintained on create/update.

---

## Step 3 — Implement & test

- Implement the chosen approach.
- Add/extend tests: searching by full and partial phone (with and without
  formatting/country code) returns the expected customer; name/email search is
  unchanged; empty/short queries behave sensibly.
- Verify performance on a realistic customer count (index the column / normalized
  column if using `ILIKE`/regex).

---

## Step 4 — Report the client contract

Tell us exactly how the POS app should call it, so we can flip the app's
strategy. We need one of:

- **Approach A (`q` includes phone):** confirm `GET /admin/customers?q=<digits>`
  now matches phone. → POS sets `PHONE_SEARCH_STRATEGY = 'q-includes-phone'`.
- **Approach B (`phone` filter):** give the param name and operator, e.g.
  `GET /admin/customers?phone[$ilike]=%<digits>%` or `?phone=<digits>`. → POS
  sets `PHONE_SEARCH_STRATEGY = 'phone-filter'` and we align the operator/shape
  in `buildCustomerSearchParams`.
- **Approach C (custom route):** give the full path + params + response shape. →
  POS adds a small hook for that route.

Also state whether the endpoint **rejects** unknown params (so we know whether a
progressive/optimistic phone filter is safe to send before rollout).

---

## How the POS app is already prepared

In `app/customer-lookup.tsx`, all search paths build their params through one
function, gated by a single constant:

```ts
type PhoneSearchStrategy = 'embedded-email' | 'q-includes-phone' | 'phone-filter';
const PHONE_SEARCH_STRATEGY: PhoneSearchStrategy = 'embedded-email'; // <- flip after backend lands

const buildCustomerSearchParams = (input: string) => {
  // phone-like input -> digits; name/email -> passthrough to `q`
  // branches on PHONE_SEARCH_STRATEGY for how phone is queried
};
```

Once the backend ships phone search, changing `PHONE_SEARCH_STRATEGY` (and, for
approach B, the exact filter operator/shape in that one function) is the only app
change required. The main list and the in-form duplicate-match lookups both use
this function, so both pick up the change automatically.
