import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { CreditCard } from '@/components/icons/credit-card';
import { Smartphone } from '@/components/icons/smartphone';
import { Bluetooth } from '@/components/icons/bluetooth';
import { Battery, BatteryLow, BatteryMedium, BatteryFull } from '@/components/icons/battery';
import { X } from '@/components/icons/x';
import React, { useEffect, useState, useCallback } from 'react';
import { ActivityIndicator, View, Alert, Platform, TouchableOpacity, ScrollView, Modal, Pressable } from 'react-native';
import Constants from 'expo-constants';
import { useStripeTerminal, Reader } from '@stripe/stripe-terminal-react-native';

interface CardPaymentProps {
  amount: number;
  currency: string;
  onPaymentSuccess: (paymentIntentId: string) => void;
  onCancel: () => void;
}

type PaymentStatus = 'initializing' | 'noReader' | 'readyToCharge' | 'collecting' | 'processing' | 'success' | 'error';

type ReaderStatus = 'idle' | 'discovering_bluetooth' | 'discovering_tap_to_pay' | 'connecting' | 'connected';

// Check if we're running in Expo Go (which doesn't support native modules)
const isExpoGo = Constants.appOwnership === 'expo';
const STRIPE_TERMINAL_AVAILABLE = !isExpoGo && Platform.OS !== 'web';

// Validate environment variables
const STRIPE_LOCATION_ID = process.env.EXPO_PUBLIC_STRIPE_LOCATION_ID;
if (!STRIPE_LOCATION_ID && STRIPE_TERMINAL_AVAILABLE) {
  console.error(
    'EXPO_PUBLIC_STRIPE_LOCATION_ID is not set. ' +
      'Please add it to your .env file. ' +
      'Get your Location ID from: https://dashboard.stripe.com/terminal/locations',
  );
}

// Helper component to render battery icon based on level
const BatteryIcon: React.FC<{ level?: number; className?: string }> = ({ level, className }) => {
  if (level === undefined || level === null) {
    return <Battery size={16} className={className} />;
  }

  if (level <= 0.25) {
    return <BatteryLow size={16} className={className} />;
  } else if (level <= 0.75) {
    return <BatteryMedium size={16} className={className} />;
  } else {
    return <BatteryFull size={16} className={className} />;
  }
};

// Component to display a reader in the modal list
const ReaderListItem: React.FC<{
  reader: Reader.Type;
  onSelect: () => void;
}> = ({ reader, onSelect }) => {
  const isTapToPay = reader.deviceType === 'tapToPay';

  return (
    <TouchableOpacity
      onPress={onSelect}
      className="flex-row items-center gap-4 rounded-xl border-2 border-gray-200 bg-white p-4"
    >
      {/* Reader icon */}
      <View className="flex-row items-center gap-3">
        {isTapToPay ? (
          <Smartphone size={24} className="text-gray-400" />
        ) : (
          <Bluetooth size={24} className="text-gray-400" />
        )}
      </View>

      {/* Reader details */}
      <View className="flex-1">
        <Text className="text-lg font-medium">{reader.label || (isTapToPay ? 'Tap to Pay' : 'Card Reader')}</Text>
        <View className="flex-row items-center gap-2">
          <Text className="text-sm text-gray-400">{reader.serialNumber || 'Unknown Serial'}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
};

// Reader Selection Box Component
const ReaderSelectionBox: React.FC<{
  connectedReader: Reader.Type | null;
  onPress: () => void;
  onDisconnect: () => void;
}> = ({ connectedReader, onPress, onDisconnect }) => {
  const isTapToPay = connectedReader?.deviceType === 'tapToPay';
  const batteryLevel = connectedReader?.batteryLevel;

  return (
    <TouchableOpacity
      onPress={onPress}
      className="flex-row items-center gap-4 rounded-xl border-2 border-gray-200 bg-white p-4"
    >
      {connectedReader ? (
        <>
          {/* Reader icon */}
          <View className="flex-row items-center gap-3">
            {isTapToPay ? (
              <Smartphone size={24} className="text-gray-400" />
            ) : (
              <Bluetooth size={24} className="text-gray-400" />
            )}
          </View>

          {/* Reader details */}
          <View className="flex-1">
            <View className="flex-row items-center gap-2">
              <Text className="text-lg font-medium">
                {connectedReader.label || (isTapToPay ? 'Tap to Pay' : 'Card Reader')}
              </Text>
              <View className="rounded-full bg-green-100 px-2 py-0.5">
                <Text className="text-xs text-green-700">Connected</Text>
              </View>
            </View>
            <View className="flex-row items-center gap-2">
              <Text className="text-sm text-gray-400">{connectedReader.serialNumber || 'Unknown Serial'}</Text>
              {batteryLevel !== undefined && batteryLevel !== null && !isTapToPay && (
                <View className="flex-row items-center gap-1">
                  <BatteryIcon level={batteryLevel} className="text-gray-400" />
                  <Text className="text-xs text-gray-400">{Math.round(batteryLevel * 100)}%</Text>
                </View>
              )}
            </View>
          </View>

          {/* Disconnect button */}
          <TouchableOpacity
            onPress={(e) => {
              e.stopPropagation();
              onDisconnect();
            }}
            className="h-8 w-8 items-center justify-center rounded-full bg-gray-100"
          >
            <X size={16} className="text-gray-600" />
          </TouchableOpacity>
        </>
      ) : (
        <>
          {/* Connect icon */}
          <View className="flex-row items-center gap-3">
            <CreditCard size={24} className="text-gray-400" />
          </View>

          {/* Connect message */}
          <View className="flex-1">
            <Text className="text-lg text-gray-400">Connect to a reader</Text>
            <Text className="text-sm text-gray-300">Tap to see available readers</Text>
          </View>
        </>
      )}
    </TouchableOpacity>
  );
};

// Reader Selection Modal Component
const ReaderSelectionModal: React.FC<{
  visible: boolean;
  onClose: () => void;
  readerStatus: ReaderStatus;
  discoveredReaders: Reader.Type[];
  onSelectReader: (reader: Reader.Type) => void;
  selectedReader: Reader.Type | null;
}> = ({ visible, onClose, readerStatus, discoveredReaders, onSelectReader, selectedReader }) => {
  console.log('ReaderSelectionModal', {
    visible,
    readerStatus,
    selectedReader,
  });
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/50" onPress={onClose}>
        <View className="flex-1 items-center justify-center p-4">
          <Pressable className="w-full max-w-md rounded-2xl bg-white p-6" onPress={(e) => e.stopPropagation()}>
            {/* Header */}
            <View className="mb-4 flex-row items-center justify-between">
              <Text className="text-xl font-semibold">Select Reader</Text>
              <TouchableOpacity
                onPress={onClose}
                className="h-8 w-8 items-center justify-center rounded-full bg-gray-100"
              >
                <X size={16} className="text-gray-600" />
              </TouchableOpacity>
            </View>

            {/* Discovery Status */}
            <View className="mb-4">
              {readerStatus === 'discovering_bluetooth' && (
                <View className="flex-row items-center gap-3 rounded-xl bg-blue-50 p-3">
                  <ActivityIndicator size="small" color="#3b82f6" />
                  <Text className="text-sm text-blue-700">Discovering Bluetooth readers...</Text>
                </View>
              )}
              {readerStatus === 'discovering_tap_to_pay' && (
                <View className="flex-row items-center gap-3 rounded-xl bg-blue-50 p-3">
                  <ActivityIndicator size="small" color="#3b82f6" />
                  <Text className="text-sm text-blue-700">Discovering Tap to Pay...</Text>
                </View>
              )}
              {readerStatus === 'connecting' && selectedReader && (
                <View className="flex-row items-center gap-3 rounded-xl bg-green-50 p-3">
                  <ActivityIndicator size="small" color="#16a34a" />
                  <Text className="text-sm text-green-700">
                    Connecting to{' '}
                    {selectedReader.label || (selectedReader.deviceType === 'tapToPay' ? 'Tap to Pay' : 'reader')}...
                  </Text>
                </View>
              )}
              {readerStatus === 'connecting' && !selectedReader && (
                <View className="flex-row items-center gap-3 rounded-xl bg-green-50 p-3">
                  <ActivityIndicator size="small" color="#16a34a" />
                  <Text className="text-sm text-green-700">Connecting to reader...</Text>
                </View>
              )}
              {readerStatus === 'connected' && discoveredReaders.length === 0 && (
                <View className="rounded-xl bg-yellow-50 p-3">
                  <Text className="text-sm text-yellow-700">
                    No readers found. Please ensure your reader is powered on and nearby.
                  </Text>
                </View>
              )}
            </View>

            {/* Readers List */}
            <ScrollView className="max-h-96" showsVerticalScrollIndicator={false}>
              <View className="gap-3">
                {discoveredReaders.map((reader) => (
                  <ReaderListItem
                    key={reader.serialNumber}
                    reader={reader}
                    onSelect={() => {
                      onSelectReader(reader);
                    }}
                  />
                ))}
              </View>
            </ScrollView>

            {/* Close Button */}
            <View className="mt-4">
              <Button variant="outline" onPress={onClose}>
                Cancel
              </Button>
            </View>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
};

const CardPaymentNative: React.FC<CardPaymentProps> = ({ amount, currency, onPaymentSuccess, onCancel }) => {
  const [showReaderModal, setShowReaderModal] = useState(false);

  const [readerStatus, setReaderStatus] = useState<ReaderStatus>('idle');
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>('initializing');

  const [errorMessage, setErrorMessage] = useState<string>('');
  const [readerMessage, setReaderMessage] = useState<string>('');

  // All discovered readers. Used for displaying readers in the modal from different discovery methods.
  const [discoveredReaders, setDiscoveredReaders] = useState<Reader.Type[]>([]);
  // Readers last discovered (you can only connect to these).
  const [currentReaders, setCurrentReaders] = useState<Reader.Type[]>([]);
  // The selected reader (what user wants to connect to)
  const [selectedReader, setSelectedReader] = useState<Reader.Type | null>(null);
  // The currently connected reader
  const [connectedReader, setConnectedReader] = useState<Reader.Type | null>(null);
  // Track if we're in the process of connecting
  const [isConnecting, setIsConnecting] = useState(false);

  const {
    discoverReaders,
    connectReader,
    disconnectReader,
    getConnectedReader,
    createPaymentIntent,
    collectPaymentMethod,
    confirmPaymentIntent,
    cancelCollectPaymentMethod,
    cancelDiscovering,
  } = useStripeTerminal({
    onUpdateDiscoveredReaders: (readers: Reader.Type[]) => {
      console.log('Discovered readers:', readers);
      setCurrentReaders([...readers]);
      setDiscoveredReaders((prev) => {
        // Merge new readers with existing ones, avoiding duplicates
        const existing = prev.filter((p) => !readers.find((r) => r.serialNumber === p.serialNumber));
        const merged = [...existing, ...(readers || [])];
        return merged;
      });
    },
    onDidChangeConnectionStatus: (status: Reader.ConnectionStatus) => {
      if (status === 'connecting') {
        setIsConnecting(true);
        setReaderStatus('connecting');
      } else if (status === 'connected') {
        setReaderStatus('connected');
        setPaymentStatus('readyToCharge');
        setReaderMessage('Reader connected. Ready to charge.');
        setShowReaderModal(false);
      } else if (status === 'discovering') {
        console.log('Discovering readers...');
      } else if (status === 'notConnected') {
        console.log('Not connected');
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
      setReaderMessage(messages[key] || input.join(', '));
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
      setConnectedReader(null);
      setSelectedReader(null);
      if (paymentStatus === 'collecting' || paymentStatus === 'processing') {
        setPaymentStatus('error');
        setErrorMessage('Reader disconnected during payment. Please reconnect and try again.');
      } else {
        setPaymentStatus('noReader');
      }
    },
  });

  // Initialize SDK - runs once on mount
  useEffect(() => {
    const initializeSDK = async () => {
      try {
        setPaymentStatus('initializing');
        setReaderMessage('Initializing payment system...');
        // Check if already connected
        const reader = await getConnectedReader();
        // iOS returns empty object {} instead of null when no reader connected
        // Validate reader has actual data (serialNumber is required field)
        if (reader && reader.serialNumber) {
          console.log('Already connected to reader:', reader);
          setConnectedReader(reader);
          setPaymentStatus('readyToCharge');
        } else {
          console.log('No reader connected');
          setPaymentStatus('noReader');
        }
      } catch (error: any) {
        console.error('Initialization error:', error);
        setPaymentStatus('error');
        setErrorMessage(error?.message || 'Failed to initialize payment system');
      }
    };

    initializeSDK();

    return () => {
      // Cleanup - cancel any ongoing collection
      cancelCollectPaymentMethod().catch(console.error);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  // Discover Tap to Pay readers
  const discoverTapToPay = useCallback(async () => {
    await cancelDiscovering();
    setReaderStatus('discovering_tap_to_pay');
    setCurrentReaders([]);
    await discoverReaders({
      discoveryMethod: 'tapToPay',
      simulated: __DEV__,
      timeout: 60,
    }).then(({ error }) => {
      if (error) {
        console.warn('Tap to Pay discovery error:', error);
      }
    });
  }, [discoverReaders, cancelDiscovering]);

  // Discover Bluetooth readers
  const discoverBluetooth = useCallback(async () => {
    await cancelDiscovering();
    setReaderStatus('discovering_bluetooth');
    setCurrentReaders([]);
    await discoverReaders({
      discoveryMethod: 'bluetoothScan',
      simulated: false,
      timeout: 60,
    }).then(({ error }) => {
      if (error) {
        console.warn('Bluetooth discovery error:', error);
      }
    });
  }, [discoverReaders, cancelDiscovering]);

  // Discover all readers when modal opens
  const startDiscovery = useCallback(async () => {
    try {
      await cancelDiscovering();
      setDiscoveredReaders([]);
      await discoverTapToPay();
      await discoverBluetooth();
      setReaderStatus('idle');
    } catch (error: any) {
      console.error('Discovery error:', error);
      setReaderStatus('idle');
      Alert.alert('Discovery Error', error?.message || 'Failed to discover readers');
    }
  }, [cancelDiscovering, discoverTapToPay, discoverBluetooth]);

  // Handle reader selection - simple state setter, no useCallback needed
  const handleSelectReader = (reader: Reader.Type) => {
    console.log('User selected reader:', reader);
    setReaderStatus('connecting');
    setSelectedReader(reader);

    // If reader not in current results, trigger rediscovery
    if (!currentReaders.some((r) => r.serialNumber === reader.serialNumber)) {
      const discoveryMethod = reader.deviceType === 'tapToPay' ? 'tapToPay' : 'bluetoothScan';
      if (discoveryMethod === 'tapToPay') {
        discoverTapToPay();
      } else {
        discoverBluetooth();
      }
    }
  };

  // Auto-connect when selectedReader appears in currentReaders
  useEffect(() => {
    // Don't do anything if no reader is selected
    if (!selectedReader) return;

    // Don't do anything if already connected to this reader
    if (connectedReader?.serialNumber === selectedReader.serialNumber) return;

    // Don't try to connect if already connecting
    if (isConnecting) return;

    // Check if the selected reader is in the current readers list
    const matchingReader = currentReaders.find((r) => r.serialNumber === selectedReader.serialNumber);
    if (!matchingReader) {
      console.log('Selected reader not found in current readers.');
      return;
    }

    // Determine discovery method based on device type
    const discoveryMethod = matchingReader.deviceType === 'tapToPay' ? 'tapToPay' : 'bluetoothScan';
    connectReader(
      {
        reader: matchingReader,
        locationId: STRIPE_LOCATION_ID!,
      },
      discoveryMethod,
    )
      .then(({ error: connectError, reader }) => {
        if (connectError) {
          throw new Error(`Failed to connect: ${connectError.message}`);
        } else {
          console.log('Successfully connected to reader:', matchingReader);
          setConnectedReader(reader);
        }
      })
      .catch((error: any) => {
        console.error('Auto-connect error:', error);
        setReaderStatus('idle');
        Alert.alert('Connection Error', error?.message || 'Failed to connect to reader');
      })
      .finally(() => {
        setIsConnecting(false);
      });
  }, [selectedReader, currentReaders, connectedReader, isConnecting, connectReader]);

  // Handle reader disconnect - needs useCallback (passed to child)
  const handleDisconnect = useCallback(async () => {
    try {
      await disconnectReader();
      setConnectedReader(null);
      setSelectedReader(null);
      setPaymentStatus('noReader');
      console.log('Disconnected from reader');
    } catch (error: any) {
      console.error('Disconnect error:', error);
      Alert.alert('Disconnect Error', error?.message || 'Failed to disconnect from reader');
    }
  }, [disconnectReader]);

  // Handle reader selection box press - needs useCallback (passed to JSX)
  const handleReaderBoxPress = useCallback(() => {
    if (!connectedReader) {
      setShowReaderModal(true);
      startDiscovery();
    }
  }, [connectedReader, startDiscovery]);

  // Start payment collection - needs useCallback (passed to Button)
  const handleCharge = useCallback(async () => {
    if (!connectedReader) {
      Alert.alert('No Reader Connected', 'Please connect to a card reader first.');
      return;
    }

    try {
      setPaymentStatus('collecting');
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

      // For tap to pay, Stripe shows its own UI
      if (connectedReader.deviceType === 'tapToPay') {
        setReaderMessage('Present card to device');
      } else {
        setReaderMessage('Present card to reader...');
      }

      // Collect Payment Method
      const { paymentIntent: collectedIntent, error: collectError } = await collectPaymentMethod({
        paymentIntent: createdIntent,
      });

      if (collectError || !collectedIntent) {
        throw new Error(`Failed to collect payment: ${collectError?.message || 'Unknown error'}`);
      }

      console.log('Payment method collected');
      setPaymentStatus('processing');
      setReaderMessage('Processing payment...');

      // Confirm Payment Intent
      const { paymentIntent: processedIntent, error: processError } = await confirmPaymentIntent({
        paymentIntent: collectedIntent,
      });

      if (processError || !processedIntent) {
        throw new Error(`Failed to process payment: ${processError?.message || 'Unknown error'}`);
      }

      if (processedIntent.status === 'succeeded') {
        console.log('Payment processed successfully:', processedIntent.id);
        setPaymentStatus('success');
        setReaderMessage('Payment successful!');

        // Call success callback
        setTimeout(() => {
          onPaymentSuccess(processedIntent.id);
        }, 1500);
      } else {
        throw new Error(`Payment status: ${processedIntent.status}`);
      }
    } catch (error: any) {
      console.error('Payment error:', error);
      const errorMsg = error?.message || 'Payment failed';
      setPaymentStatus('error');
      setErrorMessage(errorMsg);

      Alert.alert('Payment Failed', errorMsg, [
        {
          text: 'Try Again',
          onPress: () => {
            setPaymentStatus('readyToCharge');
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
  }, [
    connectedReader,
    amount,
    currency,
    createPaymentIntent,
    collectPaymentMethod,
    confirmPaymentIntent,
    onPaymentSuccess,
    onCancel,
  ]);

  // Handle cancel - needs useCallback (passed to Button and Alert)
  const handleCancel = useCallback(async () => {
    try {
      if (paymentStatus === 'collecting') {
        await cancelCollectPaymentMethod();
      }
      onCancel();
    } catch (error) {
      console.error('Cancel error:', error);
      onCancel();
    }
  }, [paymentStatus, cancelCollectPaymentMethod, onCancel]);

  // Render loading state
  if (paymentStatus === 'initializing') {
    return (
      <View className="flex-1">
        <View className="mb-6 rounded-xl bg-gray-50 p-6">
          <View className="mb-4 flex-row items-center justify-center gap-3">
            <CreditCard size={32} className="text-gray-400" />
            <Text className="text-xl font-semibold">Card Payment</Text>
          </View>

          <View className="mb-4">
            <Text className="mb-2 text-center text-sm text-gray-400">Payment Amount</Text>
            <Text className="text-center text-3xl font-bold">
              {(amount / 100).toLocaleString('en-US', {
                style: 'currency',
                currency: currency,
              })}
            </Text>
          </View>

          <View className="items-center gap-4">
            <ActivityIndicator size="large" color="#000" />
            <Text className="text-center text-gray-400">{readerMessage}</Text>
          </View>
        </View>
        <Button variant="outline" onPress={onCancel}>
          Cancel
        </Button>
      </View>
    );
  }

  // Render error state
  if (paymentStatus === 'error' && !connectedReader) {
    return (
      <View className="flex-1">
        <View className="mb-6 rounded-xl bg-gray-50 p-6">
          <View className="mb-4 flex-row items-center justify-center gap-3">
            <CreditCard size={32} className="text-gray-400" />
            <Text className="text-xl font-semibold">Card Payment</Text>
          </View>

          <View className="mb-4">
            <Text className="mb-2 text-center text-sm text-gray-400">Payment Amount</Text>
            <Text className="text-center text-3xl font-bold">
              {(amount / 100).toLocaleString('en-US', {
                style: 'currency',
                currency: currency,
              })}
            </Text>
          </View>

          <View className="items-center gap-4">
            <View className="h-16 w-16 items-center justify-center rounded-full bg-red-100">
              <Text className="text-3xl">✕</Text>
            </View>
            <Text className="text-center font-semibold text-red-600">Error</Text>
            <Text className="text-center text-sm text-gray-400">{errorMessage}</Text>
          </View>
        </View>
        <View className="flex-row gap-2">
          <Button variant="outline" className="flex-1" onPress={onCancel}>
            Cancel
          </Button>
          <Button className="flex-1" onPress={() => window.location.reload()}>
            Retry
          </Button>
        </View>
      </View>
    );
  }

  return (
    <View className="flex-1">
      {/* Reader Selection Box */}
      {(paymentStatus === 'noReader' || paymentStatus === 'readyToCharge') && (
        <View className="mb-6">
          <Text className="mb-3 text-lg font-semibold">Card Reader</Text>
          <ReaderSelectionBox
            connectedReader={connectedReader}
            onPress={handleReaderBoxPress}
            onDisconnect={handleDisconnect}
          />
        </View>
      )}

      {/* Card Payment - Combined Box */}
      <View className="mb-6 rounded-xl bg-gray-50 p-6">
        <View className="mb-4 flex-row items-center justify-center gap-3">
          <CreditCard size={32} className="text-gray-400" />
          <Text className="text-xl font-semibold">Card Payment</Text>
        </View>

        {/* Amount Display */}
        <View className="mb-4">
          <Text className="mb-2 text-center text-sm text-gray-400">Payment Amount</Text>
          <Text className="text-center text-3xl font-bold">
            {(amount / 100).toLocaleString('en-US', {
              style: 'currency',
              currency: currency,
            })}
          </Text>
        </View>

        {/* Status indicators for active payment */}
        {(paymentStatus === 'collecting' || paymentStatus === 'processing') && (
          <View className="items-center gap-4">
            <ActivityIndicator size="large" color="#000" />
            <Text className="text-center text-gray-400">{readerMessage}</Text>
          </View>
        )}

        {paymentStatus === 'success' && (
          <View className="items-center gap-4">
            <View className="h-16 w-16 items-center justify-center rounded-full bg-green-100">
              <Text className="text-3xl">✓</Text>
            </View>
            <Text className="text-center font-semibold text-green-600">{readerMessage}</Text>
          </View>
        )}
      </View>

      {/* Action Buttons */}
      <View className="pb-safe flex-row gap-2">
        <Button
          variant="outline"
          className="flex-1"
          onPress={handleCancel}
          disabled={paymentStatus === 'processing' || paymentStatus === 'success'}
        >
          Cancel
        </Button>

        {paymentStatus === 'readyToCharge' && connectedReader && (
          <Button className="flex-1" onPress={handleCharge}>
            Charge Card
          </Button>
        )}
      </View>

      {/* Reader Selection Modal */}
      <ReaderSelectionModal
        visible={showReaderModal}
        onClose={async () => {
          await cancelDiscovering();
          setSelectedReader(null);
          setShowReaderModal(false);
          setReaderStatus('idle');
        }}
        readerStatus={readerStatus}
        discoveredReaders={discoveredReaders}
        onSelectReader={handleSelectReader}
        selectedReader={selectedReader}
      />
    </View>
  );
};

const CardPaymentUnsupported: React.FC<CardPaymentProps> = ({ onCancel }) => {
  let errorMessage = 'Card payment is not supported in this environment.';

  if (Platform.OS === 'web') {
    errorMessage = 'Card payment is not available on web platform.';
  } else if (isExpoGo) {
    errorMessage = 'Card payment requires a development build. It cannot be used in Expo Go.';
  }

  return (
    <View className="flex-1">
      <View className="mb-6 items-center rounded-xl bg-gray-50 p-6">
        <CreditCard size={48} className="mb-4 text-gray-300" />
        <Text className="mb-2 text-center text-xl font-semibold">Not Available</Text>
        <Text className="text-center text-gray-400">{errorMessage}</Text>
      </View>
      <Button variant="outline" onPress={onCancel}>
        Back
      </Button>
    </View>
  );
};

export const CardPayment: React.FC<CardPaymentProps> = (props) => {
  if (!STRIPE_TERMINAL_AVAILABLE || Platform.OS === 'web' || isExpoGo) {
    return <CardPaymentUnsupported {...props} />;
  }

  return <CardPaymentNative {...props} />;
};
