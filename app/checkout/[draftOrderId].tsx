import {
  DRAFT_ORDER_DEFAULT_CUSTOMER_EMAIL,
  useCurrentDraftOrder,
  useDraftOrderOrOrder,
} from '@/api/hooks/draft-orders';
import { useCompleteOrder } from '@/api/hooks/payments';
import { STRIPE_CONFIG } from '@/config/stripe';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { Image, ScrollView, View } from 'react-native';
import { Dialog } from '@/components/ui/Dialog';
import { InfoBanner } from '@/components/InfoBanner';
import { PaymentSelection, PaymentMethod } from '@/components/PaymentSelection';
import { CardPayment } from '@/components/CardPayment';
import { CheckoutSkeleton } from '@/components/skeletons/CheckoutSkeleton';
import { Button } from '@/components/ui/Button';
import { Layout } from '@/components/ui/Layout';
import { Text } from '@/components/ui/Text';
import { useSettings } from '@/contexts/settings';
import { formatDate } from '@/utils/date';
import { AdminOrderLineItem } from '@medusajs/types';
import { StripeProvider } from '@stripe/stripe-react-native';
import { FlashList, ListRenderItem } from '@shopify/flash-list';
import { ShoppingCart } from '@/components/icons/shopping-cart';

type CheckoutStep = 'details' | 'payment';

const DraftOrderItem: React.FC<{ item: AdminOrderLineItem }> = ({ item }) => {
  const settings = useSettings();
  const draftOrder = useCurrentDraftOrder();
  const thumbnail = item.thumbnail || item.product?.thumbnail || item.product?.images?.[0]?.url;

  return (
    <View className="flex-row gap-4 p-4">
      {thumbnail && (
        <Image
          source={{
            uri: thumbnail,
          }}
          className="h-16 w-16 rounded-lg bg-gray-200"
        />
      )}
      {!thumbnail && <View className="h-16 w-16 rounded-lg bg-gray-200" />}

      <View className="flex-1 justify-between">
        <View>
          <Text className="font-semibold">{item.title}</Text>
          <Text className="text-sm text-gray-400">{item.variant?.title}</Text>
        </View>

        <View className="flex-row items-center justify-between">
          <Text className="text-gray-400">Qty: {item.quantity}</Text>
          <Text className="font-semibold">
            {item.total?.toLocaleString('en-US', {
              style: 'currency',
              currency: draftOrder.data?.draft_order.region?.currency_code || settings.data?.region?.currency_code,
              currencyDisplay: 'narrowSymbol',
            })}
          </Text>
        </View>
      </View>
    </View>
  );
};

export default function CheckoutScreen() {
  const { draftOrderId } = useLocalSearchParams<{ draftOrderId: string }>();
  const settings = useSettings();
  const draftOrder = useDraftOrderOrOrder(draftOrderId);
  const completeOrder = useCompleteOrder(draftOrderId);

  const [currentStep, setCurrentStep] = useState<CheckoutStep>('details');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');

  const handleCashPayment = async () => {
    try {
      await completeOrder.mutateAsync({
        payment: {
          type: 'cash',
        },
      });
    } catch (error) {
      console.error('Failed to complete order with cash:', error);
    }
  };

  const handleCardPaymentSuccess = async (paymentIntentId: string) => {
    try {
      await completeOrder.mutateAsync({
        payment: {
          type: 'stripe_payment_intent',
          paymentIntentId,
        },
      });
    } catch (error) {
      console.error('Failed to complete order with payment intent:', error);
    }
  };

  const renderItem = React.useCallback<ListRenderItem<AdminOrderLineItem>>(
    ({ item }) => <DraftOrderItem item={item} />,
    [],
  );

  const items = draftOrder.data?.items || [];

  if (draftOrder.isLoading || settings.isLoading) {
    return <CheckoutSkeleton />;
  }

  if (draftOrder.isError || settings.isError) {
    return (
      <Layout>
        <Text className="text-4xl">Checkout</Text>
        <View className="flex-1 items-center justify-center gap-2">
          <InfoBanner variant="ghost" colorScheme="error" className="w-40">
            Failed to load cart
          </InfoBanner>
          <Button
            onPress={() => {
              draftOrder.refetch();
              settings.refetch();
            }}
            isPending={draftOrder.isRefetching || settings.isRefetching}
            variant="outline"
          >
            Try Again
          </Button>
        </View>
      </Layout>
    );
  }

  if (!draftOrder.data?.items.length) {
    return (
      <Layout>
        <Text className="text-4xl">Checkout</Text>
        <View className="flex-1 items-center justify-center gap-1">
          <ShoppingCart size={24} />
          <Text className="text-xl">Your cart is empty</Text>
          <Text className="text-center text-gray-300">
            It seems you have no items in your cart.{'\n'}Please add items to your cart before{'\n'}proceeding to
            checkout.
          </Text>
        </View>
        <View className="flex-row gap-2">
          <Button variant="outline" className="flex-1" onPress={() => router.back()}>
            Back to Cart
          </Button>
          <Button className="flex-1" disabled>
            Complete Order
          </Button>
        </View>
      </Layout>
    );
  }

  const isDraftOrder = draftOrder.data.status === 'draft';
  const customerEmail = draftOrder.data.customer?.email;
  const customerName = [draftOrder.data.customer?.first_name, draftOrder.data.customer?.last_name]
    .filter(Boolean)
    .join(' ');
  const customerPhone = draftOrder.data.customer?.phone;
  const isPosDefaultCustomer = !customerEmail || customerEmail === DRAFT_ORDER_DEFAULT_CUSTOMER_EMAIL;

  return (
    <>
      <Layout>
        <Text className="mb-6 text-4xl">Checkout</Text>

        {currentStep === 'details' && (
          <>
            <FlashList
              data={items}
              renderItem={renderItem}
              ItemSeparatorComponent={() => <View className="h-hairline bg-gray-200" />}
              ListHeaderComponent={() => <Text className="text-2xl">Cart Items</Text>}
              ListFooterComponent={() => (
                <View className="mb-10 mt-4">
                  <Text className="mb-2 text-2xl">Customer</Text>
                  {!isPosDefaultCustomer ? (
                    <View className="rounded-xl bg-gray-50 p-4">
                      {customerName && <Text className="font-semibold">{customerName}</Text>}
                      {customerEmail && <Text className="text-gray-400">{customerEmail}</Text>}
                      {customerPhone && <Text className="text-gray-400">{customerPhone}</Text>}
                    </View>
                  ) : (
                    <View className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4">
                      <Text className="text-center text-gray-400">Walk-in Customer</Text>
                    </View>
                  )}

                  <View className="mb-4 mt-6 rounded-xl bg-gray-50 p-4">
                    <Text className="mb-4 text-lg font-semibold">Order Summary</Text>
                    <View className="mb-2 flex-row justify-between">
                      <Text className="text-gray-400">Subtotal</Text>
                      <Text>
                        {draftOrder.data.subtotal?.toLocaleString('en-US', {
                          style: 'currency',
                          currency: draftOrder.data.region?.currency_code || settings.data?.region?.currency_code,
                          currencyDisplay: 'narrowSymbol',
                        })}
                      </Text>
                    </View>
                    <View className="mb-2 flex-row justify-between">
                      <Text className="text-gray-400">Taxes</Text>
                      <Text>
                        {draftOrder.data.tax_total?.toLocaleString('en-US', {
                          style: 'currency',
                          currency: draftOrder.data.region?.currency_code || settings.data?.region?.currency_code,
                          currencyDisplay: 'narrowSymbol',
                        })}
                      </Text>
                    </View>
                    {typeof draftOrder.data.discount_total === 'number' && draftOrder.data.discount_total > 0 && (
                      <View className="mb-2 flex-row justify-between">
                        <Text className="text-gray-400">Discount</Text>
                        <Text>
                          {(draftOrder.data.discount_total * -1)?.toLocaleString('en-US', {
                            style: 'currency',
                            currency: draftOrder.data.region?.currency_code || settings.data?.region?.currency_code,
                            currencyDisplay: 'narrowSymbol',
                          })}
                        </Text>
                      </View>
                    )}
                    <View className="mt-4 border-t border-gray-200 pt-4">
                      <View className="flex-row justify-between">
                        <Text className="text-lg font-semibold">Total</Text>
                        <Text className="text-lg font-semibold">
                          {draftOrder.data.total?.toLocaleString('en-US', {
                            style: 'currency',
                            currency: draftOrder.data.region?.currency_code || settings.data?.region?.currency_code,
                            currencyDisplay: 'narrowSymbol',
                          })}
                        </Text>
                      </View>
                    </View>
                  </View>
                </View>
              )}
              keyboardDismissMode="on-drag"
            />

            <View className="pb-safe flex-row gap-2">
              <Button variant="outline" className="flex-1" onPress={() => router.back()}>
                Back
              </Button>
              <Button className="flex-1" onPress={() => setCurrentStep('payment')} disabled={!isDraftOrder}>
                Continue to Payment
              </Button>
            </View>
          </>
        )}

        {currentStep === 'payment' && (
          <>
            <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
              <Text className="mb-6 text-2xl">Select Payment Method</Text>

              <PaymentSelection value={paymentMethod} onChange={setPaymentMethod} className="mb-6" />

              {/* Cash Payment */}
              {paymentMethod === 'cash' && (
                <>
                  <View className="mb-6 rounded-xl bg-gray-50 p-4">
                    <Text className="mb-2 text-lg font-semibold">Cash Payment</Text>
                    <Text className="text-gray-400">Collect cash from customer and complete the order.</Text>
                  </View>

                  <View className="mb-6 rounded-xl bg-gray-50 p-4">
                    <Text className="mb-4 text-lg font-semibold">Order Summary</Text>
                    <View className="mb-2 flex-row justify-between">
                      <Text className="text-gray-400">Subtotal</Text>
                      <Text>
                        {draftOrder.data.subtotal?.toLocaleString('en-US', {
                          style: 'currency',
                          currency: draftOrder.data.region?.currency_code || settings.data?.region?.currency_code,
                          currencyDisplay: 'narrowSymbol',
                        })}
                      </Text>
                    </View>
                    <View className="mb-2 flex-row justify-between">
                      <Text className="text-gray-400">Taxes</Text>
                      <Text>
                        {draftOrder.data.tax_total?.toLocaleString('en-US', {
                          style: 'currency',
                          currency: draftOrder.data.region?.currency_code || settings.data?.region?.currency_code,
                          currencyDisplay: 'narrowSymbol',
                        })}
                      </Text>
                    </View>
                    {typeof draftOrder.data.discount_total === 'number' && draftOrder.data.discount_total > 0 && (
                      <View className="mb-2 flex-row justify-between">
                        <Text className="text-gray-400">Discount</Text>
                        <Text>
                          {(draftOrder.data.discount_total * -1)?.toLocaleString('en-US', {
                            style: 'currency',
                            currency: draftOrder.data.region?.currency_code || settings.data?.region?.currency_code,
                            currencyDisplay: 'narrowSymbol',
                          })}
                        </Text>
                      </View>
                    )}
                    <View className="mt-4 border-t border-gray-200 pt-4">
                      <View className="flex-row justify-between">
                        <Text className="text-lg font-semibold">Total</Text>
                        <Text className="text-lg font-semibold">
                          {draftOrder.data.total?.toLocaleString('en-US', {
                            style: 'currency',
                            currency: draftOrder.data.region?.currency_code || settings.data?.region?.currency_code,
                            currencyDisplay: 'narrowSymbol',
                          })}
                        </Text>
                      </View>
                    </View>
                  </View>
                </>
              )}

              {/* Card Payment */}
              {paymentMethod === 'card' && (
                <StripeProvider publishableKey={STRIPE_CONFIG.publishableKey}>
                  <CardPayment
                    amount={Math.round((draftOrder.data.total || 0) * 100)}
                    currency={draftOrder.data.region?.currency_code || settings.data?.region?.currency_code || 'usd'}
                    onPaymentSuccess={handleCardPaymentSuccess}
                    onCancel={() => setPaymentMethod('cash')}
                  />
                </StripeProvider>
              )}
            </ScrollView>

            {/* Only show complete order button for cash */}
            {paymentMethod === 'cash' && (
              <View className="pb-safe flex-row gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onPress={() => setCurrentStep('details')}
                  disabled={completeOrder.isPending}
                >
                  Back
                </Button>
                <Button
                  className="flex-1"
                  onPress={handleCashPayment}
                  disabled={!isDraftOrder}
                  isPending={completeOrder.isPending}
                >
                  Complete Order
                </Button>
              </View>
            )}
          </>
        )}
      </Layout>

      <Dialog
        visible={!isDraftOrder && draftOrder.data?.status !== 'draft'}
        showCloseButton={false}
        dismissOnOverlayPress={false}
        onRequestClose={(event) => {
          event.preventDefault();
        }}
        onOverlayPress={(event) => {
          event.preventDefault();
        }}
        onCloseIconPress={(event) => {
          event.preventDefault();
        }}
        title="Order confirmed!"
        contentClassName="flex-shrink"
      >
        <InfoBanner colorScheme="success" className="mb-4">
          The order has been placed successfully. You can track the order status on Orders screen.
        </InfoBanner>

        <Button
          className="mb-2"
          onPress={() => {
            router.replace('/orders');
            router.push({
              pathname: '/orders/[orderId]',
              params: {
                orderId: draftOrderId,
                orderNumber: draftOrder.data.display_id,
                orderDate: formatDate(draftOrder.data.created_at),
              },
            });
          }}
        >
          View Order
        </Button>
        <Button
          variant="outline"
          onPress={() => {
            router.replace('/products');
          }}
        >
          Back to shop
        </Button>
      </Dialog>
    </>
  );
}
