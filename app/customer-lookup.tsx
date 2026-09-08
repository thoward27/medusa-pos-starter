import { useCreateCustomer, useCustomers, useProvisionCustomerAccount } from '@/api/hooks/customers';
import { useCurrentDraftOrder, useUpdateDraftOrderCustomer } from '@/api/hooks/draft-orders';
import { Form } from '@/components/form/Form';
import { FormButton } from '@/components/form/FormButton';
import { SwitchField } from '@/components/form/SwitchField';
import { TextField } from '@/components/form/TextField';
import { CircleAlert } from '@/components/icons/circle-alert';
import { InfoBanner } from '@/components/InfoBanner';
import { SearchInput } from '@/components/SearchInput';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Text } from '@/components/ui/Text';
import { clx } from '@/utils/clx';
import { isPlaceholderEmail, orderHasCommission } from '@/utils/commissions';
import { formatPhoneNumber } from '@/utils/phone';
import { AdminCustomer, AdminCustomerFilters } from '@medusajs/types';
import { router, useLocalSearchParams } from 'expo-router';
import * as React from 'react';
import { useFormContext } from 'react-hook-form';
import { FlatList, TouchableOpacity, View } from 'react-native';
import { z } from 'zod/v4';

/**
 * A stand-in address so a walk-in can be recorded without one.
 *
 * ⚠ It is on the STORE's domain, so mail sent to it reaches the store and never
 * the customer. That is fine for a sticker sale — nothing is ever sent — and
 * unusable for anything that has to reach the buyer later. A commission cannot
 * be sold against one: the backend refuses it, and the account switch below is
 * forced on (and a real address required) whenever the order holds a
 * commission line. See `utils/commissions.ts`.
 */
const generateDefaultEmail = (phone: string) => {
  const digits = phone.replace(/\D/g, '');
  return digits ? `pos-customer+${digits}@taylormade.cc` : '';
};

const customerFormSchema = z.object({
  email: z.email('Please enter a valid email address').optional().or(z.literal('')),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  phone: z.string().optional(),
  // Whether to give this customer a sign-in-able account and email them a link
  // to set a password. Optional for ordinary sales, FORCED ON for commissions —
  // see `commissionFormSchema`.
  create_account: z.boolean().optional(),
});

/**
 * The stricter schema used while the order contains a commission.
 *
 * A commission buyer must be reachable: their only channel to the artist over a
 * multi-week build is the notes thread on their order, and that thread needs an
 * account they can sign into. So the email stops being optional and the
 * store-domain placeholder (`pos-customer+<digits>@…`) stops being acceptable —
 * a set-password link sent there reaches the store, not the buyer.
 *
 * Validating it here rather than only on the server is what keeps the refusal
 * off the payment path: on the till the card is charged BEFORE the draft order
 * is converted, so a server-side refusal at conversion is a refund in front of
 * a customer.
 */
const commissionCustomerFormSchema = customerFormSchema.extend({
  email: z
    .email('A commission needs the customer\u2019s own email address')
    .refine((value) => !isPlaceholderEmail(value), {
      message: 'Use the customer\u2019s own address \u2014 they need to receive the link to set a password',
    }),
});

// Small debounce so live match lookups don't fire on every keystroke.
function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

const looksLikePhone = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return false;
  const digits = trimmed.replace(/\D/g, '');
  return digits.length >= 3 && /^[\d\s()+.\-]+$/.test(trimmed);
};

// Route a free-text search query into create-form fields: digit-heavy input is
// treated as a phone number, otherwise the first token is the first name and
// the rest is the last name.
const parseQueryToFields = (query: string): { first_name?: string; last_name?: string; phone?: string } => {
  const trimmed = query.trim();
  if (!trimmed) return {};
  if (looksLikePhone(trimmed)) return { phone: trimmed };
  const [first, ...rest] = trimmed.split(/\s+/);
  return { first_name: first, last_name: rest.join(' ') || undefined };
};

// ---------------------------------------------------------------------------
// Customer search strategy
//
// Medusa's customer `q` searches name + email only — there is no phone-column
// search or `phone` filter in the admin API today. Until the backend adds one
// (see docs/backend-phone-search-prompt.md), phone search relies on the digits
// embedded in POS-generated emails (pos-customer+<digits>@...), which `q` can
// match for phone-only POS customers.
//
// When the backend gains real phone search, flip PHONE_SEARCH_STRATEGY to match
// whatever it implements. That is the ONLY change needed in this app — every
// search path (the main list and the in-form duplicate matches) builds its
// params through buildCustomerSearchParams().
// ---------------------------------------------------------------------------
type PhoneSearchStrategy =
  // No backend support: match phone digits embedded in POS-generated emails.
  | 'embedded-email'
  // Backend's `q` was extended to also search the phone column.
  | 'q-includes-phone'
  // Backend exposes a dedicated phone filter supporting partial match.
  | 'phone-filter';

const PHONE_SEARCH_STRATEGY: PhoneSearchStrategy = 'embedded-email';

type CustomerSearchParams = Omit<AdminCustomerFilters, 'limit' | 'offset'>;

// Turn raw search-box text into Medusa customer filter params, routing by intent
// (phone vs. name/email). Returns undefined for empty input.
const buildCustomerSearchParams = (input: string): CustomerSearchParams | undefined => {
  const trimmed = input.trim();
  if (!trimmed) return undefined;

  if (looksLikePhone(trimmed)) {
    const digits = trimmed.replace(/\D/g, '');
    if (!digits) return undefined;
    switch (PHONE_SEARCH_STRATEGY as PhoneSearchStrategy) {
      case 'phone-filter':
        // Confirm the exact operator the backend implements ($ilike vs $eq) when
        // wiring this up — see the backend prompt.
        return { phone: { $ilike: `%${digits}%` } } as unknown as CustomerSearchParams;
      case 'q-includes-phone':
        return { q: digits };
      case 'embedded-email':
      default:
        return { q: digits };
    }
  }

  // Name or email — Medusa's `q` already covers both.
  return { q: trimmed };
};

const EmailFieldWithPhonePlaceholder: React.FC = () => {
  const { watch } = useFormContext();
  const phone = watch('phone');
  const defaultEmail = generateDefaultEmail(phone || '');

  return (
    <TextField
      name="email"
      placeholder={defaultEmail || 'Email Address'}
      autoComplete="off"
      autoCapitalize="none"
      autoCorrect={false}
      spellCheck={false}
      inputMode="email"
    />
  );
};

// Live "possible duplicates" shown inside the create form. Watches the fields
// the operator is typing and surfaces existing customers that may be the same
// person, so they can pick the existing record instead of creating a duplicate.
const DuplicateMatches: React.FC<{ onSelectExisting: (customer: AdminCustomer) => void }> = ({ onSelectExisting }) => {
  const { watch } = useFormContext();
  const firstName = watch('first_name');
  const lastName = watch('last_name');
  const phone = watch('phone');
  const email = watch('email');

  // Prefer the phone number (most unique); otherwise fall back to name/email
  // text. Routing/normalization is centralized in buildCustomerSearchParams.
  const rawInput = React.useMemo(() => {
    const digits = (phone || '').replace(/\D/g, '');
    if (digits.length >= 4) return phone as string;
    return [firstName, lastName, email].filter(Boolean).join(' ').trim();
  }, [firstName, lastName, phone, email]);

  const debouncedInput = useDebouncedValue(rawInput, 300);
  const searchParams = React.useMemo(() => buildCustomerSearchParams(debouncedInput), [debouncedInput]);
  const enabled = debouncedInput.trim().length >= 3 && !!searchParams;

  const matchesQuery = useCustomers(searchParams ? { ...searchParams, order: 'first_name' } : undefined, 5, {
    enabled,
  });
  const matches = React.useMemo(
    () => (matchesQuery.data?.pages.flatMap((page) => page.customers) ?? []).slice(0, 5),
    [matchesQuery.data],
  );

  if (!enabled || matches.length === 0) return null;

  return (
    <View className="gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3">
      <Text className="text-sm font-medium text-amber-900">
        {matches.length === 1 ? '1 existing customer may match' : `${matches.length} existing customers may match`}
      </Text>
      {matches.map((customer) => {
        const name = [customer.first_name, customer.last_name].filter(Boolean).join(' ');
        const detail = customer.email?.includes('@taylormade.cc') ? customer.phone : customer.email;
        return (
          <TouchableOpacity
            key={customer.id}
            className="flex-row items-center justify-between gap-2 rounded-lg bg-white px-3 py-2"
            onPress={() => onSelectExisting(customer)}
          >
            <Text className="flex-1" numberOfLines={1}>
              {name || detail}
            </Text>
            {name && detail ? (
              <Text className="text-gray-400" numberOfLines={1}>
                {detail}
              </Text>
            ) : null}
          </TouchableOpacity>
        );
      })}
      <Text className="text-2xs text-amber-700">Tap a customer to use them instead of creating a duplicate.</Text>
    </View>
  );
};

const AddOrCreateCustomerButton: React.FC<{
  query: string;
  onResolved: (customer: AdminCustomer) => void;
}> = ({ query, onResolved }) => {
  const [isOpen, setIsOpen] = React.useState(false);
  const createCustomer = useCreateCustomer();
  const provisionAccount = useProvisionCustomerAccount();
  const draftOrder = useCurrentDraftOrder();

  // A commission in the cart changes what "add a customer" has to produce: not
  // a record of who someone is, but an account they can sign into. The switch
  // below is forced on and the email becomes required.
  const requiresAccount = orderHasCommission(draftOrder.data?.draft_order);

  const trimmedQuery = query.trim();
  // Pre-fill the form from whatever the operator already typed in the search box.
  const defaultValues = React.useMemo(
    () => ({ ...parseQueryToFields(query), email: '', create_account: requiresAccount }),
    [query, requiresAccount],
  );

  return (
    <>
      <Button
        variant="outline"
        onPress={() => {
          setIsOpen(true);
        }}
      >
        {trimmedQuery ? `Create “${trimmedQuery}”` : 'Add New Customer'}
      </Button>

      <Dialog
        visible={isOpen}
        title="New Customer"
        onClose={() => setIsOpen(false)}
        dismissOnOverlayPress={true}
        contentClassName="flex-shrink"
      >
        {isOpen && (
          <Form
            schema={requiresAccount ? commissionCustomerFormSchema : customerFormSchema}
            defaultValues={defaultValues}
            onSubmit={(data, form) => {
              const email = data.email || generateDefaultEmail(data.phone || '');
              if (!email) return;

              const finish = (customer: AdminCustomer) => {
                onResolved(customer);
                setIsOpen(false);
                form.reset();
              };

              // ── The account path ──────────────────────────────────────────
              //
              // ONE backend call does all of it: creates (or upgrades) the
              // customer, provisions the auth identity, and sends the
              // set-password email. Deliberately not three calls from here —
              // at a show, a sequence that fails partway leaves a commission
              // attached to a customer who cannot sign in, which is the bug
              // this exists to fix, and the operator sees nothing wrong.
              //
              // It is also idempotent, so a retry after a flaky tap is safe.
              if (data.create_account || requiresAccount) {
                provisionAccount.mutate(
                  {
                    email,
                    first_name: data.first_name,
                    last_name: data.last_name,
                    phone: data.phone,
                    provisioned_via: 'pos',
                  },
                  {
                    onSuccess: (res) => {
                      // The provisioning endpoint answers with ids, not a full
                      // customer, so shape one for the caller. `has_account` is
                      // true by construction — the call does not return success
                      // without it.
                      finish({
                        id: res.customer_id,
                        email: res.email,
                        first_name: data.first_name ?? null,
                        last_name: data.last_name ?? null,
                        phone: data.phone ?? null,
                        has_account: true,
                      } as AdminCustomer);
                    },
                  },
                );
                return;
              }

              // ── The ordinary path, unchanged ──────────────────────────────
              // Stickers, prints and originals keep the fast flow: a customer
              // record, no account, no email, no extra taps.
              createCustomer.mutate(
                { first_name: data.first_name, last_name: data.last_name, phone: data.phone, email },
                {
                  onSuccess: (res) => finish(res.customer),
                },
              );
            }}
          >
            <TextField name="first_name" placeholder="First Name" autoComplete="off" autoCapitalize="words" />
            <TextField name="last_name" placeholder="Last Name" autoComplete="off" autoCapitalize="words" />
            <TextField
              name="phone"
              placeholder="Phone Number"
              keyboardType="phone-pad"
              inputMode="tel"
              textContentType="telephoneNumber"
              autoComplete="tel"
              autoCapitalize="none"
              formatValue={formatPhoneNumber}
            />
            <EmailFieldWithPhonePlaceholder />
            <SwitchField
              name="create_account"
              label="Set up an account"
              description={
                requiresAccount
                  ? 'Required for a commission — the customer gets a link to set a password, and their order thread with the artist lives behind it.'
                  : 'Emails the customer a link to set a password so they can see their order online.'
              }
              disabled={requiresAccount}
            />
            <DuplicateMatches
              onSelectExisting={(customer) => {
                onResolved(customer);
                setIsOpen(false);
              }}
            />
            <FormButton>{requiresAccount ? 'Create Customer & Account' : 'Create Customer'}</FormButton>
          </Form>
        )}
      </Dialog>
    </>
  );
};

const isPlaceholderProduct = (
  product: AdminCustomer | { id: `placeholder_${string}` },
): product is { id: `placeholder_${string}` } => {
  return typeof product.id === 'string' && product.id.startsWith('placeholder_');
};

const CustomerListPlaceholder: React.FC = () => {
  return (
    <View className="flex-row items-center justify-between gap-4 px-4 py-3">
      <View className="h-[17px] w-1/3 rounded-md bg-gray-200" />
      <View className="h-[17px] w-1/3 rounded-md bg-gray-200" />
    </View>
  );
};

const CustomersList: React.FC<{
  searchParams?: CustomerSearchParams;
  selectedCustomerId?: string;
  onCustomerSelect: (customer: AdminCustomer) => void;
}> = ({ searchParams, selectedCustomerId, onCustomerSelect }) => {
  const customersQuery = useCustomers({
    ...searchParams,
    order: 'first_name',
  });
  const isSearching = !!searchParams;

  const renderCustomer = React.useCallback(
    ({ item }: { item: AdminCustomer | { id: `placeholder_${string}` } }) => {
      if (isPlaceholderProduct(item)) {
        return <CustomerListPlaceholder />;
      }

      const customerName = [item.first_name, item.last_name].filter(Boolean).join(' ');

      return (
        <TouchableOpacity
          className={clx('flex-row items-center justify-between gap-4 px-4 py-3', {
            'bg-black': selectedCustomerId === item.id,
          })}
          onPress={() => onCustomerSelect(item)}
        >
          {customerName.length > 0 && (
            <Text
              className={clx({
                'text-white': selectedCustomerId === item.id,
              })}
            >
              {customerName}
            </Text>
          )}
          <Text
            className={clx(
              customerName.length > 0
                ? {
                    'text-gray-300': true,
                    'text-gray-400': selectedCustomerId === item.id,
                  }
                : {
                    'text-white': selectedCustomerId === item.id,
                  },
            )}
          >
            {item.email?.includes('@taylormade.cc') ? item.phone : item.email}
          </Text>
        </TouchableOpacity>
      );
    },
    [onCustomerSelect, selectedCustomerId],
  );

  const data = React.useMemo(() => {
    if (customersQuery.isLoading) {
      return Array.from({ length: 8 }, (_, index) => ({
        id: `placeholder_${index + 1}` as const,
      }));
    }

    const customers = customersQuery.data?.pages.flatMap((page) => page.customers) || [];

    return customers.length > 0 ? customers : null;
  }, [customersQuery]);

  if (customersQuery.isError) {
    return <InfoBanner colorScheme="error">Error loading customers. Please try again.</InfoBanner>;
  }

  return (
    <FlatList
      data={data}
      renderItem={renderCustomer}
      keyExtractor={(item) => item.id}
      refreshing={customersQuery.isRefetching}
      ItemSeparatorComponent={() => <View className="mx-4 h-hairline bg-gray-200" />}
      className="overflow-hidden rounded-xl border border-gray-200"
      ListEmptyComponent={
        <View className="items-center justify-center gap-2 px-4 py-10">
          <CircleAlert size={24} />
          {isSearching ? (
            <Text className="text-center">No customers match{'\n'}the search</Text>
          ) : (
            <Text className="text-center">No customers found</Text>
          )}
        </View>
      }
      ListFooterComponent={
        customersQuery.isFetchingNextPage ? (
          <View>
            <CustomerListPlaceholder />
            <View className="mx-4 h-hairline bg-gray-200" />
            <CustomerListPlaceholder />
            <View className="mx-4 h-hairline bg-gray-200" />
            <CustomerListPlaceholder />
            <View className="mx-4 h-hairline bg-gray-200" />
            <CustomerListPlaceholder />
            <View className="mx-4 h-hairline bg-gray-200" />
            <CustomerListPlaceholder />
            <View className="mx-4 h-hairline bg-gray-200" />
            <CustomerListPlaceholder />
            <View className="mx-4 h-hairline bg-gray-200" />
            <CustomerListPlaceholder />
            <View className="mx-4 h-hairline bg-gray-200" />
            <CustomerListPlaceholder />
          </View>
        ) : null
      }
      onRefresh={() => {
        customersQuery.refetch();
      }}
      onEndReached={() => {
        if (customersQuery.hasNextPage && !customersQuery.isFetchingNextPage) {
          customersQuery.fetchNextPage();
        }
      }}
      keyboardDismissMode="on-drag"
    />
  );
};

export default function CustomerLookupScreen() {
  const params = useLocalSearchParams<{
    customerId?: string;
  }>();
  const [searchQuery, setSearchQuery] = React.useState('');
  const debouncedSearch = useDebouncedValue(searchQuery, 250);
  const [selectedCustomerId, setSelectedCustomerId] = React.useState<string | undefined>(params.customerId);
  const [selectedCustomer, setSelectedCustomer] = React.useState<AdminCustomer>();
  const updateDraftOrderCustomer = useUpdateDraftOrderCustomer();

  return (
    <Dialog
      visible={true}
      title="Customer Lookup"
      onClose={() => router.back()}
      dismissOnOverlayPress={true}
      contentClassName="flex-shrink"
    >
      <SearchInput
        value={searchQuery}
        onChangeText={setSearchQuery}
        placeholder="Search by phone, email, or name..."
        className="mb-4"
      />

      <CustomersList
        searchParams={buildCustomerSearchParams(debouncedSearch)}
        selectedCustomerId={selectedCustomerId}
        onCustomerSelect={(customer) => {
          setSelectedCustomerId(customer.id);
          setSelectedCustomer(customer);
        }}
      />

      <Button
        className="mb-4 mt-4"
        disabled={!selectedCustomerId}
        onPress={() => {
          if (!selectedCustomerId) {
            return;
          }

          if (selectedCustomer) {
            updateDraftOrderCustomer.mutate(selectedCustomer);
          }

          router.back();
        }}
      >
        Select Customer
      </Button>
      <AddOrCreateCustomerButton
        query={searchQuery}
        onResolved={(customer) => {
          setSelectedCustomerId(customer.id);
          setSelectedCustomer(customer);
        }}
      />
    </Dialog>
  );
}
