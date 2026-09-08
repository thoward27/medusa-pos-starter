import { AdminCustomer, AdminDraftOrder, AdminOrderLineItem } from '@medusajs/types';

/**
 * Commission awareness for the till.
 *
 * A commission is not an ordinary line. It is a piece made to order over weeks,
 * and the buyer's only channel to the artist for the whole of that time is the
 * commission-notes thread on their order — reference photos, progress shots,
 * approvals. That thread is reachable ONLY from a signed-in customer account.
 *
 * So a commission sold to a customer who cannot sign in is a product that
 * cannot be delivered. The backend refuses those outright (the account
 * invariant, enforced on `POST /admin/draft-orders/:id/convert-to-order`), and
 * on the POS that refusal would land AFTER the card has been charged, because
 * Stripe Terminal runs before the draft order is converted.
 *
 * The point of this file is that the till never gets there. The cart screen
 * asks the same question the server will ask, while the order is still being
 * built, and blocks checkout with a fixable prompt instead of a declined
 * conversion and a refund in front of a customer.
 *
 * ⚠ Ordinary sales are untouched. Every predicate here is a no-op on an order
 * with no commission line — stickers, prints and originals keep the fast
 * shared-guest path exactly as before.
 */

/**
 * The ProductType value the store uses for commissions.
 *
 * Must match COMMISSION_PRODUCT_TYPE_VALUE in the backend's commissions
 * plugin. It is the snapshot copied onto each order line at order time
 * (`product_type`), which is why it survives a later rename of the type.
 */
export const COMMISSION_PRODUCT_TYPE = 'commission';

type LineItemish = Pick<AdminOrderLineItem, 'product_type'> & {
  product?: { type?: { value?: string | null } | null } | null;
};

/** Is this order line a commission? */
export function lineIsCommission(item: LineItemish): boolean {
  // The line's own snapshot first — it is what the server reads, so reading
  // anything else here would let the two disagree about the same line. The
  // product relation is the fallback for field sets that did not expand it.
  if (item.product_type === COMMISSION_PRODUCT_TYPE) return true;
  return item.product?.type?.value === COMMISSION_PRODUCT_TYPE;
}

/** The commission lines of an order, by product title, de-duplicated. */
export function commissionTitles(
  items: readonly (LineItemish & { product_title?: string | null; title?: string | null })[] | null | undefined,
): string[] {
  const titles = (items ?? []).filter(lineIsCommission).map((i) => i.product_title || i.title || 'Commission');
  return [...new Set(titles)];
}

/** Does this order contain anything that requires the buyer to have an account? */
export function orderHasCommission(order: Pick<AdminDraftOrder, 'items'> | null | undefined): boolean {
  return (order?.items ?? []).some(lineIsCommission);
}

/**
 * Can this customer actually reach a commission thread?
 *
 * Two conditions, and BOTH are needed — each one alone has produced a buyer
 * who could not be reached:
 *
 *   1. `has_account` — a customer row minted by `POST /admin/customers` (which
 *      is what the "Add New Customer" button used to do) has no auth identity
 *      behind it. The person named on it cannot sign in at all. This is the
 *      state 172 TaylorMade commission orders are in.
 *
 *   2. a real mailbox — the till synthesises `pos-customer+<digits>@…` when no
 *      email is given. That address is on the store's own domain, so the
 *      set-password link goes to the store and never to the buyer. An account
 *      they cannot receive mail for is not an account they can use.
 *
 * Kept deliberately loose on the second point: this mirrors the server's
 * placeholder family rather than trying to validate deliverability, which no
 * client can do. The server is the authority; this exists to stop the till
 * walking into its refusal.
 */
export function customerCanReachCommissions(
  customer: Pick<AdminCustomer, 'email' | 'has_account'> | null | undefined,
): boolean {
  if (!customer) return false;
  if (customer.has_account !== true) return false;
  return !isPlaceholderEmail(customer.email);
}

/**
 * Addresses that are not a buyer's own mailbox.
 *
 * Mirrors `isSharedGuestEmail` in the backend's commissions plugin. Kept in
 * sync by hand because the POS app is a separate repo with no shared package —
 * if these drift, the symptom is a refusal at conversion that the till did not
 * warn about, which is precisely the experience this is meant to prevent.
 */
const PLACEHOLDER_LOCAL_PARTS = new Set([
  'noreply',
  'noreplies',
  'donotreply',
  'nobody',
  'guest',
  'posguest',
  'walkin',
  'anonymous',
  'poscustomer',
]);

export function isPlaceholderEmail(email: string | null | undefined): boolean {
  if (typeof email !== 'string') return false;
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf('@');
  if (at <= 0) return false;
  const local = (trimmed.slice(0, at).split('+')[0] ?? '').replace(/[._-]/g, '');
  return PLACEHOLDER_LOCAL_PARTS.has(local);
}

/**
 * What the cart screen needs to know, in one shot.
 *
 * `blocked` is the checkout gate. `reason` is what to show the operator, and it
 * names the products rather than saying "a commission", because at a busy till
 * the useful question is "which line do I have to fix".
 */
export function commissionCheckoutState(order: Pick<AdminDraftOrder, 'items' | 'customer'> | null | undefined): {
  hasCommission: boolean;
  blocked: boolean;
  titles: string[];
} {
  const titles = commissionTitles(order?.items);
  if (titles.length === 0) return { hasCommission: false, blocked: false, titles: [] };
  return {
    hasCommission: true,
    blocked: !customerCanReachCommissions(order?.customer),
    titles,
  };
}
