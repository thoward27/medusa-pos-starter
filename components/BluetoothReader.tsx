import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { Bluetooth } from '@/components/icons/bluetooth';
import React, { useEffect, useState, useCallback } from 'react';
import { ActivityIndicator, View, Alert, Platform } from 'react-native';
import Constants from 'expo-constants';
import { useStripeTerminal } from '@stripe/stripe-terminal-react-native';
import storage from '@/utils/storage';

interface BluetoothReaderProps {
  amount: number;
  currency: string;
  onPaymentSuccess: (paymentIntentId: string) => void;
  onCancel: () => void;
}

type ReaderStatus =
  | 'initializing'
  | 'discovering'
  | 'connecting'
  | 'ready'
  | 'reading'
  | 'processing'
  | 'success'
  | 'error'
  | 'unsupported';

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
const BluetoothReaderNative: React.FC<BluetoothReaderProps> = ({ amount, currency, onPaymentSuccess, onCancel }) => {
  const [status, setStatus] = useState<ReaderStatus>('initializing');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [readerMessage, setReaderMessage] = useState<string>('');
  const [selectedReader, setSelectedReader] = useState<any>(null);

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
      console.log('Discovered Bluetooth readers:', readers);
      discoveredReadersRef.current = readers || [];

      // Auto-connect to first reader if available and not already connected
      if (readers && readers.length > 0 && !selectedReader && status === 'discovering') {
        console.log('Auto-selecting first reader:', readers[0]);
        setSelectedReader(readers[0]);
      }
    },
    onDidRequestReaderInput: (input: string[]) => {
      const key = [...input].sort().join('');
      console.log('Reader input requested:', input, key);
      const messages: Record<string, string> = {
        insertCard: 'Insert or tap card',
        insertCardswipeCardtapCard: 'Insert, tap, or swipe card',
        swipeCard: 'Swipe card',
        removeCard: 'Remove card',
        multipleContactlessCardsDetected: 'Multiple cards detected - present one card',
        tryAnotherReadMethod: 'Try another read method',
        tryAnotherCard: 'Try another card',
      };
      setReaderMessage(messages[key] || `${key}`);
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
    onDidDisconnect: (result) => {
      console.log('Reader disconnected:', result);
      setStatus('error');
      setErrorMessage('Reader disconnected. Please reconnect and try again.');
      setSelectedReader(null);
    },
  });

  const initializeAndDiscoverReader = useCallback(async () => {
    try {
      setStatus('initializing');
      setReaderMessage('Initializing Bluetooth reader...');

      // Initialize the SDK
      const { error: initError } = await initialize();
      if (initError) {
        throw new Error(`Failed to initialize: ${initError.message}`);
      }

      console.log('SDK initialized successfully');

      // Check if already connected
      const connectedReader = await getConnectedReader();
      if (connectedReader) {
        if (connectedReader.deviceType !== 'tapToPay') {
          console.log('Already connected to reader:', connectedReader);
          setSelectedReader(connectedReader);
          setStatus('ready');
          setReaderMessage('Reader connected and ready');
          return;
        } else {
          console.log('Disconnecting from tap to pay reader...');
          await disconnectReader();
        }
      }

      // Discover Bluetooth readers
      setStatus('discovering');
      setReaderMessage('Searching for Bluetooth readers...');

      const { error: discoverError } = await discoverReaders({
        discoveryMethod: 'bluetoothScan',
        simulated: false,
      });

      if (discoverError) {
        throw new Error(`Failed to discover readers: ${discoverError.message}`);
      }

      console.log('Discovery complete');

      // Wait a moment for readers to be discovered
      await new Promise((resolve) => setTimeout(resolve, 1000));

      if (discoveredReadersRef.current.length === 0) {
        setStatus('error');
        setErrorMessage('No Bluetooth readers found. Please ensure your reader is powered on and nearby.');
        return;
      }

      console.log('Found readers:', discoveredReadersRef.current);
    } catch (error: any) {
      console.error('Initialization error:', error);
      const errorMsg = error?.message || 'Unknown error occurred';
      setStatus('error');
      setErrorMessage(errorMsg);
    }
  }, [initialize, discoverReaders, getConnectedReader]);

  const handleRetry = useCallback(() => {
    setStatus('ready');
    setErrorMessage('');
    setReaderMessage('Reader ready');
  }, []);

  const handleDisconnect = useCallback(async () => {
    try {
      const connectedReader = await getConnectedReader();
      if (connectedReader) {
        await disconnectReader();
      }
    } catch (error) {
      console.error('Disconnect error:', error);
    }
  }, [getConnectedReader, disconnectReader]);

  const handleCancel = useCallback(async () => {
    try {
      if (status === 'reading') {
        await cancelCollectPaymentMethod();
      }
      await handleDisconnect();
      onCancel();
    } catch (error) {
      console.error('Cancel error:', error);
      onCancel();
    }
  }, [status, cancelCollectPaymentMethod, onCancel, handleDisconnect]);

  const connectToReader = useCallback(async () => {
    if (!selectedReader) {
      setStatus('error');
      setErrorMessage('No reader selected');
      return;
    }

    try {
      setStatus('connecting');
      setReaderMessage('Connecting to reader...');

      const { error: connectError } = await connectReader(
        {
          reader: selectedReader,
          locationId: STRIPE_LOCATION_ID!,
        },
        'bluetoothScan',
      );

      if (connectError) {
        throw new Error(`Failed to connect: ${connectError.message}`);
      }

      console.log('Successfully connected to reader');
      setStatus('ready');
      setReaderMessage('Reader connected and ready');
    } catch (error: any) {
      console.error('Connection error:', error);
      const errorMsg = error?.message || 'Failed to connect to reader';
      setStatus('error');
      setErrorMessage(errorMsg);
      setSelectedReader(null);
    }
  }, [selectedReader, connectReader]);

  const startPaymentCollection = useCallback(async () => {
    try {
      setStatus('reading');
      setReaderMessage('Creating payment...');

      // Create Payment Intent
      const { paymentIntent: createdIntent, error: createError } = await createPaymentIntent({
        amount,
        currency: currency.toLowerCase(),
        paymentMethodTypes: ['card_present'],
        captureMethod: 'automatic',
      });

      if (createError || !createdIntent) {
        throw new Error(`Failed to create payment: ${createError?.message || 'Unknown error'}`);
      }

      console.log('Payment intent created:', createdIntent.id);
      setReaderMessage('Present card to reader...');

      // Collect Payment Method
      const { paymentIntent: collectedIntent, error: collectError } = await collectPaymentMethod({
        paymentIntent: createdIntent,
      });

      if (collectError || !collectedIntent) {
        throw new Error(`Failed to collect payment: ${collectError?.message || 'Unknown error'}`);
      }

      console.log('Payment method collected');
      setStatus('processing');
      setReaderMessage('Processing payment...');

      // Confirm Payment Intent
      const { paymentIntent: processedIntent, error: processError } = await confirmPaymentIntent({
        paymentIntent: collectedIntent,
      });

      if (processError || !processedIntent) {
        throw new Error(`Failed to process payment: ${processError?.message || 'Unknown error'}`);
      }

      console.log('Payment processed successfully:', processedIntent.id);
      setStatus('success');
      setReaderMessage('Payment successful!');

      // Call success callback with the payment intent ID
      setTimeout(() => {
        onPaymentSuccess(processedIntent.id);
      }, 1500);
    } catch (error: any) {
      console.error('Payment error:', error);
      const errorMsg = error?.message || 'Payment failed';
      setStatus('error');
      setErrorMessage(errorMsg);

      // Show error alert
      Alert.alert('Payment Failed', errorMsg, [
        {
          text: 'Try Again',
          onPress: handleRetry,
        },
        {
          text: 'Cancel',
          onPress: handleCancel,
          style: 'cancel',
        },
      ]);
    }
  }, [
    amount,
    currency,
    createPaymentIntent,
    collectPaymentMethod,
    confirmPaymentIntent,
    onPaymentSuccess,
    handleRetry,
    handleCancel,
  ]);

  // Initialize on mount
  useEffect(() => {
    initializeAndDiscoverReader();

    return () => {
      handleDisconnect();
    };
  }, [handleDisconnect, initializeAndDiscoverReader]);

  // Auto-connect when reader is selected
  useEffect(() => {
    if (selectedReader && status === 'discovering') {
      connectToReader();
    }
  }, [selectedReader, status, connectToReader]);

  // Auto-start payment when ready
  useEffect(() => {
    if (status === 'ready') {
      const timer = setTimeout(() => {
        startPaymentCollection();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [status, startPaymentCollection]);

  return (
    <View className="flex-1">
      {/* Status Display */}
      <View className="mb-6 rounded-xl bg-gray-50 p-6">
        <View className="mb-4 flex-row items-center justify-center gap-3">
          <Bluetooth size={32} className="text-gray-400" />
          <Text className="text-xl font-semibold">Bluetooth Reader</Text>
        </View>

        {/* Loading State */}
        {(status === 'initializing' ||
          status === 'discovering' ||
          status === 'connecting' ||
          status === 'reading' ||
          status === 'processing') && (
          <View className="items-center gap-4">
            <ActivityIndicator size="large" color="#000" />
            <Text className="text-center text-gray-400">{readerMessage}</Text>
          </View>
        )}

        {/* Ready State */}
        {status === 'ready' && (
          <View className="items-center gap-4">
            <ActivityIndicator size="large" color="#000" />
            <Text className="text-center text-gray-400">{readerMessage}</Text>
          </View>
        )}

        {/* Success State */}
        {status === 'success' && (
          <View className="items-center gap-4">
            <View className="h-16 w-16 items-center justify-center rounded-full bg-green-100">
              <Text className="text-3xl">✓</Text>
            </View>
            <Text className="text-center font-semibold text-green-600">{readerMessage}</Text>
          </View>
        )}

        {/* Error State */}
        {status === 'error' && (
          <View className="items-center gap-4">
            <View className="h-16 w-16 items-center justify-center rounded-full bg-red-100">
              <Text className="text-3xl">✕</Text>
            </View>
            <Text className="text-center font-semibold text-red-600">Payment Error</Text>
            <Text className="text-center text-sm text-gray-400">{errorMessage}</Text>
          </View>
        )}
      </View>

      {/* Amount Display */}
      <View className="mb-6 rounded-xl bg-gray-50 p-6">
        <Text className="mb-2 text-center text-sm text-gray-400">Payment Amount</Text>
        <Text className="text-center text-3xl font-bold">
          {(amount / 100).toLocaleString('en-US', {
            style: 'currency',
            currency: currency,
          })}
        </Text>
      </View>

      {/* Instructions */}
      <View className="mb-6 rounded-xl border border-gray-200 bg-white p-4">
        <Text className="mb-2 font-semibold">Instructions:</Text>
        <View className="gap-2">
          <View className="flex-row gap-2">
            <Text className="text-gray-400">1.</Text>
            <Text className="flex-1 text-gray-400">Ensure your Bluetooth reader is powered on</Text>
          </View>
          <View className="flex-row gap-2">
            <Text className="text-gray-400">2.</Text>
            <Text className="flex-1 text-gray-400">Keep the reader nearby (within Bluetooth range)</Text>
          </View>
          <View className="flex-row gap-2">
            <Text className="text-gray-400">3.</Text>
            <Text className="flex-1 text-gray-400">Present the customer&apos;s card when prompted</Text>
          </View>
        </View>
      </View>

      {/* Action Buttons */}
      <View className="flex-row gap-2">
        <Button
          variant="outline"
          className="flex-1"
          onPress={handleCancel}
          disabled={status === 'processing' || status === 'success'}
        >
          Cancel
        </Button>

        {status === 'error' && (
          <Button className="flex-1" onPress={initializeAndDiscoverReader}>
            Retry
          </Button>
        )}
      </View>
    </View>
  );
};

const BluetoothReaderUnsupported: React.FC<BluetoothReaderProps> = ({ onCancel }) => {
  let errorMessage = 'Bluetooth reader is not supported in this environment.';

  if (Platform.OS === 'web') {
    errorMessage = 'Bluetooth reader is not available on web platform.';
  } else if (isExpoGo) {
    errorMessage = 'Bluetooth reader requires a development build. It cannot be used in Expo Go.';
  }

  return (
    <View className="flex-1">
      <View className="mb-6 items-center rounded-xl bg-gray-50 p-6">
        <Bluetooth size={48} className="mb-4 text-gray-300" />
        <Text className="mb-2 text-center text-xl font-semibold">Not Available</Text>
        <Text className="text-center text-gray-400">{errorMessage}</Text>
      </View>
      <Button variant="outline" onPress={onCancel}>
        Back
      </Button>
    </View>
  );
};

export const BluetoothReader: React.FC<BluetoothReaderProps> = (props) => {
  if (!StripeTerminalAvailable || Platform.OS === 'web' || isExpoGo) {
    return <BluetoothReaderUnsupported {...props} />;
  }

  return <BluetoothReaderNative {...props} />;
};
