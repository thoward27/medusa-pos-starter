import React, { createContext, useContext, ReactNode } from 'react';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { useMedusaSdk } from './auth';
import { StripeTerminalProvider } from '@stripe/stripe-terminal-react-native';

// Check if we're running in Expo Go (which doesn't support native modules)
const isExpoGo = Constants.appOwnership === 'expo';

// Check if Stripe Terminal is available
let StripeTerminalAvailable = false;

if (!isExpoGo && Platform.OS !== 'web') {
  try {
    StripeTerminalAvailable = true;
  } catch (error) {
    console.warn('Stripe Terminal not available:', error);
    StripeTerminalAvailable = false;
  }
}

interface StripeTerminalContextType {
  isAvailable: boolean;
}

const StripeTerminalContext = createContext<StripeTerminalContextType>({
  isAvailable: false,
});

export const useStripeTerminalContext = () => {
  return useContext(StripeTerminalContext);
};

interface StripeTerminalWrapperProps {
  children: ReactNode;
}

const StripeTerminalWrapperInner: React.FC<StripeTerminalWrapperProps> = ({ children }) => {
  const sdk = useMedusaSdk();
  const contextValue: StripeTerminalContextType = {
    isAvailable: StripeTerminalAvailable,
  };

  // If Stripe Terminal is available, wrap with the provider
  if (StripeTerminalAvailable && StripeTerminalProvider) {
    return (
      <StripeTerminalProvider
        logLevel="verbose"
        tokenProvider={async () => {
          console.log('Stripe Terminal requesting connection token');

          const response = await sdk.client.fetch('/admin/stripe/connection-tokens', {
            method: 'POST',
          });

          const data = response as { secret?: string };

          if (!data.secret) {
            throw new Error('Connection token missing secret field');
          }

          return data.secret;
        }}
      >
        <StripeTerminalContext.Provider value={contextValue}>{children}</StripeTerminalContext.Provider>
      </StripeTerminalProvider>
    );
  }

  // If Stripe Terminal is not available, just provide context
  return <StripeTerminalContext.Provider value={contextValue}>{children}</StripeTerminalContext.Provider>;
};

export const StripeTerminalWrapper: React.FC<StripeTerminalWrapperProps> = ({ children }) => {
  return <StripeTerminalWrapperInner>{children}</StripeTerminalWrapperInner>;
};
