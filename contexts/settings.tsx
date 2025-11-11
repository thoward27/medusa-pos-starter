import { showErrorToast } from '@/utils/errors';
import { storage } from '@/utils/storage';
import Medusa from '@medusajs/js-sdk';
import { DefaultError, useMutation, UseMutationOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import * as React from 'react';
import { useAuthCtx } from './auth';

export type SettingsStateType = {
  sales_channel_id: string;
  stock_location_id: string;
  region_id: string;
};

export const useSettings = () => {
  const { state } = useAuthCtx();

  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: async () => {
      if (state.status !== 'authenticated') {
        return null;
      }

      const sdk = new Medusa({
        baseUrl: state.medusaUrl,
        debug: false,
        auth: {
          type: 'jwt',
          jwtTokenStorageMethod: 'custom',
          storage: {
            getItem: () => state.apiKey,
            setItem: () => {},
            removeItem: () => {},
          },
        },
      });

      const sales_channel_id = await storage.getItemAsync('sales_channel_id');
      const stock_location_id = await storage.getItemAsync('stock_location_id');
      const region_id = await storage.getItemAsync('region_id');

      if (!sales_channel_id && !stock_location_id && !region_id) {
        return null;
      }

      const sales_channel_response = sales_channel_id
        ? await sdk.admin.salesChannel.retrieve(sales_channel_id).catch((error) => {
            console.error(error);
            return undefined;
          })
        : undefined;
      const stock_location_response = stock_location_id
        ? await sdk.admin.stockLocation.retrieve(stock_location_id).catch((error) => {
            console.error(error);
            return undefined;
          })
        : undefined;
      const region_response = region_id
        ? await sdk.admin.region.retrieve(region_id).catch((error) => {
            console.error(error);
            return undefined;
          })
        : undefined;

      return {
        sales_channel: sales_channel_response?.sales_channel,
        stock_location: stock_location_response?.stock_location,
        region: region_response?.region,
      };
    },
    enabled: state.status === 'authenticated',
  });

  React.useEffect(() => {
    if (settingsQuery.isError) {
      showErrorToast(settingsQuery.error);
    }
  }, [settingsQuery.isError, settingsQuery.error]);

  return settingsQuery;
};

export const useUpdateSettings = (
  options?: Omit<UseMutationOptions<void, DefaultError, Partial<SettingsStateType>>, 'mutationKey' | 'mutationFn'>,
) => {
  const client = useQueryClient();

  return useMutation({
    mutationKey: ['update-settings'],
    mutationFn: async (settings) => {
      if (!settings.sales_channel_id && !settings.stock_location_id && !settings.region_id) {
        throw new Error('At least one setting must be provided');
      }

      if (settings.sales_channel_id) {
        await storage.setItemAsync('sales_channel_id', settings.sales_channel_id);
      }
      if (settings.stock_location_id) {
        await storage.setItemAsync('stock_location_id', settings.stock_location_id);
      }
      if (settings.region_id) {
        await storage.setItemAsync('region_id', settings.region_id);
      }
    },
    ...options,
    onSuccess: async (...args) => {
      await client.invalidateQueries({
        queryKey: ['settings'],
      });

      if (options?.onSuccess) {
        return options.onSuccess(...args);
      }
    },
    onError(error, variables, context) {
      showErrorToast(error);
      return options?.onError?.(error, variables, context);
    },
  });
};

export const useClearSettings = () => {
  const client = useQueryClient();

  return useMutation({
    mutationKey: ['clear-settings'],
    mutationFn: async () => {
      await storage.deleteItemAsync('sales_channel_id');
      await storage.deleteItemAsync('stock_location_id');
      await storage.deleteItemAsync('region_id');
      await storage.deleteItemAsync('draft_order_id');
      return null;
    },
    onSuccess: async () => {
      await client.invalidateQueries({
        queryKey: ['settings'],
      });
    },
    onError(error, variables, context) {
      showErrorToast(error);
    },
  });
};
