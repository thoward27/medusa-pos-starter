import { AdminProductTag } from '@medusajs/types';

// The three fulfillment "boxes" an order line can sit in.
export const FULFILLMENT_BUCKETS = ['now', 'pickup', 'ship'] as const;
export type FulfillmentBucket = (typeof FULFILLMENT_BUCKETS)[number];

// Draft-order metadata key holding an { [lineItemId]: bucket } map. Stored at the
// order level (not per line item) because draft-order line-item metadata can't be
// changed on its own through the edit flow — only order-level fields can.
export const FULFILLMENT_BUCKETS_KEY = 'fulfillment_buckets';

// Reads the bucket map off a draft order's metadata, keeping only valid entries.
export function bucketsFromOrder(metadata?: Record<string, unknown> | null): Record<string, FulfillmentBucket> {
  const raw = metadata?.[FULFILLMENT_BUCKETS_KEY];
  if (!raw || typeof raw !== 'object') return {};
  const result: Record<string, FulfillmentBucket> = {};
  for (const [itemId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (isBucket(value)) result[itemId] = value;
  }
  return result;
}

// Product-tag convention for per-product eligibility, e.g. a tag value of
// "fulfill:ship". A product with no fulfillment tags is eligible for all three.
const TAG_PREFIX = 'fulfill:';

export const BUCKET_META: Record<
  FulfillmentBucket,
  { label: string; description: string; dotClass: string; chipClass: string; labelClass: string; barClass: string }
> = {
  now: {
    label: 'Take now',
    description: 'Customer takes it with them now',
    dotClass: 'bg-green-500',
    chipClass: 'border-green-200 bg-green-50',
    labelClass: 'text-green-800',
    barClass: 'border-green-500',
  },
  pickup: {
    label: 'Pickup',
    description: 'Made now, picked up at the market',
    dotClass: 'bg-amber-500',
    chipClass: 'border-amber-200 bg-amber-50',
    labelClass: 'text-amber-800',
    barClass: 'border-amber-500',
  },
  ship: {
    label: 'Ship',
    description: 'Shipped to the customer',
    dotClass: 'bg-red-500',
    chipClass: 'border-red-200 bg-red-50',
    labelClass: 'text-red-800',
    barClass: 'border-red-500',
  },
};

function isBucket(value: unknown): value is FulfillmentBucket {
  return typeof value === 'string' && (FULFILLMENT_BUCKETS as readonly string[]).includes(value);
}

// Which buckets a product may use, derived from its `fulfill:*` tags. Permissive
// default: a product with no fulfillment tags is allowed in all three buckets.
export function eligibleBuckets(tags?: AdminProductTag[] | null): FulfillmentBucket[] {
  const tagged = (tags ?? [])
    .map((tag) => tag.value?.toLowerCase().trim() ?? '')
    .filter((value) => value.startsWith(TAG_PREFIX))
    .map((value) => value.slice(TAG_PREFIX.length))
    .filter(isBucket);

  const restricted = FULFILLMENT_BUCKETS.filter((bucket) => tagged.includes(bucket));
  return restricted.length > 0 ? restricted : [...FULFILLMENT_BUCKETS];
}

export function itemEligibleBuckets(item: {
  product?: { tags?: AdminProductTag[] | null } | null;
}): FulfillmentBucket[] {
  return eligibleBuckets(item.product?.tags ?? null);
}

// The bucket a line item should display in: its stored choice (from the order's
// bucket map) if present and still eligible, otherwise a seed — "ship" when the
// variant requires shipping, else the first eligible bucket.
export function getBucket(
  item: { id: string; requires_shipping?: boolean | null },
  eligible: FulfillmentBucket[],
  buckets: Record<string, FulfillmentBucket>,
): FulfillmentBucket {
  const stored = buckets[item.id];
  if (stored && eligible.includes(stored)) return stored;
  if (item.requires_shipping && eligible.includes('ship')) return 'ship';
  return eligible[0] ?? 'now';
}
