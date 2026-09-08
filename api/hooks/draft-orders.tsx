import { useMedusaSdk } from '@/contexts/auth';
import { useSettings } from '@/contexts/settings';
import { showErrorToast } from '@/utils/errors';
import { FULFILLMENT_BUCKETS_KEY, FulfillmentBucket } from '@/utils/fulfillment';
import {
  AdminAddDraftOrderItems,
  AdminCustomer,
  AdminDraftOrderPreviewResponse,
  AdminDraftOrderResponse,
  AdminOrderLineItem,
  AdminUpdateDraftOrderItem,
} from '@medusajs/types';
import { useMutation, UseMutationOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import * as React from 'react';
import { storage } from '@/utils/storage';

const DRAFT_ORDER_ID_STORAGE_KEY = 'draft_order_id';

/**
 * The shared walk-in customer every POS order is attached to when no particular
 * customer is chosen.
 *
 * ── Why this moved off agilo.com ─────────────────────────────────────────────
 *
 * It used to be `noreply+pos-guest@agilo.com` — an upstream-starter leftover
 * pointing at a mailbox on a domain this store does not own and cannot receive
 * mail for. Every anonymous POS sale in the store's history hangs off one
 * customer record on somebody else's domain.
 *
 * Moving it to an owned domain does NOT make it a usable customer, and is not
 * meant to. It stays a placeholder standing in for "no particular person": the
 * point is only that the store now owns the address it is stamping on its own
 * orders, so anything that ever does reach it lands somewhere Tom can see.
 *
 * ⚠ Changing this value creates a NEW shared customer record on first use. The
 * old one keeps every order already attached to it — nothing is migrated, and
 * nothing should be. Historical orders keep their history.
 *
 * ⚠ A commission can NEVER be sold against this record, whatever it is set to.
 * The backend refuses the whole placeholder family (`noreply`, `guest`,
 * `pos-guest`, `walk-in`, `pos-customer`…) on any order containing a
 * commission, because a commission is a named relationship with one buyer and
 * a shared record is reachable by all of them or none of them. The cart screen
 * warns about that before payment; see `utils/commissions.ts`.
 */
export const DRAFT_ORDER_DEFAULT_CUSTOMER_EMAIL = process.env.EXPO_PUBLIC_POS_GUEST_EMAIL || 'pos-guest@taylormade.cc';

const useGetOrSetDefaultCustomer = () => {
  const sdk = useMedusaSdk();

  return React.useCallback(async () => {
    const existingCustomer = await sdk.admin.customer.list({
      email: DRAFT_ORDER_DEFAULT_CUSTOMER_EMAIL,
      fields: 'id',
      limit: 1,
    });

    if (existingCustomer.customers.length > 0) {
      return existingCustomer.customers[0].id;
    }

    const newCustomer = await sdk.admin.customer.create(
      {
        email: DRAFT_ORDER_DEFAULT_CUSTOMER_EMAIL,
      },
      {
        fields: 'id',
      },
    );

    return newCustomer.customer.id;
  }, [sdk]);
};

const useGetOrSetDraftOrderId = () => {
  const sdk = useMedusaSdk();
  const settings = useSettings();
  const getOrSetDefaultCustomer = useGetOrSetDefaultCustomer();

  return React.useCallback(async () => {
    const draftOrderId = await storage.getItemAsync(DRAFT_ORDER_ID_STORAGE_KEY);

    if (draftOrderId) {
      return draftOrderId;
    }

    if (!settings.data?.region?.id) {
      throw new Error('Region ID is not set in settings');
    }

    if (!settings.data?.sales_channel?.id) {
      throw new Error('Sales Channel ID is not set in settings');
    }

    const defaultCustomerId = await getOrSetDefaultCustomer();

    const newDraftOrder = await sdk.admin.draftOrder.create({
      region_id: settings.data?.region?.id,
      sales_channel_id: settings.data?.sales_channel?.id,
      customer_id: defaultCustomerId,
    });

    await storage.setItemAsync(DRAFT_ORDER_ID_STORAGE_KEY, newDraftOrder.draft_order.id);

    return newDraftOrder.draft_order.id;
  }, [getOrSetDefaultCustomer, sdk, settings.data?.region?.id, settings.data?.sales_channel?.id]);
};

export const useDraftOrderOrOrder = (draftOrderId: string) => {
  const sdk = useMedusaSdk();

  return useQuery({
    queryKey: ['draft-order', draftOrderId],
    queryFn: async () => {
      return sdk.admin.draftOrder
        .retrieve(draftOrderId, {
          fields:
            '+tax_total,+discount_total,+subtotal,+total,+items.variant.options.*,+items.variant.options.option.*,+items.variant.inventory_quantity,+items.requires_shipping,+items.product_type,+items.product.type.value,+customer.*,+metadata',
        })
        .then((res) => res.draft_order)
        .catch(async () => {
          const res = await sdk.admin.order.retrieve(draftOrderId, {
            fields:
              '+tax_total,+discount_total,+subtotal,+total,+items.variant.options.*,+items.variant.options.option.*,+items.variant.inventory_quantity,+items.requires_shipping,+items.product_type,+items.product.type.value,+customer.*,+metadata',
          });
          return res.order;
        });
    },
    enabled: !!draftOrderId,
  });
};

export const useCurrentDraftOrder = () => {
  const sdk = useMedusaSdk();

  return useQuery({
    queryKey: ['draft-order'],
    queryFn: async () => {
      const draftOrderId = await storage.getItemAsync(DRAFT_ORDER_ID_STORAGE_KEY);

      if (!draftOrderId) {
        return null;
      }

      return sdk.admin.draftOrder.retrieve(draftOrderId, {
        fields:
          '+tax_total,+discount_total,+subtotal,+total,+items.variant.options.*,+items.variant.options.option.*,+items.variant.inventory_quantity,+items.compare_at_unit_price,+items.unit_price,+items.requires_shipping,+items.product.variants.id,+items.product.variants.title,+items.product.variants.requires_shipping,+items.product.tags.value,+items.metadata,+items.product_type,+items.product.type.value,+customer.*,+metadata',
      });
    },
  });
};

export const useCancelDraftOrder = (options?: Omit<UseMutationOptions<void>, 'mutationKey' | 'mutationFn'>) => {
  const sdk = useMedusaSdk();
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ['draft-order', 'cancel'],
    mutationFn: async () => {
      const draftOrderId = await storage.getItemAsync(DRAFT_ORDER_ID_STORAGE_KEY);
      if (!draftOrderId) {
        throw new Error('Draft order ID not found');
      }

      await storage.deleteItemAsync(DRAFT_ORDER_ID_STORAGE_KEY);
      await sdk.admin.draftOrder.delete(draftOrderId);
    },
    ...options,
    onSettled: async (...args) => {
      if (queryClient.isMutating({ mutationKey: ['draft-order'], exact: false }) === 1) {
        await queryClient.invalidateQueries({
          queryKey: ['draft-order'],
          exact: false,
        });
      }

      return options?.onSettled?.(...args);
    },
  });
};

export const useAddToDraftOrder = (
  options?: Omit<
    UseMutationOptions<AdminDraftOrderPreviewResponse, Error, AdminAddDraftOrderItems, unknown>,
    'mutationKey' | 'mutationFn'
  >,
) => {
  const sdk = useMedusaSdk();
  const queryClient = useQueryClient();
  const getOrSetDraftOrderId = useGetOrSetDraftOrderId();

  return useMutation({
    mutationKey: ['draft-order', 'items', 'add'],
    mutationFn: async (items: AdminAddDraftOrderItems) => {
      const draftOrderId = await getOrSetDraftOrderId();

      // Get current draft order to check for existing items
      const currentDraftOrder = await sdk.admin.draftOrder.retrieve(draftOrderId, {
        fields: '+items.variant_id',
      });

      await sdk.admin.draftOrder.beginEdit(draftOrderId);

      try {
        // Separate items into those that need to be updated vs added
        const itemsToAdd = [];
        const itemsToUpdate = [];

        for (const newItem of items.items) {
          // Find if this variant already exists in the cart
          const existingItem = currentDraftOrder.draft_order.items.find(
            (item) => item.variant_id === newItem.variant_id,
          );

          if (existingItem) {
            // Item exists, increment quantity
            itemsToUpdate.push({
              id: existingItem.id,
              quantity: existingItem.quantity + newItem.quantity,
              unit_price: existingItem.unit_price,
              compare_at_unit_price: existingItem.compare_at_unit_price,
            });
          } else {
            // Item doesn't exist, add it
            itemsToAdd.push(newItem);
          }
        }

        // Update existing items
        for (const itemUpdate of itemsToUpdate) {
          await sdk.admin.draftOrder.updateItem(draftOrderId, itemUpdate.id, {
            quantity: itemUpdate.quantity,
            unit_price: itemUpdate.unit_price,
            compare_at_unit_price: itemUpdate.compare_at_unit_price,
          });
        }

        // Add new items
        if (itemsToAdd.length > 0) {
          await sdk.admin.draftOrder.addItems(draftOrderId, { items: itemsToAdd });
        }

        return await sdk.admin.draftOrder.confirmEdit(draftOrderId);
      } catch (error) {
        await sdk.admin.draftOrder.cancelEdit(draftOrderId);
        throw error;
      }
    },
    ...options,
    onSettled: async (...args) => {
      if (queryClient.isMutating({ mutationKey: ['draft-order'], exact: false }) === 1) {
        await queryClient.invalidateQueries({
          queryKey: ['draft-order'],
          exact: false,
        });
      }

      return options?.onSettled?.(...args);
    },
    onError: (error, variables, context) => {
      showErrorToast(error);
      return options?.onError?.(error, variables, context);
    },
  });
};

const updateChains = new Map<
  string,
  {
    promise: Promise<void>;
    abortController: AbortController;
  }
>();
const debounceTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

class UpdateDraftOrderItemAborted extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UpdateDraftOrderItemAborted';
  }
}

export const useUpdateDraftOrderItem = (
  options?: Omit<
    UseMutationOptions<
      void,
      Error,
      { id: string; update: Pick<AdminUpdateDraftOrderItem, 'quantity' | 'unit_price' | 'compare_at_unit_price'> },
      unknown
    >,
    'mutationKey' | 'mutationFn'
  >,
) => {
  const sdk = useMedusaSdk();
  const queryClient = useQueryClient();
  const getOrSetDraftOrderId = useGetOrSetDraftOrderId();

  return useMutation({
    mutationKey: ['draft-order', 'items', 'update'],
    mutationFn: async (item: {
      id: string;
      update: Pick<AdminUpdateDraftOrderItem, 'quantity' | 'unit_price' | 'compare_at_unit_price'>;
    }) => {
      // Clear existing timeout for this item
      if (debounceTimeouts.has(item.id)) {
        clearTimeout(debounceTimeouts.get(item.id)!);
        debounceTimeouts.delete(item.id);
      }

      // Cancel any existing update for this item
      const existingChain = updateChains.get(item.id);
      if (existingChain) {
        existingChain.abortController.abort();
      }

      // Create new abort controller for this update
      const abortController = new AbortController();

      // Create a new promise that chains after the existing one (if any)
      const previousPromise = existingChain?.promise ?? Promise.resolve();

      const updatePromise = previousPromise
        .catch(() => {
          // Ignore errors from previous updates in the chain
        })
        .then(async () => {
          // Wait for debounce period
          await new Promise<void>((debounceResolve) => {
            const timeoutId = setTimeout(() => {
              debounceTimeouts.delete(item.id);
              debounceResolve();
            }, 300);

            debounceTimeouts.set(item.id, timeoutId);

            // Handle abortion during debounce
            if (abortController.signal.aborted) {
              clearTimeout(timeoutId);
              debounceTimeouts.delete(item.id);
              throw new UpdateDraftOrderItemAborted(
                `Update for item ${item.id} with ${item.update.quantity} quantity aborted`,
              );
            }

            abortController.signal.addEventListener('abort', () => {
              clearTimeout(timeoutId);
              debounceTimeouts.delete(item.id);
              debounceResolve(); // Resolve to allow chain to continue
            });
          });

          // Check if aborted after debounce
          if (abortController.signal.aborted) {
            throw new UpdateDraftOrderItemAborted(
              `Update for item ${item.id} with ${item.update.quantity} quantity aborted`,
            );
          }

          // Perform the actual update
          const draftOrderId = await getOrSetDraftOrderId();
          await sdk.admin.draftOrder.beginEdit(draftOrderId);

          try {
            console.log(`Updating item ${item.id} with quantity ${JSON.stringify(item.update)}`);
            await sdk.admin.draftOrder.updateItem(draftOrderId, item.id, item.update);
            await sdk.admin.draftOrder.confirmEdit(draftOrderId);
          } catch (error) {
            console.error(`Error updating item ${item.id}:`, error);
            await sdk.admin.draftOrder.cancelEdit(draftOrderId);
            throw error;
          }
        })
        .catch((error) => {
          // Only reject if not aborted (aborted updates should resolve silently)
          if (!(error instanceof UpdateDraftOrderItemAborted)) {
            throw error;
          }
        })
        .finally(() => {
          // Clean up chain if this was the latest update
          const currentChain = updateChains.get(item.id);
          if (currentChain?.abortController === abortController) {
            updateChains.delete(item.id);
          }
        });

      // Store the new chain
      updateChains.set(item.id, {
        promise: updatePromise,
        abortController,
      });

      return updatePromise;
    },
    ...options,
    onMutate(variables) {
      options?.onMutate?.(variables);

      queryClient.cancelQueries({
        queryKey: ['draft-order'],
        exact: false,
      });

      const cachedDraftOrder = queryClient.getQueryData<AdminDraftOrderResponse>(['draft-order']);
      if (cachedDraftOrder) {
        const updatedDraftOrder: AdminDraftOrderResponse = {
          ...cachedDraftOrder,
          draft_order: {
            ...cachedDraftOrder.draft_order,
            items:
              variables.update.quantity === 0
                ? cachedDraftOrder.draft_order.items.filter((item) => item.id !== variables.id)
                : cachedDraftOrder.draft_order.items.map((item) =>
                    item.id === variables.id
                      ? {
                          ...item,
                          quantity: variables.update.quantity,
                          ...(variables.update.unit_price !== undefined &&
                            variables.update.unit_price !== null && {
                              unit_price: variables.update.unit_price,
                            }),
                          ...(variables.update.compare_at_unit_price !== undefined &&
                            variables.update.compare_at_unit_price !== null && {
                              compare_at_unit_price: variables.update.compare_at_unit_price,
                            }),
                        }
                      : item,
                  ),
          },
        };

        queryClient.setQueryData(['draft-order'], updatedDraftOrder);

        return { previousDraftOrder: cachedDraftOrder };
      }

      return { previousDraftOrder: undefined };
    },
    onError: (error, variables, context) => {
      if (context?.previousDraftOrder) {
        queryClient.setQueryData(['draft-order'], context.previousDraftOrder);
      }

      showErrorToast(error);

      return options?.onError?.(error, variables, context);
    },
    onSettled: async (...args) => {
      if (queryClient.isMutating({ mutationKey: ['draft-order'], exact: false }) === 1) {
        await queryClient.invalidateQueries({
          queryKey: ['draft-order'],
          exact: false,
        });
      }

      return options?.onSettled?.(...args);
    },
  });
};

interface SwapLineItemVariantParams {
  itemId: string;
  newVariantId: string;
  quantity: number;
  unit_price?: number | null;
  compare_at_unit_price?: number | null;
}

export const useSwapLineItemVariant = (
  options?: Omit<
    UseMutationOptions<AdminDraftOrderPreviewResponse, Error, SwapLineItemVariantParams, unknown>,
    'mutationKey' | 'mutationFn'
  >,
) => {
  const sdk = useMedusaSdk();
  const queryClient = useQueryClient();
  const getOrSetDraftOrderId = useGetOrSetDraftOrderId();

  return useMutation({
    mutationKey: ['draft-order', 'items', 'swap-variant'],
    mutationFn: async ({ itemId, newVariantId, quantity, unit_price, compare_at_unit_price }) => {
      const draftOrderId = await getOrSetDraftOrderId();
      await sdk.admin.draftOrder.beginEdit(draftOrderId);
      try {
        await sdk.admin.draftOrder.updateItem(draftOrderId, itemId, { quantity: 0 });
        await sdk.admin.draftOrder.addItems(draftOrderId, {
          items: [
            {
              variant_id: newVariantId,
              quantity,
              unit_price: unit_price ?? undefined,
              compare_at_unit_price: compare_at_unit_price ?? undefined,
            },
          ],
        });
        return await sdk.admin.draftOrder.confirmEdit(draftOrderId);
      } catch (error) {
        await sdk.admin.draftOrder.cancelEdit(draftOrderId);
        throw error;
      }
    },
    ...options,
    onSettled: async (...args) => {
      if (queryClient.isMutating({ mutationKey: ['draft-order'], exact: false }) === 1) {
        await queryClient.invalidateQueries({
          queryKey: ['draft-order'],
          exact: false,
        });
      }
      return options?.onSettled?.(...args);
    },
    onError(error, variables, context) {
      showErrorToast(error);
      return options?.onError?.(error, variables, context);
    },
  });
};

interface UpdateDraftOrderNoteParams {
  note: string;
  existingMetadata?: Record<string, unknown> | null;
}

// Duplicates a line item as a separate line (same variant, quantity 1), so the
// operator can split a product across fulfillment buckets and adjust quantities.
export const useDuplicateLineItem = (
  options?: Omit<
    UseMutationOptions<AdminDraftOrderPreviewResponse, Error, AdminOrderLineItem, unknown>,
    'mutationKey' | 'mutationFn'
  >,
) => {
  const sdk = useMedusaSdk();
  const queryClient = useQueryClient();
  const getOrSetDraftOrderId = useGetOrSetDraftOrderId();

  return useMutation({
    mutationKey: ['draft-order', 'items', 'duplicate'],
    mutationFn: async (item) => {
      const draftOrderId = await getOrSetDraftOrderId();
      const newItem = item.variant_id
        ? {
            variant_id: item.variant_id,
            quantity: 1,
            unit_price: item.unit_price,
            compare_at_unit_price: item.compare_at_unit_price,
          }
        : {
            title: item.title ?? item.product_title ?? 'Item',
            quantity: 1,
            unit_price: item.unit_price,
            compare_at_unit_price: item.compare_at_unit_price,
          };

      await sdk.admin.draftOrder.beginEdit(draftOrderId);
      try {
        await sdk.admin.draftOrder.addItems(draftOrderId, { items: [newItem] });
        return await sdk.admin.draftOrder.confirmEdit(draftOrderId);
      } catch (error) {
        await sdk.admin.draftOrder.cancelEdit(draftOrderId);
        throw error;
      }
    },
    ...options,
    onSettled: async (...args) => {
      if (queryClient.isMutating({ mutationKey: ['draft-order'], exact: false }) === 1) {
        await queryClient.invalidateQueries({ queryKey: ['draft-order'], exact: false });
      }
      return options?.onSettled?.(...args);
    },
    onError(error, variables, context) {
      showErrorToast(error);
      return options?.onError?.(error, variables, context);
    },
  });
};

// Sets a line item's fulfillment bucket (now/pickup/ship). Stored in the draft
// order's metadata as an { [lineItemId]: bucket } map and written via the
// order-level update() path (line-item metadata can't be changed on its own
// through the draft-order edit flow).
export const useSetLineItemBucket = (
  options?: Omit<
    UseMutationOptions<
      AdminDraftOrderPreviewResponse,
      Error,
      { item: AdminOrderLineItem; bucket: FulfillmentBucket },
      unknown
    >,
    'mutationKey' | 'mutationFn'
  >,
) => {
  const sdk = useMedusaSdk();
  const queryClient = useQueryClient();
  const getOrSetDraftOrderId = useGetOrSetDraftOrderId();

  return useMutation({
    mutationKey: ['draft-order', 'items', 'bucket'],
    mutationFn: async ({ item, bucket }) => {
      const draftOrderId = await getOrSetDraftOrderId();
      // Fetch current metadata so we merge rather than clobber the bucket map.
      const current = await sdk.admin.draftOrder.retrieve(draftOrderId, { fields: '+metadata' });
      const existingMetadata = current.draft_order.metadata ?? {};
      const existingMap = (existingMetadata[FULFILLMENT_BUCKETS_KEY] as Record<string, unknown> | undefined) ?? {};

      await sdk.admin.draftOrder.beginEdit(draftOrderId);
      try {
        await sdk.admin.draftOrder.update(draftOrderId, {
          metadata: {
            ...existingMetadata,
            [FULFILLMENT_BUCKETS_KEY]: { ...existingMap, [item.id]: bucket },
          },
        });
        return await sdk.admin.draftOrder.confirmEdit(draftOrderId);
      } catch (error) {
        await sdk.admin.draftOrder.cancelEdit(draftOrderId);
        throw error;
      }
    },
    ...options,
    onSettled: async (...args) => {
      if (queryClient.isMutating({ mutationKey: ['draft-order'], exact: false }) === 1) {
        await queryClient.invalidateQueries({ queryKey: ['draft-order'], exact: false });
      }
      return options?.onSettled?.(...args);
    },
    onError(error, variables, context) {
      showErrorToast(error);
      return options?.onError?.(error, variables, context);
    },
  });
};

export const useUpdateDraftOrderNote = (
  options?: Omit<
    UseMutationOptions<AdminDraftOrderPreviewResponse, Error, UpdateDraftOrderNoteParams, unknown>,
    'mutationKey' | 'mutationFn'
  >,
) => {
  const sdk = useMedusaSdk();
  const queryClient = useQueryClient();
  const getOrSetDraftOrderId = useGetOrSetDraftOrderId();

  return useMutation({
    mutationKey: ['draft-order', 'note', 'update'],
    mutationFn: async ({ note, existingMetadata }) => {
      const draftOrderId = await getOrSetDraftOrderId();
      await sdk.admin.draftOrder.beginEdit(draftOrderId);
      try {
        await sdk.admin.draftOrder.update(draftOrderId, {
          metadata: { ...(existingMetadata ?? {}), note },
        });
        return await sdk.admin.draftOrder.confirmEdit(draftOrderId);
      } catch (error) {
        await sdk.admin.draftOrder.cancelEdit(draftOrderId);
        throw error;
      }
    },
    ...options,
    onSettled: async (...args) => {
      if (queryClient.isMutating({ mutationKey: ['draft-order'], exact: false }) === 1) {
        await queryClient.invalidateQueries({
          queryKey: ['draft-order'],
          exact: false,
        });
      }
      return options?.onSettled?.(...args);
    },
    onError(error, variables, context) {
      showErrorToast(error);
      return options?.onError?.(error, variables, context);
    },
  });
};

export const useAddPromotion = (
  options?: Omit<
    UseMutationOptions<AdminDraftOrderPreviewResponse, Error, string, unknown>,
    'mutationKey' | 'mutationFn'
  >,
) => {
  const sdk = useMedusaSdk();
  const queryClient = useQueryClient();
  const getOrSetDraftOrderId = useGetOrSetDraftOrderId();

  return useMutation({
    mutationKey: ['draft-order', 'promotions', 'add'],
    mutationFn: async (promotionCode: string) => {
      const draftOrderId = await getOrSetDraftOrderId();
      await sdk.admin.draftOrder.beginEdit(draftOrderId);
      await sdk.admin.draftOrder
        .addPromotions(draftOrderId, {
          promo_codes: [promotionCode],
        })
        .catch(async (error) => {
          await sdk.admin.draftOrder.cancelEdit(draftOrderId);
          throw error;
        });
      return sdk.admin.draftOrder.confirmEdit(draftOrderId);
    },
    ...options,
    onSettled: async (...args) => {
      if (queryClient.isMutating({ mutationKey: ['draft-order'], exact: false }) === 1) {
        await queryClient.invalidateQueries({
          queryKey: ['draft-order'],
          exact: false,
        });
      }

      return options?.onSettled?.(...args);
    },
    onError(error, variables, context) {
      showErrorToast(error);
      return options?.onError?.(error, variables, context);
    },
  });
};

export const useRemovePromotion = (
  options?: Omit<
    UseMutationOptions<AdminDraftOrderPreviewResponse, Error, string, unknown>,
    'mutationKey' | 'mutationFn'
  >,
) => {
  const sdk = useMedusaSdk();
  const queryClient = useQueryClient();
  const getOrSetDraftOrderId = useGetOrSetDraftOrderId();

  return useMutation({
    mutationKey: ['draft-order', 'promotions', 'remove'],
    mutationFn: async (promotionCode: string) => {
      const draftOrderId = await getOrSetDraftOrderId();
      await sdk.admin.draftOrder.beginEdit(draftOrderId);
      await sdk.admin.draftOrder
        .removePromotions(draftOrderId, {
          promo_codes: [promotionCode],
        })
        .catch(async (error) => {
          await sdk.admin.draftOrder.cancelEdit(draftOrderId);
          throw error;
        });
      return sdk.admin.draftOrder.confirmEdit(draftOrderId);
    },
    ...options,
    onSettled: async (...args) => {
      if (queryClient.isMutating({ mutationKey: ['draft-order'], exact: false }) === 1) {
        await queryClient.invalidateQueries({
          queryKey: ['draft-order'],
          exact: false,
        });
      }

      return options?.onSettled?.(...args);
    },
    onError(error, variables, context) {
      showErrorToast(error);
      return options?.onError?.(error, variables, context);
    },
  });
};

export const useUpdateDraftOrderCustomer = (
  options?: Omit<
    UseMutationOptions<AdminDraftOrderPreviewResponse, Error, AdminCustomer | undefined, unknown>,
    'mutationKey' | 'mutationFn'
  >,
) => {
  const sdk = useMedusaSdk();
  const queryClient = useQueryClient();
  const getOrSetDraftOrderId = useGetOrSetDraftOrderId();

  return useMutation({
    mutationKey: ['draft-order', 'customer', 'update'],
    mutationFn: async (data) => {
      const draftOrderId = await getOrSetDraftOrderId();
      await sdk.admin.draftOrder.beginEdit(draftOrderId);
      await sdk.admin.draftOrder
        .update(draftOrderId, { customer_id: data?.id, email: data?.email })
        .catch(async (error) => {
          await sdk.admin.draftOrder.cancelEdit(draftOrderId);
          throw error;
        });
      return sdk.admin.draftOrder.confirmEdit(draftOrderId);
    },
    ...options,
    onMutate(data) {
      options?.onMutate?.(data);

      const cachedDraftOrder = queryClient.getQueryData<AdminDraftOrderResponse>(['draft-order']);

      if (cachedDraftOrder) {
        const updatedDraftOrder: AdminDraftOrderResponse = {
          ...cachedDraftOrder,
          draft_order: {
            ...cachedDraftOrder.draft_order,
            email: data?.email ?? null,
            customer_id: data?.id ?? null,
            customer: data,
          },
        };

        queryClient.setQueryData(['draft-order'], updatedDraftOrder);

        return { previousDraftOrder: cachedDraftOrder };
      }

      return { previousDraftOrder: undefined };
    },
    onError(error, variables, context) {
      queryClient.setQueryData(['draft-order'], context?.previousDraftOrder);
      if (queryClient.isMutating({ mutationKey: ['draft-order'], exact: false }) === 1) {
        queryClient.invalidateQueries({
          queryKey: ['draft-order'],
          exact: false,
        });
      }

      showErrorToast(error);

      return options?.onError?.(error, variables, context);
    },
    onSettled: async (...args) => {
      if (queryClient.isMutating({ mutationKey: ['draft-order'], exact: false }) === 1) {
        await queryClient.invalidateQueries({
          queryKey: ['draft-order'],
          exact: false,
        });
      }

      return options?.onSettled?.(...args);
    },
  });
};

export const useCompleteDraftOrder = (
  draftOrderId: string,
  options?: Omit<UseMutationOptions<void, Error, void, unknown>, 'mutationKey' | 'mutationFn'>,
) => {
  const sdk = useMedusaSdk();
  const queryClient = useQueryClient();
  const settings = useSettings();

  return useMutation({
    mutationKey: ['draft-order', draftOrderId, 'complete'],
    mutationFn: async () => {
      if (!draftOrderId) {
        throw new Error('Draft order ID is required to complete the order');
      }

      const { draft_order } = await sdk.admin.draftOrder.retrieve(draftOrderId, {
        fields:
          '+tax_total,+discount_total,+subtotal,+total,+items.variant.options.*,+items.variant.options.option.*,+items.variant.inventory_quantity,+customer.*,+customer.addresses.*',
      });

      const stockLocation = settings.data?.stock_location;
      const billingAddress =
        draft_order.customer?.addresses.find(
          (address) => address.is_default_billing || address.id === draft_order.customer?.default_billing_address_id,
        ) || draft_order.customer?.addresses[0];

      await sdk.admin.draftOrder.beginEdit(draftOrderId);
      await sdk.admin.draftOrder.update(draftOrderId, {
        billing_address: billingAddress
          ? {
              first_name: billingAddress.first_name ?? undefined,
              last_name: billingAddress.last_name ?? undefined,
              company: billingAddress.company ?? undefined,
              address_1: billingAddress.address_1 ?? undefined,
              address_2: billingAddress.address_2 ?? undefined,
              postal_code: billingAddress.postal_code ?? undefined,
              city: billingAddress.city ?? undefined,
              province: billingAddress.province ?? undefined,
              country_code: billingAddress.country_code ?? undefined,
              phone: billingAddress.phone ?? undefined,
            }
          : undefined,
        shipping_address: stockLocation
          ? {
              company: stockLocation.name,
              address_1: stockLocation.address?.address_1 ?? undefined,
              address_2: stockLocation.address?.address_2 ?? undefined,
              postal_code: stockLocation.address?.postal_code ?? undefined,
              city: stockLocation.address?.city ?? undefined,
              province: stockLocation.address?.province ?? undefined,
              country_code: stockLocation.address?.country_code ?? undefined,
              phone: stockLocation.address?.phone ?? undefined,
            }
          : undefined,
      });
      await sdk.admin.draftOrder.confirmEdit(draftOrderId);

      await sdk.admin.draftOrder.convertToOrder(draftOrderId);
      await sdk.client.fetch(`/admin/orders/${draftOrderId}/complete`, {
        method: 'POST',
      });
      await storage.deleteItemAsync(DRAFT_ORDER_ID_STORAGE_KEY);
    },
    ...options,
    onSettled: async (...args) => {
      await queryClient.invalidateQueries({
        queryKey: ['draft-order'],
        exact: false,
      });

      return options?.onSettled?.(...args);
    },
    onError(error, variables, context) {
      showErrorToast(error);
      return options?.onError?.(error, variables, context);
    },
  });
};

export const useDraftOrderPromotions = (codes: string[]) => {
  const sdk = useMedusaSdk();

  return useQuery({
    queryKey: ['promotions', ...codes],
    queryFn: async () => {
      return sdk.admin.promotion.list({
        code: codes,
        limit: codes.length,
      });
    },
    enabled: codes.length > 0,
  });
};
