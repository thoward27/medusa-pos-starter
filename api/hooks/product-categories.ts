import { useMedusaSdk } from '@/contexts/auth';
import { useQuery } from '@tanstack/react-query';

// Catalogs have few categories, so fetch them all once and resolve breadcrumbs
// client-side. Only the fields needed to build the hierarchy are requested.
const CATEGORY_LIMIT = 1000;

export const useProductCategories = () => {
  const sdk = useMedusaSdk();

  return useQuery({
    queryKey: ['product-categories'],
    queryFn: async () =>
      sdk.admin.productCategory.list({
        fields: 'id,name,parent_category_id',
        limit: CATEGORY_LIMIT,
      }),
    staleTime: 5 * 60 * 1000,
  });
};
