import { useCustomers } from '@/api/hooks/customers';
import {
  DRAFT_ORDER_DEFAULT_CUSTOMER_EMAIL,
  useAddPromotion,
  useCancelDraftOrder,
  useCurrentDraftOrder,
  useDraftOrderPromotions,
  useDuplicateLineItem,
  useRemovePromotion,
  useSetLineItemBucket,
  useUpdateDraftOrderCustomer,
  useUpdateDraftOrderItem,
  useUpdateDraftOrderNote,
} from '@/api/hooks/draft-orders';
import { Form } from '@/components/form/Form';
import { FormButton } from '@/components/form/FormButton';
import { TextField } from '@/components/form/TextField';
import { ChevronDown } from '@/components/icons/chevron-down';
import { Plus } from '@/components/icons/plus';
import { ShoppingCart } from '@/components/icons/shopping-cart';
import { Tag } from '@/components/icons/tag';
import { Trash2 } from '@/components/icons/trash-2';
import { UserRoundPlus } from '@/components/icons/user-round-plus';
import { X } from '@/components/icons/x';
import { InfoBanner } from '@/components/InfoBanner';
import { PriceEditorDialog } from '@/components/PriceEditorDialog';
import { CartSkeleton } from '@/components/skeletons/CartSkeleton';
import { SwipeableListItem } from '@/components/SwipeableListItem';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { FulfillmentBucketSelect } from '@/components/ui/FulfillmentBucketSelect';
import { Layout } from '@/components/ui/Layout';
import { Prompt } from '@/components/ui/Prompt';
import { QuantityPicker } from '@/components/ui/QuantityPicker';
import { Text } from '@/components/ui/Text';
import { clx } from '@/utils/clx';
import {
  BUCKET_META,
  bucketsFromOrder,
  FULFILLMENT_BUCKETS,
  FulfillmentBucket,
  getBucket,
  itemEligibleBuckets,
} from '@/utils/fulfillment';
import { commissionCheckoutState } from '@/utils/commissions';
import { stableCacheKey } from '@/utils/images';
import { useSettings } from '@/contexts/settings';
import { AdminDraftOrder, AdminOrderLineItem, AdminPromotion } from '@medusajs/types';
import type { FlashListRef } from '@shopify/flash-list';
import { FlashList, ListRenderItem } from '@shopify/flash-list';
import { useIsMutating } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import * as React from 'react';
import { Pressable, TextInput, TouchableOpacity, View } from 'react-native';
import Animated, { SequencedTransition, SlideOutLeft } from 'react-native-reanimated';
import { useSafeAreaFrame } from 'react-native-safe-area-context';
import * as z from 'zod/v4';

interface TPromotionItem extends AdminPromotion {
  __type__: 'promotion';
  discount_amount: number;
}

const addPromotionFormSchema = z.object({
  promotionCode: z.string().min(1, 'Promotion code is required'),
});

type LineItemType =
  | { id: string; __type__: 'footer' }
  | { id: string; __type__: 'bucket_header'; bucket: FulfillmentBucket }
  | (AdminOrderLineItem & { __type__: 'draft_order_item' })
  | TPromotionItem;

const ItemCell = React.forwardRef<Animated.View>((props, ref) => {
  return <Animated.View {...props} layout={SequencedTransition} exiting={SlideOutLeft} ref={ref} />;
});
ItemCell.displayName = 'ItemCell';

const DraftOrderItem: React.FC<{ item: AdminOrderLineItem; onRemove?: (item: AdminOrderLineItem) => void }> = ({
  item,
  onRemove,
}) => {
  const settings = useSettings();
  const draftOrder = useCurrentDraftOrder();
  const updateDraftOrderItem = useUpdateDraftOrderItem();
  const setLineItemBucket = useSetLineItemBucket();
  const duplicateLineItem = useDuplicateLineItem();
  const thumbnail = item.thumbnail || item.product?.thumbnail || item.product?.images?.[0]?.url;
  const [isPriceEditorVisible, setIsPriceEditorVisible] = React.useState(false);

  const currencyCode = draftOrder.data?.draft_order.region?.currency_code || settings.data?.region?.currency_code;
  const hasCustomPrice = item.compare_at_unit_price != null && item.compare_at_unit_price !== item.unit_price;

  const buckets = bucketsFromOrder(draftOrder.data?.draft_order.metadata);
  const eligible = itemEligibleBuckets(item);
  const bucket = getBucket(item, eligible, buckets);

  const handlePriceUpdate = (newPrice: number) => {
    // Determine the original price to preserve:
    // If compare_at_unit_price is already set, keep it
    // Otherwise, if we're changing the price, set it to the current unit_price
    // This ensures the original price is always preserved once set
    const compareAtPrice = item.compare_at_unit_price ?? item.unit_price;
    console.log(`handlePriceUpdate(${newPrice}): ${compareAtPrice}`);

    updateDraftOrderItem.mutate({
      id: item.id,
      update: {
        quantity: item.quantity,
        unit_price: newPrice,
        compare_at_unit_price: compareAtPrice,
      },
    });
  };

  return (
    <>
      <SwipeableListItem
        rightClassName="bg-white"
        rightWidth={80}
        rightContent={
          <View className="h-full w-full flex-1 items-center justify-center p-2">
            <Pressable
              className="h-full w-full flex-1 items-center justify-center rounded-xl bg-error-500"
              onPress={() => {
                onRemove?.(item);
              }}
            >
              <Trash2 size={24} color="white" />
            </Pressable>
          </View>
        }
      >
        <View className={clx('flex-row gap-4 border-l-4 bg-white py-6 pl-3', BUCKET_META[bucket].barClass)}>
          <View className="h-[5.25rem] w-[5.25rem] overflow-hidden rounded-xl bg-gray-200">
            {thumbnail && (
              <Image
                source={{ uri: thumbnail, cacheKey: stableCacheKey(thumbnail) }}
                cachePolicy="memory-disk"
                recyclingKey={item.id}
                contentFit="cover"
                style={{ width: '100%', height: '100%' }}
              />
            )}
          </View>
          <View className="flex-1 flex-col gap-2">
            <Text>{item.product_title}</Text>
            {item.variant && item.variant.options && item.variant.options.length > 0 && (
              <View className="flex-row flex-wrap items-center gap-x-2 gap-y-1">
                {item.variant.options.map((option) => (
                  <View className="flex-row gap-1" key={option.id}>
                    <Text className="text-sm text-gray-400">{option.option?.title || option.option_id}:</Text>
                    <Text className="text-sm">{option.value}</Text>
                  </View>
                ))}
              </View>
            )}
            <QuantityPicker
              quantity={item.quantity}
              max={item.variant?.inventory_quantity}
              onQuantityChange={(quantity) =>
                updateDraftOrderItem.mutate({
                  id: item.id,
                  update: {
                    quantity,
                    unit_price: item.unit_price,
                    compare_at_unit_price: item.compare_at_unit_price,
                  },
                })
              }
              className="self-start"
            />
            <View className="flex-row items-center gap-3">
              <FulfillmentBucketSelect
                value={bucket}
                eligible={eligible}
                disabled={setLineItemBucket.isPending}
                onChange={(next) => setLineItemBucket.mutate({ item, bucket: next })}
              />
              <Pressable
                disabled={duplicateLineItem.isPending}
                onPress={() => duplicateLineItem.mutate(item)}
                className={clx('flex-row items-center gap-1 py-1.5', { 'opacity-50': duplicateLineItem.isPending })}
              >
                <Plus size={14} className="text-active-500" />
                <Text className="text-sm text-active-500">Duplicate</Text>
              </Pressable>
            </View>
          </View>
          <TouchableOpacity onPress={() => setIsPriceEditorVisible(true)} className="ml-auto">
            <View className="items-end gap-1">
              <Text>
                {item.unit_price.toLocaleString('en-US', {
                  style: 'currency',
                  currency: currencyCode,
                  currencyDisplay: 'narrowSymbol',
                })}
              </Text>
              {hasCustomPrice && (
                <Text className="text-sm text-gray-400 line-through">
                  {item.compare_at_unit_price!.toLocaleString('en-US', {
                    style: 'currency',
                    currency: currencyCode,
                    currencyDisplay: 'narrowSymbol',
                  })}
                </Text>
              )}
            </View>
          </TouchableOpacity>
        </View>
      </SwipeableListItem>

      <PriceEditorDialog
        visible={isPriceEditorVisible}
        onClose={() => setIsPriceEditorVisible(false)}
        onSubmit={handlePriceUpdate}
        currentPrice={item.unit_price}
        originalPrice={item.compare_at_unit_price}
        currencyCode={currencyCode}
        itemTitle={item.product_title || item.title}
      />
    </>
  );
};

const PromotionItem: React.FC<{
  item: TPromotionItem;
  onRemove?: (item: TPromotionItem) => Promise<void>;
  currencyCode: string | undefined;
}> = ({ item, onRemove, currencyCode }) => {
  const isAutomatic = item.is_automatic === true;

  const getPromotionTypeLabel = (type?: string) => {
    switch (type) {
      case 'standard':
        return 'Standard';
      case 'buyget':
        return 'Buy X Get Y';
      default:
        return 'Promotion';
    }
  };

  return (
    <SwipeableListItem
      rightClassName="bg-white"
      rightWidth={isAutomatic ? undefined : 80}
      rightContent={
        isAutomatic ? undefined : (
          <View className="h-full w-full flex-1 items-center justify-center p-2">
            <Pressable
              className="h-full w-full flex-1 items-center justify-center rounded-xl bg-error-500"
              onPress={async () => {
                await onRemove?.(item);
              }}
            >
              <Trash2 size={24} color="white" />
            </Pressable>
          </View>
        )
      }
    >
      <View className="flex-row gap-4 bg-white py-6">
        <View className="flex h-[5.25rem] w-[5.25rem] items-center justify-center overflow-hidden rounded-xl bg-green-100">
          <View className="flex items-center justify-center">
            <Tag size={32} color="#10B981" />
          </View>
        </View>
        <View className="flex-1 flex-col gap-2">
          <View className="flex-row items-center gap-2">
            <Text className="font-medium">{item.code || 'Promotion'}</Text>
          </View>
          <View className="flex-row flex-wrap items-center gap-x-2 gap-y-1">
            <View className="flex-row gap-1">
              <Text className="text-sm text-gray-400">Type:</Text>
              <Text className="text-sm">{getPromotionTypeLabel(item.type)}</Text>
            </View>
            <View className="flex-row gap-1">
              <Text className="text-sm text-gray-400">Method:</Text>
              <Text className="text-sm">{isAutomatic ? 'Automatic' : 'Code'}</Text>
            </View>
            {item.campaign && (
              <View className="flex-row gap-1">
                <Text className="text-sm text-gray-400">Campaign:</Text>
                <Text className="text-sm">{item.campaign.name}</Text>
              </View>
            )}
          </View>
        </View>
        <Text className="ml-auto">
          {(item.discount_amount * -1).toLocaleString('en-US', {
            style: 'currency',
            currency: currencyCode,
            currencyDisplay: 'narrowSymbol',
          })}
        </Text>
      </View>
    </SwipeableListItem>
  );
};

const CustomerBadge: React.FC<{
  customer: AdminDraftOrder['customer'];
  highlight?: 'none' | 'required' | 'valid';
}> = ({ customer, highlight = 'none' }) => {
  const updateDraftOrder = useUpdateDraftOrderCustomer();
  // TODO: pull this out and make sure that default customer is fetched before we can show customer badge
  const defaultCustomer = useCustomers({ email: DRAFT_ORDER_DEFAULT_CUSTOMER_EMAIL }, 1);

  if (!customer || customer.email === DRAFT_ORDER_DEFAULT_CUSTOMER_EMAIL) {
    return (
      <Button
        onPress={() => router.push('/customer-lookup')}
        variant="outline"
        icon={<UserRoundPlus size={20} />}
        className={clx(
          'mb-6 justify-between',
          highlight === 'required' && 'border-2 border-red-500',
          highlight === 'valid' && 'border-2 border-green-500',
        )}
      >
        Add Customer
      </Button>
    );
  }

  const customerName = [customer.first_name, customer.last_name].filter(Boolean).join(' ');

  return (
    <TouchableOpacity
      onPress={() => {
        router.push({
          pathname: '/customer-lookup',
          params: {
            customerId: customer.id,
          },
        });
      }}
      className={clx(
        'mb-6 flex-row items-center justify-between border-b pb-6',
        highlight === 'required' ? 'rounded-lg border-2 border-red-500 p-4' : 'border-gray-200',
        highlight === 'valid' && 'rounded-lg border-2 border-green-500 p-4',
      )}
    >
      {customerName.length > 0 ? (
        <View>
          <Text className="text-lg">{customerName}</Text>
          <Text className="text-sm text-gray-300">{customer.email}</Text>
        </View>
      ) : (
        <View>
          <Text className="text-sm text-gray-300">Customer</Text>
          <Text className="text-lg">{customer.email}</Text>
        </View>
      )}

      <View className="flex-row">
        <View className="p-2">
          <ChevronDown size={24} />
        </View>
        <TouchableOpacity
          onPress={() => updateDraftOrder.mutate(defaultCustomer.data?.pages[0].customers?.[0])}
          className="p-2"
        >
          <X size={24} />
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
};

const OrderNoteInput: React.FC<{
  initialValue: string;
  existingMetadata: Record<string, unknown> | null | undefined;
}> = ({ initialValue, existingMetadata }) => {
  const updateNote = useUpdateDraftOrderNote();
  const [value, setValue] = React.useState(initialValue);
  const lastSavedRef = React.useRef(initialValue);

  // If the source value changes (e.g. cart reloaded), pull the new value in unless
  // the user has unsaved local edits.
  React.useEffect(() => {
    if (initialValue !== lastSavedRef.current && value === lastSavedRef.current) {
      setValue(initialValue);
      lastSavedRef.current = initialValue;
    }
  }, [initialValue, value]);

  const handleSave = () => {
    if (value === lastSavedRef.current) return;
    lastSavedRef.current = value;
    updateNote.mutate({ note: value, existingMetadata });
  };

  return (
    <View className="mb-6">
      <Text className="mb-2 text-sm text-gray-400">Order notes</Text>
      <TextInput
        multiline
        numberOfLines={3}
        placeholder="Notes for this order…"
        placeholderTextColor="#b5b5b5"
        value={value}
        onChangeText={setValue}
        onBlur={handleSave}
        className="min-h-20 rounded-xl border border-gray-200 bg-white px-3 py-3 align-top"
        textAlignVertical="top"
      />
    </View>
  );
};

interface PromotionBadgeProps {
  onAddPromotion: (code: string) => void;
  isAddingPromotion: boolean;
}

const PromotionBadge: React.FC<PromotionBadgeProps> = ({ onAddPromotion, isAddingPromotion }) => {
  const [isDialogOpen, setIsDialogOpen] = React.useState(false);

  return (
    <>
      <Button
        onPress={() => setIsDialogOpen(true)}
        variant="outline"
        icon={<Tag size={16} />}
        className="mb-4 justify-between"
      >
        Add Promotion
      </Button>

      <Dialog visible={isDialogOpen} onClose={() => setIsDialogOpen(false)} title="Add Promotion Code">
        <Form
          schema={addPromotionFormSchema}
          onSubmit={(data, form) => {
            onAddPromotion(data.promotionCode);
            form.reset();
            setIsDialogOpen(false);
          }}
          className="gap-4"
        >
          <TextField
            placeholder="Enter promotion code"
            name="promotionCode"
            autoComplete="off"
            autoCorrect={false}
            autoCapitalize="characters"
            enterKeyHint="send"
            autoFocus
          />
          <View className="flex-row gap-2">
            <Button variant="outline" className="flex-1" onPress={() => setIsDialogOpen(false)}>
              Cancel
            </Button>
            <FormButton className="flex-1" isPending={isAddingPromotion}>
              Apply
            </FormButton>
          </View>
        </Form>
      </Dialog>
    </>
  );
};

const ItemSeparatorComponent = React.forwardRef<Animated.View>((props, ref) => (
  <Animated.View className="h-hairline bg-gray-200" ref={ref} />
));
ItemSeparatorComponent.displayName = 'ItemSeparatorComponent';

const CartSummaryHeader: React.FC<
  PromotionBadgeProps & {
    isLoading?: boolean;
    taxTotal: number;
    subtotal: number;
    discountTotal: number;
    currencyCode?: string;
    originalSubtotal: number;
    originalTaxTotal: number;
  }
> = ({
  onAddPromotion,
  isAddingPromotion,
  isLoading,
  taxTotal,
  subtotal,
  discountTotal,
  currencyCode,
  originalSubtotal,
  originalTaxTotal,
}) => {
  const hasAdjustments = originalSubtotal !== subtotal || discountTotal > 0;

  return (
    <Animated.View className="pb-4 pt-6">
      <PromotionBadge onAddPromotion={onAddPromotion} isAddingPromotion={isAddingPromotion} />
      <View className="gap-2">
        <View className="flex-row items-center justify-between">
          <Text className="text-sm text-gray-400">Taxes</Text>
          {isLoading ? (
            <View className="h-[17px] w-1/4 rounded-md bg-gray-200" />
          ) : (
            <View className="flex-row items-center gap-2">
              <Text className="text-sm text-gray-400">
                {taxTotal.toLocaleString('en-US', {
                  style: 'currency',
                  currency: currencyCode,
                  currencyDisplay: 'narrowSymbol',
                })}
              </Text>
              {hasAdjustments && originalTaxTotal !== taxTotal && (
                <Text className="text-sm text-gray-300 line-through">
                  {originalTaxTotal.toLocaleString('en-US', {
                    style: 'currency',
                    currency: currencyCode,
                    currencyDisplay: 'narrowSymbol',
                  })}
                </Text>
              )}
            </View>
          )}
        </View>
        <View className="flex-row items-center justify-between">
          <Text className="text-sm text-gray-400">Subtotal</Text>
          {isLoading ? (
            <View className="h-[17px] w-1/4 rounded-md bg-gray-200" />
          ) : (
            <View className="flex-row items-center gap-2">
              <Text className="text-sm text-gray-400">
                {subtotal.toLocaleString('en-US', {
                  style: 'currency',
                  currency: currencyCode,
                  currencyDisplay: 'narrowSymbol',
                })}
              </Text>
              {hasAdjustments && originalSubtotal !== subtotal && (
                <Text className="text-sm text-gray-300 line-through">
                  {originalSubtotal.toLocaleString('en-US', {
                    style: 'currency',
                    currency: currencyCode,
                    currencyDisplay: 'narrowSymbol',
                  })}
                </Text>
              )}
            </View>
          )}
        </View>
        {discountTotal > 0 && (
          <View className="flex-row justify-between">
            <Text className="text-sm text-gray-400">Discount</Text>
            {isLoading ? (
              <View className="h-[17px] w-1/4 rounded-md bg-gray-200" />
            ) : (
              <Text className="text-sm text-gray-400">
                {(discountTotal * -1)?.toLocaleString('en-US', {
                  style: 'currency',
                  currency: currencyCode,
                  currencyDisplay: 'narrowSymbol',
                })}
              </Text>
            )}
          </View>
        )}
      </View>
    </Animated.View>
  );
};

export default function CartScreen() {
  const settings = useSettings();
  const windowDimensions = useSafeAreaFrame();
  const draftOrder = useCurrentDraftOrder();
  const draftOrderPromotionCodes = React.useMemo(() => {
    const allCodes =
      draftOrder.data?.draft_order.items
        .flatMap((item) => item.adjustments?.map((adj) => adj.code))
        .filter((code) => typeof code === 'string') ?? [];
    return Array.from(new Set(allCodes));
  }, [draftOrder.data]);
  const addedPromotions = useDraftOrderPromotions(draftOrderPromotionCodes);

  // Calculate original prices (without adjustments)
  const originalSubtotal = React.useMemo(() => {
    return (
      draftOrder.data?.draft_order.items.reduce((sum, item) => {
        const priceToUse = item.compare_at_unit_price ?? item.unit_price;
        return sum + priceToUse * item.quantity;
      }, 0) ?? 0
    );
  }, [draftOrder.data]);

  const originalTaxTotal = React.useMemo(() => {
    if (!draftOrder.data) return 0;
    const taxRate = draftOrder.data.draft_order.tax_total / (draftOrder.data.draft_order.subtotal || 1);
    return Math.round(originalSubtotal * taxRate);
  }, [draftOrder.data, originalSubtotal]);
  const addPromotion = useAddPromotion();
  const removePromotion = useRemovePromotion();
  const cancelDraftOrder = useCancelDraftOrder();
  const updateDraftOrderItem = useUpdateDraftOrderItem();
  const isUpdatingDraftOrder = useIsMutating({ mutationKey: ['draft-order'], exact: false });
  const itemsListRef = React.useRef<FlashListRef<LineItemType>>(null);

  const [isDialogVisible, setIsDialogVisible] = React.useState(false);
  const [isCustomerWarningVisible, setIsCustomerWarningVisible] = React.useState(false);

  // Pickup and ship items need a real customer (to contact for pickup / shipping).
  // Surfaced while building the cart so the operator isn't blocked at payment.
  const orderNeedsCustomer = React.useMemo(() => {
    const buckets = bucketsFromOrder(draftOrder.data?.draft_order.metadata);
    return (
      draftOrder.data?.draft_order.items.some((item) => {
        const bucket = getBucket(item, itemEligibleBuckets(item), buckets);
        return bucket === 'pickup' || bucket === 'ship';
      }) ?? false
    );
  }, [draftOrder.data]);

  // A commission needs more than "some customer": it needs one the BUYER can
  // sign into, because the notes thread on the order is their only channel to
  // the artist for the whole multi-week build. The backend enforces this when
  // the draft order is converted — but on the till that conversion happens
  // AFTER the card is charged, so a refusal there is a refund in front of a
  // customer. Asking the same question here, while the cart is still being
  // built, is what stops anyone ever reaching it.
  const commissionState = React.useMemo(() => commissionCheckoutState(draftOrder.data?.draft_order), [draftOrder.data]);

  // Determine customer state for highlighting
  const isPosDefaultCustomer =
    !draftOrder.data?.draft_order.customer ||
    draftOrder.data?.draft_order.customer.email === DRAFT_ORDER_DEFAULT_CUSTOMER_EMAIL;

  const customerHighlight =
    commissionState.blocked || (orderNeedsCustomer && isPosDefaultCustomer)
      ? 'required'
      : orderNeedsCustomer || commissionState.hasCommission
        ? 'valid'
        : 'none';

  // Check if user can proceed to checkout.
  // ⚠ Ordinary sales are untouched: `commissionState.blocked` is false for any
  // order with no commission line, so stickers and prints keep the fast
  // shared-guest path exactly as before.
  const canCheckout = (!orderNeedsCustomer || !isPosDefaultCustomer) && !commissionState.blocked;

  const onItemRemove = React.useCallback(
    (item: AdminOrderLineItem) => {
      updateDraftOrderItem.mutate({ id: item.id, update: { quantity: 0 } });
      itemsListRef.current?.prepareForLayoutAnimationRender();
    },
    [updateDraftOrderItem],
  );

  const onPromotionRemove = React.useCallback(
    async (promotion: AdminPromotion) => {
      if (promotion.code) {
        await removePromotion.mutateAsync(promotion.code).catch(() => {});
        itemsListRef.current?.prepareForLayoutAnimationRender();
      }
    },
    [removePromotion],
  );

  const cartSummary = React.useMemo(
    () =>
      draftOrder.data ? (
        <CartSummaryHeader
          onAddPromotion={(code) => addPromotion.mutate(code)}
          isAddingPromotion={addPromotion.isPending}
          isLoading={draftOrder.isFetching || isUpdatingDraftOrder > 0}
          taxTotal={draftOrder.data.draft_order.tax_total}
          subtotal={draftOrder.data.draft_order.subtotal}
          discountTotal={draftOrder.data.draft_order.discount_total}
          currencyCode={draftOrder.data.draft_order.region?.currency_code || settings.data?.region?.currency_code}
          originalSubtotal={originalSubtotal}
          originalTaxTotal={originalTaxTotal}
        />
      ) : null,
    [
      addPromotion,
      draftOrder.data,
      draftOrder.isFetching,
      isUpdatingDraftOrder,
      settings.data?.region?.currency_code,
      originalSubtotal,
      originalTaxTotal,
    ],
  );

  const renderItem = React.useCallback<ListRenderItem<LineItemType>>(
    ({ item }) =>
      item.__type__ === 'bucket_header' ? (
        <View className={clx('flex-row items-center border-l-4 pb-1 pl-3 pt-2', BUCKET_META[item.bucket].barClass)}>
          <Text className={clx('text-sm font-semibold uppercase', BUCKET_META[item.bucket].labelClass)}>
            {BUCKET_META[item.bucket].label}
          </Text>
        </View>
      ) : item.__type__ === 'draft_order_item' ? (
        <DraftOrderItem item={item} onRemove={onItemRemove} />
      ) : item.__type__ === 'promotion' ? (
        <PromotionItem
          item={item}
          onRemove={onPromotionRemove}
          currencyCode={draftOrder.data?.draft_order.region?.currency_code || settings.data?.region?.currency_code}
        />
      ) : item.__type__ === 'footer' ? (
        <Animated.View layout={SequencedTransition}>
          {draftOrder.data && (windowDimensions.width < 768 || windowDimensions.height < 900) ? cartSummary : null}
        </Animated.View>
      ) : null,
    [
      cartSummary,
      draftOrder.data,
      onItemRemove,
      onPromotionRemove,
      settings.data?.region?.currency_code,
      windowDimensions.height,
      windowDimensions.width,
    ],
  );

  const keyExtractor = React.useCallback((item: LineItemType) => item.id, []);
  const getItemType = React.useCallback((item: LineItemType) => item.__type__, []);

  if (draftOrder.isLoading || settings.isLoading) {
    return <CartSkeleton />;
  }

  if (draftOrder.isError || settings.isError) {
    return (
      <Layout className="pb-6">
        <Text className="text-4xl">Cart</Text>
        <View className="flex-1 items-center  justify-center gap-2">
          <InfoBanner variant="ghost" colorScheme="error" className="w-40">
            Failed to load cart
          </InfoBanner>
          <View className="flex-row gap-2">
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
            <Button
              onPress={() => {
                cancelDraftOrder.mutate();
              }}
              isPending={cancelDraftOrder.isPending}
              variant="outline"
            >
              Reset Cart
            </Button>
          </View>
        </View>
      </Layout>
    );
  }

  if (!draftOrder.data?.draft_order || !draftOrder.data?.draft_order.items.length) {
    return (
      <Layout className="pb-6">
        <Text className="text-4xl">Cart</Text>
        <View className="flex-1 items-center justify-center gap-1">
          <ShoppingCart size={24} />
          <Text className="text-xl">Your cart is empty</Text>
          <Text className="text-gray-300">Add products to begin</Text>
        </View>
        <View className="flex-row gap-2">
          <Button
            variant="outline"
            className="flex-1"
            onPress={() => {
              cancelDraftOrder.mutate();
            }}
            isPending={cancelDraftOrder.isPending}
            disabled={!draftOrder.data?.draft_order}
          >
            Cancel Cart
          </Button>
          <Button className="flex-1" disabled>
            Checkout
          </Button>
        </View>
      </Layout>
    );
  }

  const itemBuckets = bucketsFromOrder(draftOrder.data.draft_order.metadata);
  const groupedItems: LineItemType[] = [];
  for (const bucket of FULFILLMENT_BUCKETS) {
    const itemsInBucket = draftOrder.data.draft_order.items.filter(
      (item) => getBucket(item, itemEligibleBuckets(item), itemBuckets) === bucket,
    );
    if (itemsInBucket.length === 0) continue;
    groupedItems.push({ id: `bucket:${bucket}`, __type__: 'bucket_header', bucket });
    for (const item of itemsInBucket) {
      groupedItems.push({ ...item, __type__: 'draft_order_item' as const });
    }
  }

  const items = [
    ...groupedItems,
    ...(addedPromotions.data?.promotions ?? []).map(
      (promotion) =>
        ({
          ...promotion,
          __type__: 'promotion' as const,
          discount_amount:
            draftOrder.data?.draft_order.items
              .flatMap((item) => item.adjustments?.filter((adj) => adj.promotion_id === promotion.id))
              .reduce((acc, adj) => acc + (adj?.amount || 0), 0) || 0,
        }) satisfies TPromotionItem,
    ),
    { id: 'footer', __type__: 'footer' as const },
  ] satisfies LineItemType[];

  return (
    <>
      <Layout className="pb-6">
        <Text className="mb-6 text-4xl">Cart</Text>
        <CustomerBadge customer={draftOrder.data.draft_order.customer} highlight={customerHighlight} />
        <FlashList
          ref={itemsListRef}
          data={items}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          getItemType={getItemType}
          ItemSeparatorComponent={ItemSeparatorComponent}
          CellRendererComponent={ItemCell}
          showsVerticalScrollIndicator={false}
          keyboardDismissMode="on-drag"
        />
        <View>
          {windowDimensions.width >= 768 && windowDimensions.height >= 900 && cartSummary}
          <View className="mb-4 h-hairline bg-gray-200" />
          <View className="mb-6 flex-row items-center justify-between">
            <Text className="text-lg">Total</Text>
            {draftOrder.isFetching || isUpdatingDraftOrder > 0 ? (
              <View className="h-7 w-1/4 rounded-md bg-gray-200" />
            ) : (
              <View className="flex-row items-center gap-2">
                <Text className="text-lg">
                  {draftOrder.data.draft_order.total?.toLocaleString('en-US', {
                    style: 'currency',
                    currency: draftOrder.data.draft_order.region?.currency_code || settings.data?.region?.currency_code,
                    currencyDisplay: 'narrowSymbol',
                  })}
                </Text>
                {(originalSubtotal !== draftOrder.data.draft_order.subtotal ||
                  draftOrder.data.draft_order.discount_total > 0) && (
                  <Text className="text-base text-gray-300 line-through">
                    {(originalSubtotal + originalTaxTotal)?.toLocaleString('en-US', {
                      style: 'currency',
                      currency:
                        draftOrder.data.draft_order.region?.currency_code || settings.data?.region?.currency_code,
                      currencyDisplay: 'narrowSymbol',
                    })}
                  </Text>
                )}
              </View>
            )}
          </View>

          <OrderNoteInput
            initialValue={
              typeof draftOrder.data.draft_order.metadata?.note === 'string'
                ? (draftOrder.data.draft_order.metadata.note as string)
                : ''
            }
            existingMetadata={draftOrder.data.draft_order.metadata}
          />

          <View className="flex-row gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onPress={() => setIsDialogVisible(true)}
              isPending={cancelDraftOrder.isPending}
              disabled={draftOrder.isFetching || isUpdatingDraftOrder > 0}
            >
              Cancel Cart
            </Button>
            <Button
              className="flex-1"
              disabled={
                draftOrder.data.draft_order.items.length === 0 || draftOrder.isFetching || isUpdatingDraftOrder > 0
              }
              onPress={() => {
                if (!draftOrder.data?.draft_order.id) {
                  return;
                }
                if (!canCheckout) {
                  setIsCustomerWarningVisible(true);
                  return;
                }
                router.push({
                  pathname: '/checkout/[draftOrderId]',
                  params: {
                    draftOrderId: draftOrder.data.draft_order.id,
                  },
                });
              }}
            >
              Checkout
            </Button>
          </View>
        </View>
      </Layout>

      <Prompt
        onSubmit={() => {
          cancelDraftOrder.mutate(undefined, {
            onSettled: () => {
              setIsDialogVisible(false);
            },
          });
        }}
        onClose={() => setIsDialogVisible(false)}
        title="Are you sure you want to cancel the cart?"
        visible={isDialogVisible}
        showCloseButton={false}
        dismissOnOverlayPress={false}
      />

      <Dialog
        visible={isCustomerWarningVisible}
        onClose={() => setIsCustomerWarningVisible(false)}
        title={commissionState.blocked ? 'Customer account required' : 'Customer required'}
        dismissOnOverlayPress
      >
        <View className="gap-4">
          {commissionState.blocked ? (
            <>
              <Text className="text-gray-400">
                {commissionState.titles.join(', ')} is made to order and worked on with the customer — reference photos,
                progress updates and approvals all live on their order, and that conversation is only reachable from an
                account they can sign into.
              </Text>
              <Text className="text-gray-400">
                Add the customer with their own email address and tick “Set up an account”. They will get a link to
                choose a password.
              </Text>
              <Button
                onPress={() => {
                  setIsCustomerWarningVisible(false);
                  router.push('/customer-lookup');
                }}
              >
                Add Customer
              </Button>
            </>
          ) : (
            <>
              <Text className="text-gray-400">
                Pickup and shipped items need a customer to contact. Add a customer, then check out.
              </Text>
              <Button onPress={() => setIsCustomerWarningVisible(false)}>OK</Button>
            </>
          )}
        </View>
      </Dialog>
    </>
  );
}
