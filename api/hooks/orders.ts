import { useMedusaSdk } from '@/contexts/auth';
import { showErrorToast } from '@/utils/errors';
import { AdminOrderFilters, AdminOrderListResponse } from '@medusajs/types';
import { InfiniteData, UndefinedInitialDataInfiniteOptions, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';

const PER_PAGE = 20;

export const useOrders = (
  query?: Omit<AdminOrderFilters, 'limit' | 'offset'>,
  limit = PER_PAGE,
  options?: Omit<
    UndefinedInitialDataInfiniteOptions<
      AdminOrderListResponse,
      unknown,
      InfiniteData<AdminOrderListResponse>,
      readonly unknown[],
      number
    >,
    'queryKey' | 'queryFn' | 'initialPageParam' | 'getNextPageParam' | 'getPreviousPageParam'
  >,
) => {
  const sdk = useMedusaSdk();

  return useInfiniteQuery({
    queryKey: ['orders', JSON.stringify(query ?? {})],
    queryFn: async ({ pageParam = 1 }) => {
      return sdk.admin.order.list({
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
    ...options,
  });
};

export const useOrder = (orderId: string) => {
  const sdk = useMedusaSdk();

  return useQuery({
    queryKey: ['orders', 'order', orderId],
    queryFn: async () => {
      return sdk.admin.order.retrieve(orderId, {
        fields:
          '+tax_total,+discount_total,+subtotal,+total,+items.variant.options.*,+items.variant.options.option.*,+items.variant.inventory_quantity,+items.requires_shipping,+customer.*,+fulfillments.*,+metadata',
      });
    },
    enabled: !!orderId,
  });
};

type FulfillmentAction = 'fulfill' | 'ship' | 'deliver';

export const useAdvanceFulfillment = (orderId: string) => {
  const sdk = useMedusaSdk();
  const queryClient = useQueryClient();

  const labels: Record<FulfillmentAction, string> = {
    fulfill: 'marked as fulfilled',
    ship: 'marked as shipped',
    deliver: 'marked as delivered',
  };

  return useMutation({
    mutationKey: ['order', 'advance-fulfillment', orderId],
    mutationFn: async ({
      action,
      orderItems,
      fulfillment,
    }: {
      action: FulfillmentAction;
      orderItems: { id: string; quantity: number }[];
      fulfillment?: { id: string; items: { id: string; quantity: number }[] };
    }) => {
      switch (action) {
        case 'fulfill': {
          await sdk.admin.order.createFulfillment(orderId, { items: orderItems });
          break;
        }
        case 'ship': {
          if (!fulfillment) throw new Error('Fulfillment required to create shipment');
          await sdk.admin.order.createShipment(orderId, fulfillment.id, {
            items: fulfillment.items.map((item) => ({ id: item.id, quantity: item.quantity })),
          });
          break;
        }
        case 'deliver': {
          if (!fulfillment) throw new Error('Fulfillment required to mark as delivered');
          await sdk.admin.order.markAsDelivered(orderId, fulfillment.id);
          break;
        }
      }
    },
    onSuccess: async (_data, { action }) => {
      await queryClient.invalidateQueries({ queryKey: ['orders'] });
      Toast.show({ type: 'success', text1: 'Order Updated', text2: `Order ${labels[action]}` });
    },
    onError: (error) => {
      showErrorToast(error);
    },
  });
};
