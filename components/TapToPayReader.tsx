import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { Smartphone } from '@/components/icons/smartphone';
import React, { useEffect, useState, useCallback } from 'react';
import { ActivityIndicator, View, Alert, Platform } from 'react-native';
import Constants from 'expo-constants';
import { useStripeTerminal } from '@stripe/stripe-terminal-react-native';

interface TapToPayReaderProps {
  amount: number;
  currency: string;
  onPaymentSuccess: (paymentIntentId: string) => void;
  onCancel: () => void;
}

type ReaderStatus = 'initializing' | 'ready' | 'reading' | 'processing' | 'success' | 'error' | 'unsupported';

// Check if we're running in Expo Go (which doesn't support native modules)
const isExpoGo = Constants.appOwnership === 'expo';

// Validate environment variables
const STRIPE_LOCATION_ID = process.env.EXPO_PUBLIC_STRIPE_LOCATION_ID;
if (!STRIPE_LOCATION_ID && !isExpoGo && Platform.OS !== 'web') {
  console.error(
    'EXPO_PUBLIC_STRIPE_LOCATION_ID is not set. ' +
      'Please add it to your .env file. ' +
      'Get your Location ID from: https://dashboard.stripe.com/terminal/locations',
  );
}

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

// Create a wrapper component that only uses hooks when available
const TapToPayReaderNative: React.FC<TapToPayReaderProps> = ({ amount, currency, onPaymentSuccess, onCancel }) => {
  const [status, setStatus] = useState<ReaderStatus>('initializing');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [readerMessage, setReaderMessage] = useState<string>('');

  // Use a ref to store discovered readers to avoid re-render loops
  const discoveredReadersRef = React.useRef<any[]>([]);

  const {
    initialize,
    discoverReaders,
    connectReader,
    disconnectReader,
    getConnectedReader,
    createPaymentIntent,
    collectPaymentMethod,
    confirmPaymentIntent,
    cancelCollectPaymentMethod,
  } = useStripeTerminal({
    onUpdateDiscoveredReaders: (readers: any) => {
      console.log('Discovered readers:', readers);
      discoveredReadersRef.current = readers || [];
    },
    onDidRequestReaderInput: (input: string[]) => {
      console.log('Reader input requested:', input);
      const messages: Record<string, string> = {
        insertCard: 'Insert or tap card',
        insertOrSwipeCard: 'Insert, tap, or swipe card',
        swipeCard: 'Swipe card',
        removeCard: 'Remove card',
        multipleContactlessCardsDetected: 'Multiple cards detected - present one card',
        tryAnotherReadMethod: 'Try another read method',
        tryAnotherCard: 'Try another card',
      };
      setReaderMessage(messages[input[0]] || 'Waiting for card...');
    },
    onDidRequestReaderDisplayMessage: (message: string) => {
      console.log('Reader message:', message);
      const messages: Record<string, string> = {
        retryCard: 'Please retry card',
        insertCard: 'Insert card',
        insertOrSwipeCard: 'Insert or swipe card',
        swipeCard: 'Swipe card',
        removeCard: 'Remove card',
        multipleContactlessCardsDetected: 'Multiple cards detected',
        tryAnotherReadMethod: 'Try another method',
        tryAnotherCard: 'Try another card',
        cardRemovedTooEarly: 'Card removed too early - try again',
      };
      setReaderMessage(messages[message] || message);
    },
  });

  const initializeReader = useCallback(async () => {
    try {
      setStatus('initializing');
      setReaderMessage('Initializing payment reader...');

      // Initialize Stripe Terminal
      // Connection token is fetched by StripeTerminalProvider's tokenProvider
      const { error: initError } = await initialize();

      if (initError) {
        throw new Error(initError.message || 'Failed to initialize Terminal');
      }

      // Check if there's already a connected reader
      const connectedReader = await getConnectedReader();
      if (connectedReader && connectedReader.deviceType !== 'tapToPay') {
        console.log('Disconnecting from non-Tap to Pay reader');
        await disconnectReader();
      }
      if (connectedReader) {
        console.log('Reader already connected:', connectedReader);
      } else {
        console.log('No reader connected');
        setReaderMessage('Discovering Tap to Pay...');
        discoveredReadersRef.current = []; // Reset before discovery

        const { error: discoverError } = await discoverReaders({
          discoveryMethod: 'tapToPay',
          simulated: __DEV__, // Use simulated reader in development
        });
        if (discoverError) {
          throw new Error(discoverError.message || 'Failed to discover Tap to Pay reader');
        } else if (discoveredReadersRef.current.length === 0) {
          // Readers are populated via onUpdateDiscoveredReaders callback
          // The callback is synchronous, so readers should be available now
          throw new Error('No Tap to Pay reader found. Device may not support Tap to Pay.');
        }
        // Connect to the discovered Tap to Pay reader
        setReaderMessage('Connecting to Tap to Pay...');
        // Validate location ID before connecting
        if (!STRIPE_LOCATION_ID) {
          throw new Error(
            'Stripe Location ID is not configured. ' + 'Please set EXPO_PUBLIC_STRIPE_LOCATION_ID in your .env file.',
          );
        }

        const { error: connectError } = await connectReader(
          {
            reader: discoveredReadersRef.current[0],
            locationId: STRIPE_LOCATION_ID,
          },
          'tapToPay',
        );

        if (connectError) {
          throw new Error(connectError.message || 'Failed to connect to Tap to Pay reader');
        }
      }

      // Initialization successful - the device is now ready to accept payments
      setStatus('ready');
      setReaderMessage('Ready to accept payment');

      if (Platform.OS === 'ios') {
        console.log('iOS Tap to Pay initialized successfully');
      } else if (Platform.OS === 'android') {
        console.log('Android NFC reader initialized successfully');
      }
    } catch (err) {
      setStatus('error');
      const errorMsg = err instanceof Error ? err.message : 'Failed to initialize reader';
      setErrorMessage(errorMsg);
      console.error('Reader initialization error:', err);
    }
  }, [initialize, discoverReaders, connectReader, disconnectReader, getConnectedReader]);

  useEffect(() => {
    initializeReader();

    return () => {
      // Cleanup on unmount
      cancelCollectPaymentMethod().catch(console.error);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initializeReader]);

  const startPaymentCollection = async () => {
    try {
      setStatus('reading');
      setReaderMessage('Creating payment...');

      // Step 1: Create payment intent via Stripe Terminal SDK
      const { paymentIntent: createdIntent, error: createError } = await createPaymentIntent({
        amount, // Amount in cents (already converted by parent component)
        currency: currency.toLowerCase(),
        paymentMethodTypes: ['card_present'],
        captureMethod: 'automatic',
      });

      if (createError) {
        throw new Error(createError.message || 'Failed to create payment intent');
      }

      if (!createdIntent) {
        throw new Error('No payment intent returned from creation');
      }

      console.log('Created payment intent via Terminal:', createdIntent.id);

      setReaderMessage('Present card to device');

      // Step 2: Collect payment method using device NFC
      const { paymentIntent: collectedIntent, error: collectError } = await collectPaymentMethod({
        paymentIntent: createdIntent,
      });

      if (collectError) {
        throw new Error(collectError.message || 'Failed to collect payment method');
      }

      if (!collectedIntent) {
        throw new Error('No payment intent returned from collection');
      }

      console.log('Collected payment method:', collectedIntent.id);

      setStatus('processing');
      setReaderMessage('Processing payment...');

      // Step 3: Confirm the payment
      const { paymentIntent: processedIntent, error: processError } = await confirmPaymentIntent({
        paymentIntent: collectedIntent,
      });

      if (processError) {
        throw new Error(processError.message || 'Payment confirmation failed');
      }

      if (!processedIntent) {
        throw new Error('No payment intent returned after confirmation');
      }

      // Check payment status
      if (processedIntent.status === 'succeeded') {
        setStatus('success');
        setReaderMessage('Payment successful!');

        console.log('Payment confirmed and succeeded:', processedIntent.id);

        // Give user a moment to see success
        setTimeout(() => {
          onPaymentSuccess(processedIntent.id);
        }, 1500);
      } else {
        throw new Error(`Payment status: ${processedIntent.status}`);
      }
    } catch (err) {
      setStatus('error');
      const errorMsg = err instanceof Error ? err.message : 'Payment failed';
      setErrorMessage(errorMsg);
      console.error('Payment collection error:', err);

      Alert.alert('Payment Failed', errorMsg, [
        {
          text: 'Try Again',
          onPress: () => {
            setStatus('ready');
            setErrorMessage('');
          },
        },
        {
          text: 'Cancel',
          onPress: onCancel,
          style: 'cancel',
        },
      ]);
    }
  };

  const handleCancel = async () => {
    if (status === 'reading') {
      try {
        await cancelCollectPaymentMethod();
      } catch (err) {
        console.error('Error canceling payment:', err);
      }
    }
    onCancel();
  };

  const handleDisconnect = async () => {
    try {
      const connectedReader = await getConnectedReader();
      if (connectedReader) {
        await disconnectReader();
        console.log('Disconnected from reader');
      }
    } catch (err) {
      console.error('Error disconnecting reader:', err);
    }
  };

  const handleRetry = async () => {
    setErrorMessage('');
    await initializeReader();
  };

  // Render initializing state
  if (status === 'initializing') {
    return (
      <View className="items-center justify-center gap-4 py-8">
        <ActivityIndicator size="large" color="#000000" />
        <Text className="text-xl font-semibold">{readerMessage}</Text>
        <Text className="text-center text-sm text-gray-400">This may take a few moments{'\n'}Please wait</Text>
      </View>
    );
  }

  // Render error state
  if (status === 'error') {
    return (
      <View className="gap-4">
        <View className="rounded-xl bg-red-50 p-4">
          <Text className="mb-2 font-semibold text-red-700">Payment Error</Text>
          <Text className="text-red-600">{errorMessage}</Text>
        </View>
        <View className="flex-row gap-2">
          <Button variant="outline" className="flex-1" onPress={handleCancel}>
            Cancel
          </Button>
          <Button className="flex-1" onPress={handleRetry}>
            Try Again
          </Button>
        </View>
        <Button variant="outline" onPress={handleDisconnect} className="mt-2">
          Disconnect Reader
        </Button>
      </View>
    );
  }

  // Render ready state
  if (status === 'ready') {
    return (
      <View className="mb-3 gap-4">
        <View className="items-center gap-2 rounded-xl bg-gray-50 p-4">
          <Text className="text-center text-xl font-semibold">Card Reader Deteced</Text>
          <View className="mt-0">
            <Text className="text-center text-sm text-gray-400">Amount</Text>
            <Text className="text-center text-4xl font-bold">
              {(amount / 100).toLocaleString('en-US', {
                style: 'currency',
                currency: currency,
              })}
            </Text>
          </View>
        </View>

        <View className="flex-row gap-2">
          <Button variant="outline" className="flex-1" onPress={handleCancel}>
            ✕ Cancel
          </Button>
          <Button className="flex-1" onPress={startPaymentCollection}>
            Charge Card
          </Button>
        </View>
      </View>
    );
  }

  // Render reading state
  if (status === 'reading') {
    return (
      <View className="items-center justify-center gap-4 py-8" style={{ backgroundColor: 'black', minHeight: 400 }}>
        <View className="relative">
          <Smartphone size={80} className="text-white" />
          <View className="absolute -right-2 -top-2">
            <View className="h-5 w-5 animate-pulse rounded-full bg-white" />
          </View>
        </View>
        <Text className="text-center text-2xl font-bold text-white">{readerMessage}</Text>
        <Text className="text-center text-white opacity-75">Hold card steady until payment completes</Text>

        {__DEV__ && (
          <View className="rounded-lg bg-yellow-600 p-2">
            <Text className="text-center text-xs text-white">Simulated Reader: Tap anywhere to simulate card</Text>
          </View>
        )}

        <View className="mt-4 rounded-xl bg-white p-4">
          <Text className="text-center text-3xl font-bold text-black">
            {(amount / 100).toLocaleString('en-US', {
              style: 'currency',
              currency: currency,
            })}
          </Text>
        </View>
        <Button variant="outline" onPress={handleCancel} className="mt-4 border-white">
          <Text className="text-white">✕ Cancel Payment</Text>
        </Button>
      </View>
    );
  }

  // Render processing state
  if (status === 'processing') {
    return (
      <View className="items-center justify-center gap-4 py-8">
        <ActivityIndicator size="large" color="#10B981" />
        <Text className="text-center text-2xl font-bold">{readerMessage}</Text>
        <Text className="text-center text-gray-400">Please wait, do not close this screen</Text>
        <View className="mt-2 rounded-xl bg-green-50 p-4">
          <Text className="text-center text-2xl font-bold text-green-700">
            {(amount / 100).toLocaleString('en-US', {
              style: 'currency',
              currency: currency,
            })}
          </Text>
        </View>
      </View>
    );
  }

  // Render success state
  if (status === 'success') {
    return (
      <View className="items-center justify-center gap-4 py-8">
        <View className="h-20 w-20 items-center justify-center rounded-full bg-green-100">
          <Text className="text-5xl">✓</Text>
        </View>
        <Text className="text-center text-2xl font-bold text-green-700">Payment Successful!</Text>
        <Text className="text-center text-gray-400">Completing your order...</Text>
        <View className="mt-2">
          <Text className="text-center text-xl font-bold text-green-600">
            {(amount / 100).toLocaleString('en-US', {
              style: 'currency',
              currency: currency,
            })}
          </Text>
        </View>
      </View>
    );
  }

  return null;
};

// Fallback component for unsupported environments
const TapToPayReaderUnsupported: React.FC<Pick<TapToPayReaderProps, 'onCancel'>> = ({ onCancel }) => {
  let errorMessage = 'Tap to Pay is not available in this environment.';

  if (isExpoGo) {
    errorMessage = 'Tap to Pay requires a development build. It cannot run in Expo Go.';
  } else if (Platform.OS === 'web') {
    errorMessage = 'Tap to Pay is not available on web. Please use a physical device.';
  } else {
    errorMessage = 'Stripe Terminal SDK is not properly installed. Please run "npx expo prebuild" and rebuild the app.';
  }

  return (
    <View className="gap-4">
      <View className="rounded-xl bg-yellow-50 p-4">
        <Text className="mb-2 font-semibold text-yellow-700">⚠️ Tap to Pay Unavailable</Text>
        <Text className="text-yellow-600">{errorMessage}</Text>
        {isExpoGo && (
          <View className="mt-3 rounded-lg bg-yellow-100 p-3">
            <Text className="text-sm font-semibold text-yellow-700">To use Tap to Pay:</Text>
            <Text className="mt-1 text-sm text-yellow-600">1. Run: npx expo prebuild</Text>
            <Text className="text-sm text-yellow-600">2. Build the app with Xcode (iOS) or Android Studio</Text>
            <Text className="text-sm text-yellow-600">3. Run on a physical device</Text>
          </View>
        )}
      </View>
      <Button variant="outline" onPress={onCancel}>
        Back to Payment Options
      </Button>
    </View>
  );
};

// Main exported component that chooses which variant to render
export const TapToPayReader: React.FC<TapToPayReaderProps> = (props) => {
  if (!StripeTerminalAvailable) {
    return <TapToPayReaderUnsupported onCancel={props.onCancel} />;
  }
  return <TapToPayReaderNative {...props} />;
};
