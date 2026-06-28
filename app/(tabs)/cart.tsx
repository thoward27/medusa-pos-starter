import { useCustomers } from '@/api/hooks/customers';
import {
  DRAFT_ORDER_DEFAULT_CUSTOMER_EMAIL,
  useAddPromotion,
  useCancelDraftOrder,
  useCurrentDraftOrder,
  useDraftOrderPromotions,
  useRemovePromotion,
  useSwapLineItemVariant,
  useUpdateDraftOrderCustomer,
  useUpdateDraftOrderItem,
  useUpdateDraftOrderNote,
} from '@/api/hooks/draft-orders';
import { Form } from '@/components/form/Form';
import { FormButton } from '@/components/form/FormButton';
import { TextField } from '@/components/form/TextField';
import { ChevronDown } from '@/components/icons/chevron-down';
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
import { Checkbox } from '@/components/ui/Checkbox';
import { Dialog } from '@/components/ui/Dialog';
import { Layout } from '@/components/ui/Layout';
import { Prompt } from '@/components/ui/Prompt';
import { QuantityPicker } from '@/components/ui/QuantityPicker';
import { Text } from '@/components/ui/Text';
import { clx } from '@/utils/clx';
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
  | (AdminOrderLineItem & { __type__: 'draft_order_item' })
  | TPromotionItem;

const ItemCell = React.forwardRef<Animated.View>((props, ref) => {
  return <Animated.View {...props} layout={SequencedTransition} exiting={SlideOutLeft} ref={ref} />;
});
ItemCell.displayName = 'ItemCell';

type VariantWithShipping = { id: string; requires_shipping?: boolean | null };

const DraftOrderItem: React.FC<{ item: AdminOrderLineItem; onRemove?: (item: AdminOrderLineItem) => void }> = ({
  item,
  onRemove,
}) => {
  const settings = useSettings();
  const draftOrder = useCurrentDraftOrder();
  const updateDraftOrderItem = useUpdateDraftOrderItem();
  const swapLineItemVariant = useSwapLineItemVariant();
  const thumbnail = item.thumbnail || item.product?.thumbnail || item.product?.images?.[0]?.url;
  const [isPriceEditorVisible, setIsPriceEditorVisible] = React.useState(false);

  const currencyCode = draftOrder.data?.draft_order.region?.currency_code || settings.data?.region?.currency_code;
  const hasCustomPrice = item.compare_at_unit_price != null && item.compare_at_unit_price !== item.unit_price;

  // The product's other variants — used to find a shipping/non-shipping twin to swap to.
  const productVariants = (item.product?.variants ?? []) as VariantWithShipping[];
  const shippingTwin = productVariants.find(
    (v) => v.id !== item.variant_id && Boolean(v.requires_shipping) !== item.requires_shipping,
  );
  const canToggleShipping = !!shippingTwin && !swapLineItemVariant.isPending;

  console.log(
    `Item: ${item.id}, Quantity: ${item.quantity}, Price: ${item.unit_price}, Compare At Price: ${item.compare_at_unit_price}`,
  );

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
        <View className="flex-row gap-4 bg-white py-6">
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
            <Checkbox
              label="Requires shipping"
              checked={item.requires_shipping}
              disabled={!canToggleShipping}
              onCheckedChange={() => {
                if (!shippingTwin) return;
                swapLineItemVariant.mutate({
                  itemId: item.id,
                  newVariantId: shippingTwin.id,
                  quantity: item.quantity,
                  unit_price: item.unit_price,
                  compare_at_unit_price: item.compare_at_unit_price,
                });
              }}
            />
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

  // Derive shipping requirement from items themselves — any item with requires_shipping
  // means the order needs a real customer (for the shipping address).
  const orderRequiresShipping = React.useMemo(
    () => draftOrder.data?.draft_order.items.some((item) => item.requires_shipping) ?? false,
    [draftOrder.data],
  );

  // Determine customer state for highlighting
  const isPosDefaultCustomer =
    !draftOrder.data?.draft_order.customer ||
    draftOrder.data?.draft_order.customer.email === DRAFT_ORDER_DEFAULT_CUSTOMER_EMAIL;

  const customerHighlight = orderRequiresShipping ? (isPosDefaultCustomer ? 'required' : 'valid') : 'none';

  // Check if user can proceed to checkout
  const canCheckout = !orderRequiresShipping || !isPosDefaultCustomer;

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
      item.__type__ === 'draft_order_item' ? (
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

  const items = [
    ...draftOrder.data.draft_order.items.map((item) => ({
      ...item,
      __type__: 'draft_order_item' as const,
    })),
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

          {orderRequiresShipping && isPosDefaultCustomer && (
            <InfoBanner colorScheme="warning" className="mb-6">
              Please select a customer before proceeding. Orders with shipping items must have customer information.
            </InfoBanner>
          )}

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
                draftOrder.data.draft_order.items.length === 0 ||
                draftOrder.isFetching ||
                isUpdatingDraftOrder > 0 ||
                !canCheckout
              }
              onPress={() => {
                if (!draftOrder.data?.draft_order.id) {
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
    </>
  );
}
