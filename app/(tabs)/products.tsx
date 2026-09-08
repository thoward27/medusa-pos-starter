import { useProductCategories } from '@/api/hooks/product-categories';
import { useProducts } from '@/api/hooks/products';
import { CircleAlert } from '@/components/icons/circle-alert';
import { SearchInput } from '@/components/SearchInput';
import { Layout } from '@/components/ui/Layout';
import { Text } from '@/components/ui/Text';
import { useSettings } from '@/contexts/settings';
import { useBreakpointValue } from '@/hooks/useBreakpointValue';
import { clx } from '@/utils/clx';
import { showErrorToast } from '@/utils/errors';
import { groupProductsIntoSections, ProductRow, ProductSection } from '@/utils/group-products';
import { stableCacheKey } from '@/utils/images';
import { AdminProduct } from '@medusajs/types';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import * as React from 'react';
import { RefreshControl, SectionList, TouchableOpacity, View } from 'react-native';

// Catalog is small (< ~500), so load it all in one request and group by category
// client-side. If the catalog ever outgrows this, revisit (server-side paging
// can't pre-group when a product belongs to multiple categories).
const CATALOG_LIMIT = 500;

const ProductPlaceholder: React.FC<{ index: number; numColumns: number }> = ({ index, numColumns }) => {
  return (
    <View
      className={clx('flex-1 px-1', {
        'pl-0': index % numColumns === 0,
        'pr-0': (index + 1) % numColumns === 0,
      })}
    >
      <View className="flex-1 gap-4">
        <View className="aspect-square overflow-hidden rounded-lg bg-gray-200" />
        <View>
          <View className="mb-1 h-4 rounded-md bg-gray-200" />
          <View className="mb-1 h-4 w-1/3 rounded-md bg-gray-200" />
        </View>
      </View>
    </View>
  );
};

const ProductsSkeleton: React.FC<{ numColumns: number }> = ({ numColumns }) => {
  return (
    <View className="gap-6">
      {Array.from({ length: 4 }, (_, row) => (
        <View key={row} className="flex-row">
          {Array.from({ length: numColumns }, (_, col) => (
            <ProductPlaceholder key={col} index={col} numColumns={numColumns} />
          ))}
        </View>
      ))}
    </View>
  );
};

const ProductCard: React.FC<{
  product: AdminProduct;
  regionCurrencyCode?: string;
  onPress: (product: AdminProduct) => void;
}> = ({ product, regionCurrencyCode, onPress }) => {
  const thumbnail = product.thumbnail || product.images?.[0]?.url;
  const variantPrices = (product.variants ?? [])
    .flatMap((variant) => variant.prices?.filter((price) => price.currency_code === regionCurrencyCode))
    .filter((price) => typeof price !== 'undefined');
  const currencyCode = variantPrices[0]?.currency_code ?? undefined;
  const amounts = variantPrices.map((price) => price.amount);
  const minPrice = amounts.length ? Math.min(...amounts) : undefined;
  const maxPrice = amounts.length ? Math.max(...amounts) : undefined;

  return (
    <TouchableOpacity className="flex w-full gap-4" onPress={() => onPress(product)} activeOpacity={0.7}>
      <View
        className="aspect-square overflow-hidden rounded-lg bg-gray-200"
        testID={`product-handle_${product.handle}_image`}
      >
        {thumbnail && (
          <Image
            source={{ uri: thumbnail, cacheKey: stableCacheKey(thumbnail) }}
            cachePolicy="memory-disk"
            recyclingKey={product.id}
            contentFit="cover"
            style={{ width: '100%', height: '100%' }}
          />
        )}
      </View>
      <View>
        <Text className="mb-1 font-light">{product.title}</Text>
        {/* TODO: display discounted price */}
        <Text className="font-bold">
          {amounts.length === 0 || (typeof minPrice !== 'number' && typeof maxPrice !== 'number')
            ? 'No price available'
            : minPrice === maxPrice
              ? minPrice?.toLocaleString('en-US', {
                  style: 'currency',
                  currency: currencyCode,
                  currencyDisplay: 'narrowSymbol',
                })
              : `${minPrice?.toLocaleString('en-US', {
                  style: 'currency',
                  currency: currencyCode,
                  currencyDisplay: 'narrowSymbol',
                })} — ${maxPrice?.toLocaleString('en-US', {
                  style: 'currency',
                  currency: currencyCode,
                  currencyDisplay: 'narrowSymbol',
                })}`}
        </Text>
      </View>
    </TouchableOpacity>
  );
};

export default function ProductsScreen() {
  const settings = useSettings();
  const numColumns = useBreakpointValue({ base: 2, md: 3, xl: 4 });
  const [searchQuery, setSearchQuery] = React.useState('');
  const productsQuery = useProducts(
    {
      q: searchQuery ? searchQuery : undefined,
      sales_channel_id: settings.data?.sales_channel?.id ?? undefined,
      fields: '+variants.prices.*,+categories.id,+categories.name',
    },
    CATALOG_LIMIT,
  );
  const categoriesQuery = useProductCategories();

  const regionCurrencyCode = settings.data?.region?.currency_code;

  const handleProductPress = React.useCallback((product: AdminProduct) => {
    router.push({
      pathname: '/product-details',
      params: { productId: product.id, productName: product.title },
    });
  }, []);

  const products = React.useMemo(
    () => productsQuery.data?.pages.flatMap((page) => page.products) ?? [],
    [productsQuery.data],
  );

  const categories = React.useMemo(() => categoriesQuery.data?.product_categories ?? [], [categoriesQuery.data]);

  const sections = React.useMemo(
    () => groupProductsIntoSections(products, categories, numColumns),
    [products, categories, numColumns],
  );

  const isInitialLoading = productsQuery.isLoading || categoriesQuery.isLoading;
  const isRefreshing = productsQuery.isRefetching || categoriesQuery.isRefetching;

  // Pull-to-refresh fully reloads the grid: products *and* categories, so stale
  // breadcrumbs/groupings clear too (categories drive the headers).
  const handleRefresh = React.useCallback(() => {
    productsQuery.refetch();
    categoriesQuery.refetch();
  }, [productsQuery, categoriesQuery]);

  const renderSectionHeader = React.useCallback(
    ({ section }: { section: ProductSection }) => (
      <View className="bg-white pb-2 pt-4">
        <Text className="text-lg font-semibold">{section.title}</Text>
      </View>
    ),
    [],
  );

  const renderItem = React.useCallback(
    ({ item }: { item: ProductRow }) => (
      <View className="flex-row pb-6">
        {Array.from({ length: numColumns }, (_, position) => {
          const product = item.products[position];
          return (
            <View
              key={position}
              className={clx('flex-1 px-1', {
                'pl-0': position === 0,
                'pr-0': position === numColumns - 1,
              })}
            >
              {product ? (
                <ProductCard product={product} regionCurrencyCode={regionCurrencyCode} onPress={handleProductPress} />
              ) : null}
            </View>
          );
        })}
      </View>
    ),
    [handleProductPress, numColumns, regionCurrencyCode],
  );

  React.useEffect(() => {
    if (productsQuery.isError) {
      showErrorToast(productsQuery.error);
    }
  }, [productsQuery.error, productsQuery.isError]);

  React.useEffect(() => {
    if (categoriesQuery.isError) {
      showErrorToast(categoriesQuery.error);
    }
  }, [categoriesQuery.error, categoriesQuery.isError]);

  return (
    <Layout className="gap-6">
      <SearchInput value={searchQuery} onChangeText={setSearchQuery} placeholder="Search products..." />

      <SectionList
        sections={isInitialLoading ? [] : sections}
        renderItem={renderItem}
        renderSectionHeader={renderSectionHeader}
        keyExtractor={(item) => item.id}
        extraData={regionCurrencyCode}
        stickySectionHeadersEnabled
        automaticallyAdjustKeyboardInsets
        // progressViewOffset keeps the spinner clear of the sticky section header.
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} progressViewOffset={56} />}
        ListEmptyComponent={
          isInitialLoading ? (
            <ProductsSkeleton numColumns={numColumns} />
          ) : (
            <View className="mt-60 flex-1 items-center">
              <CircleAlert size={24} />
              <Text className="mt-2 text-center text-xl">No products match{'\n'}the search</Text>
            </View>
          )
        }
        showsVerticalScrollIndicator={false}
        keyboardDismissMode="on-drag"
      />
    </Layout>
  );
}
