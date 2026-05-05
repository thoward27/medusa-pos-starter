import { useMedusaSdk } from '@/contexts/auth';
import { useSettings } from '@/contexts/settings';
import { storage } from '@/utils/storage';
import { showErrorToast } from '@/utils/errors';
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
            '+tax_total,+discount_total,+subtotal,+total,+items.variant.options.*,+items.variant.options.option.*,+items.variant.inventory_quantity,+customer.*,+customer.addresses.*',
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
        let order = await sdk.admin.draftOrder
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

        // Step 4: Auto-fulfill any line items that don't require shipping (customer is
        // taking them in person). Items that require shipping are left for the regular
        // shipping workflow. Medusa rejects mixed-shipping fulfillments, so we must split.
        const nonShippingItems = order.items.filter((item) => !item.requires_shipping);
        if (nonShippingItems.length > 0) {
          const { order: fulfilledOrder } = await sdk.admin.order.createFulfillment(
            draftOrderId,
            {
              items: nonShippingItems.map((item) => ({
                id: item.id,
                quantity: item.quantity,
              })),
            },
            { fields: '+id,+fulfillments.id,+fulfillments.requires_shipping' },
          );
          const newFulfillment = fulfilledOrder.fulfillments?.find((f) => !f.requires_shipping);
          if (newFulfillment) {
            await sdk.admin.order.markAsDelivered(fulfilledOrder.id, newFulfillment.id);
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
