import { useMedusaSdk } from '@/contexts/auth';
import { showErrorToast } from '@/utils/errors';
import { AdminProduct, AdminProductListParams, AdminProductListResponse, AdminProductVariant } from '@medusajs/types';
import {
  InfiniteData,
  UndefinedInitialDataInfiniteOptions,
  useInfiniteQuery,
  useMutation,
  UseMutationOptions,
  useQuery,
} from '@tanstack/react-query';

const PER_PAGE = 20;

export const useProducts = (
  query?: Omit<AdminProductListParams, 'limit' | 'offset'>,
  limit = PER_PAGE,
  options?: Omit<
    UndefinedInitialDataInfiniteOptions<
      AdminProductListResponse,
      unknown,
      InfiniteData<AdminProductListResponse>,
      readonly unknown[],
      number
    >,
    'queryKey' | 'queryFn' | 'initialPageParam' | 'getNextPageParam' | 'getPreviousPageParam'
  >,
) => {
  const sdk = useMedusaSdk();

  return useInfiniteQuery({
    queryKey: ['products', JSON.stringify(query ?? {})],
    queryFn: async ({ pageParam = 1 }) => {
      return sdk.admin.product.list({
        ...query,
        limit,
        offset: (pageParam - 1) * limit,
      });
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage) => {
      const nextPage = (lastPage.offset + lastPage.limit) / limit + 1;
      return lastPage.count > lastPage.offset + lastPage.limit ? nextPage : undefined;
    },
    getPreviousPageParam: (firstPage) => {
      const prevPage = (firstPage.offset + firstPage.limit) / limit - 1;
      return prevPage >= 1 ? prevPage : undefined;
    },
    // Keep the list fresh so newly added products (and replaced image URLs, since
    // S3 URLs change per version) surface within ~5 min. Image bytes stay durably
    // cached by expo-image — freshness lives here in the data layer, not the cache.
    staleTime: 5 * 60 * 1000,
    ...options,
  });
};

export const useProduct = (productId: string) => {
  const sdk = useMedusaSdk();

  return useQuery({
    queryKey: ['products', 'product', productId],
    queryFn: async () => {
      return sdk.admin.product.retrieve(productId);
    },
    enabled: !!productId,
  });
};

export const useScanBarcode = (
  options?: Omit<
    UseMutationOptions<
      {
        product: AdminProduct;
        variant: AdminProductVariant;
      } | null,
      Error,
      string,
      unknown
    >,
    'mutationKey' | 'mutationFn'
  >,
) => {
  const sdk = useMedusaSdk();

  return useMutation({
    mutationKey: ['products', 'barcode'],
    mutationFn: async (barcode: string) => {
      const productsResponse = await sdk.admin.product.list({
        limit: 1,
        offset: 0,
        variants: {
          $or: [{ ean: barcode }, { upc: barcode }, { barcode: barcode }],
        },
      });

      const product = productsResponse.products[0];

      if (!product) {
        return null;
      }

      const variant = product.variants?.find((v) => v.ean === barcode || v.upc === barcode || v.barcode === barcode);
      if (!variant) {
        return null;
      }

      return {
        product,
        variant,
      };
    },
    ...options,
    onError: (error, variables, context) => {
      showErrorToast(error);

      return options?.onError?.(error, variables, context);
    },
  });
};
