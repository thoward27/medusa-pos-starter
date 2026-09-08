import React, { createContext, useContext, ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';
import Constants from 'expo-constants';
import { useMedusaSdk } from './auth';
import { StripeTerminalProvider, useStripeTerminal } from '@stripe/stripe-terminal-react-native';

// Check if we're running in Expo Go (which doesn't support native modules)
const isExpoGo = Constants.appOwnership === 'expo';

// Check if Stripe Terminal is available
// Based on React Native SDK docs: Only available on native platforms (iOS/Android)
const isStripeTerminalAvailable = !isExpoGo && Platform.OS !== 'web';

type InitStatus = 'pending' | 'ready' | 'error';

interface StripeTerminalContextType {
  isAvailable: boolean;
  // Tracks the app-level SDK initialization so screens can distinguish
  // "still initializing" from "initialization failed" (and offer a retry)
  // instead of spinning forever.
  initStatus: InitStatus;
  initError: string | null;
  retryInitialize: () => void;
}

const StripeTerminalContext = createContext<StripeTerminalContextType>({
  isAvailable: false,
  initStatus: 'pending',
  initError: null,
  retryInitialize: () => {},
});

export const useStripeTerminalContext = () => {
  return useContext(StripeTerminalContext);
};

interface StripeTerminalWrapperProps {
  children: ReactNode;
}

/**
 * Request the Android runtime permissions Stripe Terminal needs.
 *
 * The `withStripeTerminal` config plugin only *declares* these in the manifest.
 * On Android 12+ (API 31) location and Bluetooth are runtime permissions that
 * must be explicitly granted — the SDK does not prompt for them itself (unlike
 * iOS). Stripe Terminal's `initialize()` requires ACCESS_FINE_LOCATION; without
 * it, initialization never completes and every SDK call is blocked.
 *
 * Location is mandatory. Bluetooth is only needed for Bluetooth card readers, so
 * we request it but do NOT block initialization on it (Tap to Pay works without
 * it).
 */
const requestAndroidTerminalPermissions = async (): Promise<boolean> => {
  try {
    const perms = [
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      ...(typeof Platform.Version === 'number' && Platform.Version >= 31
        ? [PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT, PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN]
        : []),
    ];

    const result = await PermissionsAndroid.requestMultiple(perms);

    return result[PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION] === PermissionsAndroid.RESULTS.GRANTED;
  } catch (error) {
    console.error('[Stripe Terminal] Permission request failed:', error);
    return false;
  }
};

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
  // The Stripe SDK replaces any tokenProvider error with a generic "check your
  // tokenProvider method" message, hiding the real HTTP failure. We stash the
  // real cause here so the initializer can surface it (404 = route missing,
  // 500 = Stripe not configured on the backend, etc.).
  const tokenErrorRef = useRef<string | null>(null);

  // Token provider function as per documentation
  // This function is called whenever the SDK needs to authenticate with Stripe or the Reader
  // It's also called when a new connection token is needed to connect to a reader.
  // Memoized on `sdk` so the provider's `initialize` keeps a stable identity —
  // otherwise it changes every render and the root initializer re-fires init (and
  // re-fetches a token) repeatedly, worsening the mount-time init race on Android.
  const fetchConnectionToken = useCallback(async (): Promise<string> => {
    try {
      tokenErrorRef.current = null;
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
        throw new Error('Backend response is missing the `secret` field');
      }

      console.log('[Stripe Terminal] Connection token retrieved successfully');
      return data.secret;
    } catch (error: any) {
      // Medusa's FetchError carries `.status`; include it so the failure mode is
      // obvious in the surfaced error.
      const detail =
        typeof error?.status === 'number'
          ? `HTTP ${error.status} from /admin/stripe/connection-tokens${error?.message ? ` — ${error.message}` : ''}`
          : (error?.message ?? String(error));
      tokenErrorRef.current = detail;
      console.error('[Stripe Terminal] Failed to fetch connection token:', error);
      throw error;
    }
  }, [sdk]);

  // If Stripe Terminal is available, wrap with the provider
  if (isStripeTerminalAvailable) {
    return (
      <StripeTerminalProvider logLevel="verbose" tokenProvider={fetchConnectionToken}>
        <StripeTerminalInitializer tokenErrorRef={tokenErrorRef}>{children}</StripeTerminalInitializer>
      </StripeTerminalProvider>
    );
  }

  // If Stripe Terminal is not available (web or Expo Go), just provide context
  return (
    <StripeTerminalContext.Provider
      value={{
        isAvailable: false,
        initStatus: 'error',
        initError: 'Card payments are not available in this environment.',
        retryInitialize: () => {},
      }}
    >
      {children}
    </StripeTerminalContext.Provider>
  );
};

/**
 * Stripe Terminal Initializer Component
 *
 * Per React Native SDK documentation:
 * "You must call the initialize method from a component nested within StripeTerminalProvider
 * and not from the component that contains the StripeTerminalProvider."
 *
 * This component handles the one-time initialization of the Stripe Terminal SDK
 * (requesting Android runtime permissions first) and exposes its status so
 * screens can react to failure instead of waiting indefinitely. Individual reader
 * components should NOT call initialize() themselves — they gate on this status /
 * the SDK's `isInitialized` flag.
 */
const StripeTerminalInitializer: React.FC<{
  children: ReactNode;
  tokenErrorRef: React.RefObject<string | null>;
}> = ({ children, tokenErrorRef }) => {
  const { initialize } = useStripeTerminal();
  const [initStatus, setInitStatus] = useState<InitStatus>('pending');
  const [initError, setInitError] = useState<string | null>(null);
  // Bumping this re-runs the init effect for an explicit user-driven retry.
  const [attempt, setAttempt] = useState(0);

  const retryInitialize = useCallback(() => setAttempt((a) => a + 1), []);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      setInitStatus('pending');
      setInitError(null);

      try {
        if (Platform.OS === 'android') {
          const granted = await requestAndroidTerminalPermissions();
          if (cancelled) return;
          if (!granted) {
            setInitStatus('error');
            setInitError(
              'Location permission is required to accept card payments. Enable it for this app in Settings, then retry.',
            );
            return;
          }
        }

        console.log('[Stripe Terminal] Initializing SDK...');
        const { error } = await initialize();
        if (cancelled) return;

        if (error) {
          console.error('[Stripe Terminal] Initialization failed:', error);
          setInitStatus('error');
          // Prefer the real token-fetch cause we captured over the SDK's generic
          // "check your tokenProvider method" message when a token error occurred.
          setInitError(tokenErrorRef.current || error.message || 'Failed to initialize the payment system.');
        } else {
          console.log('[Stripe Terminal] SDK initialized successfully');
          setInitStatus('ready');
        }
      } catch (err: any) {
        if (cancelled) return;
        console.error('[Stripe Terminal] Initialization error:', err);
        setInitStatus('error');
        setInitError(err?.message || 'Failed to initialize the payment system.');
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [initialize, attempt]);

  const value: StripeTerminalContextType = {
    isAvailable: isStripeTerminalAvailable,
    initStatus,
    initError,
    retryInitialize,
  };

  return <StripeTerminalContext.Provider value={value}>{children}</StripeTerminalContext.Provider>;
};

export const StripeTerminalWrapper: React.FC<StripeTerminalWrapperProps> = ({ children }) => {
  return <StripeTerminalWrapperInner>{children}</StripeTerminalWrapperInner>;
};
