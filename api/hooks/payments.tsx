import { useMedusaSdk } from '@/contexts/auth';
import { useSettings } from '@/contexts/settings';
import { storage } from '@/utils/storage';
import { showErrorToast } from '@/utils/errors';
import { bucketsFromOrder, FULFILLMENT_BUCKETS, getBucket } from '@/utils/fulfillment';
import { useMutation, UseMutationOptions, useQueryClient } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';

const DRAFT_ORDER_ID_STORAGE_KEY = 'draft_order_id';

export type PaymentType = 'cash' | 'stripe_payment_method' | 'stripe_payment_intent';

interface PaymentDetails {
  type: PaymentType;
  paymentMethodId?: string;
  paymentIntentId?: string;
}

interface CompleteOrderParams {
  payment: PaymentDetails;
}

/**
 * Unified hook to complete an order with any payment method.
 * This hook:
 * 1. Retrieves the draft order
 * 2. Updates billing and shipping addresses
 * 3. Converts draft order to order
 * 4. Creates payment collection on the order
 * 5. Handles payment based on type (cash uses markAsPaid, card payments use Stripe)
 * 6. Completes the order
 */
export const useCompleteOrder = (
  draftOrderId: string,
  options?: UseMutationOptions<any, Error, CompleteOrderParams>,
) => {
  const sdk = useMedusaSdk();
  const settings = useSettings();
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ['order', 'complete', draftOrderId],
    mutationFn: async ({ payment }: CompleteOrderParams) => {
      try {
        // Step 1: Retrieve the draft order with all necessary fields
        const { draft_order } = await sdk.admin.draftOrder.retrieve(draftOrderId, {
          fields:
            '+tax_total,+discount_total,+subtotal,+total,+items.variant.options.*,+items.variant.options.option.*,+items.variant.inventory_quantity,+customer.*,+customer.addresses.*,+metadata',
        });
        if (!draft_order) {
          throw new Error('Draft order not found');
        }

        // Step 2: Update addresses on the draft order
        const stockLocation = settings.data?.stock_location;
        const billingAddress =
          draft_order.customer?.addresses?.find(
            (address) => address.is_default_billing || address.id === draft_order.customer?.default_billing_address_id,
          ) || draft_order.customer?.addresses?.[0];

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

        // Step 3: Convert draft order to order and mark as paid.
        const order = await sdk.admin.draftOrder
          .convertToOrder(draftOrderId, {
            fields: '+id,+payment_collections.*,+items.id,+items.quantity,+items.requires_shipping',
          })
          .then(async ({ order }) => {
            let paymentCollection = order.payment_collections[0];
            await sdk.admin.paymentCollection.markAsPaid(paymentCollection.id, {
              order_id: order.id,
            });
            return order;
          });

        // Step 4: Create one fulfillment per operator-selected bucket (from the
        // cart's fulfillment_buckets metadata), which drives the order's status:
        //   - now (take now): fulfilled + marked delivered (handed over in person)
        //   - pickup:         fulfilled, left un-delivered until the customer collects it
        //   - ship:           left unfulfilled, handled by the shipping workflow later
        // Grouping by bucket (rather than by requires_shipping) is what was missing:
        // the old code lumped every non-shipping item into one fulfillment and marked
        // it delivered, so a "ship" item that wasn't flagged requires_shipping was
        // wrongly delivered. Buckets already separate in-person from shipped items, so
        // one fulfillment per bucket also respects Medusa's no-mixed-shipping rule.
        const itemBuckets = bucketsFromOrder(draft_order.metadata);
        const resolveBucket = (item: { id: string; requires_shipping?: boolean | null }) =>
          getBucket(item, [...FULFILLMENT_BUCKETS], itemBuckets);

        const seenFulfillmentIds = new Set<string>((order.fulfillments ?? []).map((f) => f.id));

        // 'ship' is intentionally omitted — those items stay unfulfilled at checkout.
        for (const bucket of ['now', 'pickup'] as const) {
          const groupItems = order.items.filter((item) => resolveBucket(item) === bucket);
          if (groupItems.length === 0) continue;

          const { order: fulfilledOrder } = await sdk.admin.order.createFulfillment(
            draftOrderId,
            { items: groupItems.map((item) => ({ id: item.id, quantity: item.quantity })) },
            { fields: '+id,+fulfillments.id' },
          );

          const newFulfillment = fulfilledOrder.fulfillments?.find((f) => !seenFulfillmentIds.has(f.id));
          if (newFulfillment) {
            seenFulfillmentIds.add(newFulfillment.id);
            if (bucket === 'now') {
              await sdk.admin.order.markAsDelivered(fulfilledOrder.id, newFulfillment.id);
            }
          }
        }

        // Step 6: Complete the order
        await sdk.admin.order.complete(draftOrderId, {});

        // Step 7: Clean up draft order from storage
        await storage.deleteItemAsync(DRAFT_ORDER_ID_STORAGE_KEY);

        return {
          orderId: draftOrderId,
        };
      } catch (error) {
        console.error('Failed to complete order:', error);
        throw error;
      }
    },
    onSuccess: async () => {
      // Invalidate draft order queries so the UI updates
      await queryClient.invalidateQueries({
        queryKey: ['draft-order', draftOrderId],
      });

      Toast.show({
        type: 'success',
        text1: 'Payment Successful',
        text2: 'Order has been completed',
      });
    },
    onError: (error) => {
      showErrorToast(error);
    },
    ...options,
  });
};

/**
 * Hook to create a Stripe payment intent for Terminal payments
 */
export const useCreatePaymentIntent = (
  options?: UseMutationOptions<any, Error, { amount: number; currency: string }>,
) => {
  const sdk = useMedusaSdk();

  return useMutation({
    mutationKey: ['payment-intent', 'create'],
    mutationFn: async ({ amount, currency }: { amount: number; currency: string }) => {
      try {
        // Call your backend to create a payment intent
        // This should be a custom endpoint that creates a Stripe PaymentIntent
        const response = await sdk.client.fetch('/store/payment-intents', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            amount,
            currency,
            payment_method_types: ['card_present'],
            capture_method: 'automatic',
          }),
        });

        return response;
      } catch (error) {
        console.error('Failed to create payment intent:', error);
        throw error;
      }
    },
    onError: (error) => {
      showErrorToast(error);
    },
    ...options,
  });
};
