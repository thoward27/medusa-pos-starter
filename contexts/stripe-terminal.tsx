import React, { createContext, useContext, ReactNode, useEffect } from 'react';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { useMedusaSdk } from './auth';
import { StripeTerminalProvider, useStripeTerminal } from '@stripe/stripe-terminal-react-native';

// Check if we're running in Expo Go (which doesn't support native modules)
const isExpoGo = Constants.appOwnership === 'expo';

// Check if Stripe Terminal is available
// Based on React Native SDK docs: Only available on native platforms (iOS/Android)
const isStripeTerminalAvailable = !isExpoGo && Platform.OS !== 'web';

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

/**
 * Stripe Terminal Provider Wrapper
 *
 * Implements best practices from Stripe Terminal React Native documentation:
 * https://docs.stripe.com/terminal/payments/setup-integration?terminal-sdk-platform=react-native
 *
 * Key requirements:
 * 1. Token provider function that fetches connection tokens from backend
 * 2. DO NOT cache or hardcode connection tokens - SDK manages lifecycle
 * 3. Token provider called whenever SDK needs to authenticate with Stripe or Reader
 * 4. Must be wrapped around components that use useStripeTerminal hook
 */
const StripeTerminalWrapperInner: React.FC<StripeTerminalWrapperProps> = ({ children }) => {
  const sdk = useMedusaSdk();

  const contextValue: StripeTerminalContextType = {
    isAvailable: isStripeTerminalAvailable,
  };

  // Token provider function as per documentation
  // This function is called whenever the SDK needs to authenticate with Stripe or the Reader
  // It's also called when a new connection token is needed to connect to a reader
  const fetchConnectionToken = async (): Promise<string> => {
    try {
      console.log('[Stripe Terminal] Fetching connection token from backend');

      // Your backend should call /v1/terminal/connection_tokens and return the JSON response from Stripe
      const response = await sdk.client.fetch('/admin/stripe/connection-tokens', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const data = response as { secret?: string };

      if (!data.secret) {
        throw new Error('Connection token missing secret field');
      }

      console.log('[Stripe Terminal] Connection token retrieved successfully');
      return data.secret;
    } catch (error) {
      console.error('[Stripe Terminal] Failed to fetch connection token:', error);
      throw error;
    }
  };

  // If Stripe Terminal is available, wrap with the provider
  if (isStripeTerminalAvailable) {
    return (
      <StripeTerminalProvider logLevel="verbose" tokenProvider={fetchConnectionToken}>
        <StripeTerminalContext.Provider value={contextValue}>
          <StripeTerminalInitializer>{children}</StripeTerminalInitializer>
        </StripeTerminalContext.Provider>
      </StripeTerminalProvider>
    );
  }

  // If Stripe Terminal is not available (web or Expo Go), just provide context
  return <StripeTerminalContext.Provider value={contextValue}>{children}</StripeTerminalContext.Provider>;
};

/**
 * Stripe Terminal Initializer Component
 *
 * Per React Native SDK documentation:
 * "You must call the initialize method from a component nested within StripeTerminalProvider
 * and not from the component that contains the StripeTerminalProvider."
 *
 * This component handles the one-time initialization of the Stripe Terminal SDK.
 * Individual reader components should NOT call initialize() themselves.
 */
const StripeTerminalInitializer: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { initialize } = useStripeTerminal();

  useEffect(() => {
    console.log('[Stripe Terminal] Initializing SDK...');
    initialize()
      .then(({ error }) => {
        if (error) {
          console.error('[Stripe Terminal] Initialization failed:', error);
        } else {
          console.log('[Stripe Terminal] SDK initialized successfully');
        }
      })
      .catch((err) => {
        console.error('[Stripe Terminal] Initialization error:', err);
      });
  }, [initialize]);

  return <>{children}</>;
};

export const StripeTerminalWrapper: React.FC<StripeTerminalWrapperProps> = ({ children }) => {
  return <StripeTerminalWrapperInner>{children}</StripeTerminalWrapperInner>;
};
