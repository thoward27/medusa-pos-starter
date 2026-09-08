import { useMedusaSdk } from '@/contexts/auth';
import { showErrorToast } from '@/utils/errors';
import { AdminCreateCustomer, AdminCustomerFilters, AdminCustomerListResponse } from '@medusajs/types';
import {
  InfiniteData,
  UndefinedInitialDataInfiniteOptions,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';

const PER_PAGE = 20;

export const useCustomers = (
  query?: Omit<AdminCustomerFilters, 'limit' | 'offset'>,
  limit = PER_PAGE,
  options?: Omit<
    UndefinedInitialDataInfiniteOptions<
      AdminCustomerListResponse,
      unknown,
      InfiniteData<AdminCustomerListResponse>,
      readonly unknown[],
      number
    >,
    'queryKey' | 'queryFn' | 'initialPageParam' | 'getNextPageParam' | 'getPreviousPageParam'
  >,
) => {
  const sdk = useMedusaSdk();

  return useInfiniteQuery({
    queryKey: ['customers', JSON.stringify(query ?? {})],
    queryFn: async ({ pageParam = 1 }) => {
      return sdk.admin.customer.list({
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

export const useCreateCustomer = () => {
  const sdk = useMedusaSdk();
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ['customers', 'create'],
    mutationFn: async (data: AdminCreateCustomer) => {
      return sdk.admin.customer.create(data);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['customers'],
        exact: false,
      });
    },
    onError: (error) => {
      showErrorToast(error);
    },
  });
};

/**
 * Create a customer WITH an account they can actually sign into, and mail them
 * a link to set a password — in ONE backend call.
 *
 * ── Why this is not `useCreateCustomer` plus two more calls ──────────────────
 *
 * `useCreateCustomer` above posts to `/admin/customers`, which mints a customer
 * row and nothing else: no auth identity, `has_account: false`. The person
 * named on it cannot sign in. For a sticker that is fine. For a commission it
 * is fatal — the buyer's only channel to the artist over a multi-week build is
 * the notes thread on their order, and that thread is reachable only from a
 * signed-in account. 172 TaylorMade commission orders are in exactly that
 * state.
 *
 * The obvious client-side fix — create the customer, then register an auth
 * identity, then trigger a reset email — is worse than it looks. A show is the
 * worst network this app runs on, and a three-call sequence fails PARTWAY:
 * lose the second call and the till has produced the original bug again; lose
 * the third and the buyer has an account nobody told them about. Neither is
 * visible to the operator, who sees a customer in the list and carries on.
 *
 * `POST /admin/customer-accounts` does all three server-side as one workflow
 * with compensation. It either happened or it did not, and this hook can safely
 * be retried.
 *
 * ── Behaviour worth knowing at the till ──────────────────────────────────────
 *
 *   - Idempotent by email. Tapping twice is safe: the second call answers
 *     `already_registered` and sends NO second email.
 *   - An existing guest row for the same address is UPGRADED in place, so the
 *     customer's previous POS orders follow them into the account rather than
 *     being stranded on an orphaned record.
 *   - A real email address is required. The synthetic `pos-customer+<digits>@…`
 *     fallback is on the store's own domain, so the set-password link would
 *     reach the store and never the buyer; the backend refuses it for
 *     commissions.
 */
export interface ProvisionCustomerAccountResponse {
  customer_id: string;
  email: string;
  outcome: 'created' | 'upgraded' | 'already_registered';
  set_password_email_sent: boolean;
}

export const useProvisionCustomerAccount = () => {
  const sdk = useMedusaSdk();
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ['customers', 'provision-account'],
    mutationFn: async (data: {
      email: string;
      first_name?: string;
      last_name?: string;
      phone?: string;
      provisioned_via?: string;
    }) => {
      return sdk.client.fetch<ProvisionCustomerAccountResponse>('/admin/customer-accounts', {
        method: 'POST',
        body: data,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['customers'],
        exact: false,
      });
    },
    onError: (error) => {
      showErrorToast(error);
    },
  });
};
