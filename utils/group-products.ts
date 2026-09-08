import { AdminProduct, AdminProductCategory } from '@medusajs/types';

// Uncategorized products are collected here, and this group always sorts last.
export const OTHER_GROUP_LABEL = 'Other';
const OTHER_GROUP_KEY = '__other__';
const BREADCRUMB_SEPARATOR = ' › ';

// A single grid row: up to `numColumns` products laid out side by side.
export type ProductRow = { id: string; products: AdminProduct[] };
// A category section for SectionList: a breadcrumb title plus its rows.
export type ProductSection = { key: string; title: string; data: ProductRow[] };

type CategoryNode = { name: string; parentId: string | null };

function buildCategoryIndex(categories: Pick<AdminProductCategory, 'id' | 'name' | 'parent_category_id'>[]) {
  const byId = new Map<string, CategoryNode>();
  for (const category of categories) {
    byId.set(category.id, { name: category.name, parentId: category.parent_category_id ?? null });
  }
  return byId;
}

// Walks parent links to the root and joins names into a breadcrumb path, e.g.
// "Custom Commissions › Pets". Falls back to the product's own category name if
// the category isn't in the index; guards against cyclic parent links.
function resolveBreadcrumb(categoryId: string, byId: Map<string, CategoryNode>, fallbackName?: string): string {
  const parts: string[] = [];
  const seen = new Set<string>();
  let current: string | null = categoryId;

  while (current && !seen.has(current)) {
    seen.add(current);
    const node = byId.get(current);
    if (!node) break;
    parts.unshift(node.name);
    current = node.parentId;
  }

  if (parts.length === 0) return fallbackName ?? OTHER_GROUP_LABEL;
  return parts.join(BREADCRUMB_SEPARATOR);
}

/**
 * Groups products by category into SectionList sections.
 *
 * - A product is placed under *every* category it belongs to (duplicated across
 *   sections); uncategorized products go to the "Other" section, sorted last.
 * - Section titles are the full category breadcrumb (e.g. "Custom Commissions › Pets").
 * - Sections are ordered A–Z by breadcrumb; products A–Z by title within each.
 * - Each section's `data` is its products chunked into rows of `numColumns`.
 */
export function groupProductsIntoSections(
  products: AdminProduct[],
  categories: Pick<AdminProductCategory, 'id' | 'name' | 'parent_category_id'>[],
  numColumns: number,
): ProductSection[] {
  const columns = Math.max(1, numColumns);
  const byId = buildCategoryIndex(categories);

  const buckets = new Map<string, AdminProduct[]>();
  const titles = new Map<string, string>();

  const addTo = (key: string, title: string, product: AdminProduct) => {
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.push(product);
    } else {
      buckets.set(key, [product]);
    }
    if (!titles.has(key)) titles.set(key, title);
  };

  for (const product of products) {
    const productCategories = product.categories ?? [];
    if (productCategories.length === 0) {
      addTo(OTHER_GROUP_KEY, OTHER_GROUP_LABEL, product);
      continue;
    }
    for (const category of productCategories) {
      addTo(category.id, resolveBreadcrumb(category.id, byId, category.name), product);
    }
  }

  const keys = [...buckets.keys()].sort((a, b) => {
    if (a === OTHER_GROUP_KEY) return 1;
    if (b === OTHER_GROUP_KEY) return -1;
    return (titles.get(a) ?? '').localeCompare(titles.get(b) ?? '', undefined, { sensitivity: 'base' });
  });

  const sections: ProductSection[] = [];
  for (const key of keys) {
    const items = (buckets.get(key) ?? [])
      .slice()
      .sort((a, b) => (a.title ?? '').localeCompare(b.title ?? '', undefined, { sensitivity: 'base' }));

    const data: ProductRow[] = [];
    for (let i = 0; i < items.length; i += columns) {
      const chunk = items.slice(i, i + columns);
      data.push({ id: `row:${key}:${chunk[0].id}`, products: chunk });
    }

    sections.push({ key: `section:${key}`, title: titles.get(key) ?? OTHER_GROUP_LABEL, data });
  }

  return sections;
}
