import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { CreditCard } from '@/components/icons/credit-card';
import { Smartphone } from '@/components/icons/smartphone';
import { Bluetooth } from '@/components/icons/bluetooth';
import { Battery, BatteryLow, BatteryMedium, BatteryFull } from '@/components/icons/battery';
import { X } from '@/components/icons/x';
import React, { useEffect, useState, useCallback, useRef, useImperativeHandle, forwardRef } from 'react';
import {
  ActivityIndicator,
  View,
  Alert,
  Platform,
  TouchableOpacity,
  ScrollView,
  Modal,
  Pressable,
  useWindowDimensions,
} from 'react-native';
import Constants from 'expo-constants';
import { useStripeTerminal, Reader } from '@stripe/stripe-terminal-react-native';

interface CardPaymentProps {
  amount: number;
  currency: string;
  onPaymentSuccess: (paymentIntentId: string) => void;
  onCancel: () => void;
  // Reports charge readiness / busy state so the screen can render the action
  // button in its bottom footer (mirroring the cash checkout layout).
  onStatusChange?: (status: { canCharge: boolean; busy: boolean }) => void;
}

// Imperative handle so the screen's footer button can trigger the charge.
export type CardPaymentHandle = { charge: () => void };

type PaymentStatus = 'initializing' | 'noReader' | 'readyToCharge' | 'collecting' | 'processing' | 'success' | 'error';

type ReaderStatus = 'idle' | 'discovering_bluetooth' | 'discovering_tap_to_pay' | 'connecting' | 'connected';

// Check if we're running in Expo Go (which doesn't support native modules)
const isExpoGo = Constants.appOwnership === 'expo';
const STRIPE_TERMINAL_AVAILABLE = !isExpoGo && Platform.OS !== 'web';

// The Stripe Terminal SDK only allows ONE discovery method to be active at a
// time, and discoverReaders() does not resolve until that discovery is
// cancelled. To surface both Tap to Pay and Bluetooth readers we cycle between
// the two methods, giving each a scan window before switching. Tap to Pay
// resolves to the local reader almost instantly; Bluetooth needs longer to find
// nearby hardware.
const TAP_TO_PAY_SCAN_MS = 3000;
const BLUETOOTH_SCAN_MS = 8000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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
  const { height: windowHeight } = useWindowDimensions();

  // Derive a single always-present banner so the header never appears/disappears
  // or changes size as discovery cycles between methods. Only the text/colour
  // inside the fixed-size container changes — never the layout.
  const banner = (() => {
    const count = discoveredReaders.length;
    const suffix = count > 0 ? ` · ${count} found` : '';
    switch (readerStatus) {
      case 'connecting': {
        const name = selectedReader?.label || (selectedReader?.deviceType === 'tapToPay' ? 'Tap to Pay' : 'reader');
        return {
          tone: 'bg-green-50',
          spinnerColor: '#16a34a',
          textClass: 'text-green-700',
          text: `Connecting to ${name}...`,
        };
      }
      case 'connected':
        return { tone: 'bg-green-50', spinnerColor: '#16a34a', textClass: 'text-green-700', text: 'Reader connected.' };
      case 'discovering_bluetooth':
        return {
          tone: 'bg-blue-50',
          spinnerColor: '#3b82f6',
          textClass: 'text-blue-700',
          text: `Discovering Bluetooth readers...${suffix}`,
        };
      case 'discovering_tap_to_pay':
        return {
          tone: 'bg-blue-50',
          spinnerColor: '#3b82f6',
          textClass: 'text-blue-700',
          text: `Discovering Tap to Pay...${suffix}`,
        };
      default:
        return {
          tone: 'bg-blue-50',
          spinnerColor: '#3b82f6',
          textClass: 'text-blue-700',
          text: `Searching for readers...${suffix}`,
        };
    }
  })();

  const showSpinner = readerStatus !== 'connected';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/50" onPress={onClose}>
        <View className="flex-1 items-center justify-center p-4">
          {/* Fixed-height card: header, banner and footer stay put while the
              middle list region absorbs newly discovered readers without
              resizing the modal (which would re-centre it and move targets). */}
          <Pressable
            className="w-full max-w-md flex-col rounded-2xl bg-white p-6"
            style={{ height: windowHeight * 0.7 }}
            onPress={(e) => e.stopPropagation()}
          >
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

            {/* Discovery Status — fixed-size header, always present */}
            <View className={`mb-4 h-12 flex-row items-center gap-3 rounded-xl px-3 ${banner.tone}`}>
              {showSpinner ? (
                <ActivityIndicator size="small" color={banner.spinnerColor} />
              ) : (
                <Text className="text-base">✓</Text>
              )}
              <Text className={`flex-1 text-sm ${banner.textClass}`} numberOfLines={1}>
                {banner.text}
              </Text>
            </View>

            {/* Readers List — fills the remaining fixed space. New readers are
                appended to the bottom; we never auto-scroll, so already-visible
                cards keep their position. */}
            <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
              {discoveredReaders.length === 0 ? (
                <View className="flex-1 items-center justify-center py-8">
                  <Text className="text-sm text-gray-400">Looking for nearby readers...</Text>
                </View>
              ) : (
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
              )}
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

const CardPaymentNative = forwardRef<CardPaymentHandle, CardPaymentProps>(function CardPaymentNative(
  { amount, currency, onPaymentSuccess, onCancel, onStatusChange },
  ref,
) {
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

  // Whether the cycling discovery loop is currently running.
  const discoveryLoopRef = useRef(false);
  // Mirrors of state the discovery loop reads, kept in sync via the effects
  // below so the long-lived loop always sees the latest values.
  const selectedReaderRef = useRef<Reader.Type | null>(null);
  const currentReadersRef = useRef<Reader.Type[]>([]);

  useEffect(() => {
    selectedReaderRef.current = selectedReader;
  }, [selectedReader]);

  useEffect(() => {
    currentReadersRef.current = currentReaders;
  }, [currentReaders]);

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
        // Stable merge: keep already-listed readers in their original position
        // (updated in place so fields like battery refresh) and only APPEND
        // genuinely new readers. This avoids reordering the list — and therefore
        // moving click targets — when a reader is re-reported across discovery
        // cycles.
        const next = [...prev];
        for (const reader of readers || []) {
          const idx = next.findIndex((p) => p.serialNumber === reader.serialNumber);
          if (idx === -1) {
            next.push(reader);
          } else {
            next[idx] = reader;
          }
        }
        return next;
      });
    },
    onDidChangeConnectionStatus: (status: Reader.ConnectionStatus) => {
      if (status === 'connecting') {
        setIsConnecting(true);
        setReaderStatus('connecting');
      } else if (status === 'connected') {
        // Stop the cycling discovery loop now that we have a reader.
        discoveryLoopRef.current = false;
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
      // Cleanup - stop discovery and cancel any ongoing collection
      discoveryLoopRef.current = false;
      cancelDiscovering().catch(() => {});
      cancelCollectPaymentMethod().catch(console.error);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  // Stop the cycling discovery loop and cancel any active discovery.
  const stopDiscovery = useCallback(async () => {
    discoveryLoopRef.current = false;
    await cancelDiscovering().catch(() => {});
  }, [cancelDiscovering]);

  // Continuously discover readers until the user selects one (or the loop is
  // stopped). The Stripe SDK only allows one discovery method at a time and
  // discoverReaders() doesn't resolve until discovery is cancelled, so we can't
  // run both methods in parallel or await them sequentially. Instead we start a
  // method, let it scan for a window, cancel it, and switch to the other —
  // accumulating results into `discoveredReaders` the whole time. Once a reader
  // is selected we lock onto its method so the auto-connect effect can connect.
  const startDiscovery = useCallback(async () => {
    if (discoveryLoopRef.current) return;
    discoveryLoopRef.current = true;
    setDiscoveredReaders([]);

    // Fire-and-forget a discovery method. `discoverReaders` resolves only when
    // discovery is cancelled, so we don't await its completion here.
    const beginDiscovery = async (method: 'tapToPay' | 'bluetoothScan') => {
      await cancelDiscovering().catch(() => {});
      // Bail if the loop was stopped or a reader was selected while cancelling.
      if (!discoveryLoopRef.current) return;
      setCurrentReaders([]);
      discoverReaders({
        discoveryMethod: method,
        simulated: method === 'tapToPay' ? __DEV__ : false,
        // 0 = scan continuously; we drive cancellation ourselves.
        ...(method === 'bluetoothScan' ? { timeout: 0 } : {}),
      }).then(({ error }) => {
        if (error) {
          console.warn(`${method} discovery error:`, error);
        }
      });
    };

    // Sleep in small steps so the loop reacts quickly to a selection or stop.
    const waitWhileScanning = async (ms: number) => {
      const step = 250;
      for (let elapsed = 0; elapsed < ms; elapsed += step) {
        if (!discoveryLoopRef.current || selectedReaderRef.current) return;
        await sleep(step);
      }
    };

    try {
      while (discoveryLoopRef.current) {
        const selected = selectedReaderRef.current;

        if (selected) {
          // Lock onto the selected reader's method so it stays connectable, and
          // let the auto-connect effect take over. The connection-status handler
          // stops the loop once connected; a failed connection clears the
          // selection so we resume cycling.
          const method = selected.deviceType === 'tapToPay' ? 'tapToPay' : 'bluetoothScan';
          setReaderStatus('connecting');
          const alreadyConnectable = currentReadersRef.current.some((r) => r.serialNumber === selected.serialNumber);
          // Avoid disrupting an in-progress connection: only (re)discover if the
          // reader isn't already in the active discovery results.
          if (!alreadyConnectable) {
            await beginDiscovery(method);
          }
          while (discoveryLoopRef.current && selectedReaderRef.current) {
            await sleep(250);
          }
        } else {
          // Cycle between methods so every reader type is discovered.
          setReaderStatus('discovering_tap_to_pay');
          await beginDiscovery('tapToPay');
          await waitWhileScanning(TAP_TO_PAY_SCAN_MS);
          if (!discoveryLoopRef.current || selectedReaderRef.current) continue;

          setReaderStatus('discovering_bluetooth');
          await beginDiscovery('bluetoothScan');
          await waitWhileScanning(BLUETOOTH_SCAN_MS);
        }
      }
    } catch (error: any) {
      console.error('Discovery error:', error);
      Alert.alert('Discovery Error', error?.message || 'Failed to discover readers');
    } finally {
      await cancelDiscovering().catch(() => {});
      discoveryLoopRef.current = false;
    }
  }, [cancelDiscovering, discoverReaders]);

  // Handle reader selection. The discovery loop owns all discovery, so we just
  // record the selection (and restart the loop if it isn't running); the loop
  // locks onto the reader's method and the auto-connect effect connects.
  const handleSelectReader = useCallback(
    (reader: Reader.Type) => {
      console.log('User selected reader:', reader);
      setReaderStatus('connecting');
      setSelectedReader(reader);
      selectedReaderRef.current = reader;
      if (!discoveryLoopRef.current) {
        startDiscovery();
      }
    },
    [startDiscovery],
  );

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
        // Clear the selection so the discovery loop resumes cycling and the
        // user can pick another reader.
        setSelectedReader(null);
        selectedReaderRef.current = null;
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

  // Expose the charge action so the screen footer can trigger it.
  useImperativeHandle(ref, () => ({ charge: handleCharge }), [handleCharge]);

  // Report charge readiness / busy state up to the screen so it can render the
  // primary action button in its bottom footer (like the cash flow).
  useEffect(() => {
    const canCharge = paymentStatus === 'readyToCharge' && !!connectedReader;
    const busy = paymentStatus === 'collecting' || paymentStatus === 'processing' || paymentStatus === 'success';
    onStatusChange?.({ canCharge, busy });
  }, [paymentStatus, connectedReader, onStatusChange]);

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

      {/* Reader Selection Modal */}
      <ReaderSelectionModal
        visible={showReaderModal}
        onClose={async () => {
          await stopDiscovery();
          setSelectedReader(null);
          selectedReaderRef.current = null;
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
});

const CardPaymentUnsupported: React.FC = () => {
  let errorMessage = 'Card payment is not supported in this environment.';

  if (Platform.OS === 'web') {
    errorMessage = 'Card payment is not available on web platform.';
  } else if (isExpoGo) {
    errorMessage = 'Card payment requires a development build. It cannot be used in Expo Go.';
  }

  // The screen's footer provides the Back button (mirroring the cash flow).
  return (
    <View className="items-center rounded-xl bg-gray-50 p-6">
      <CreditCard size={48} className="mb-4 text-gray-300" />
      <Text className="mb-2 text-center text-xl font-semibold">Not Available</Text>
      <Text className="text-center text-gray-400">{errorMessage}</Text>
    </View>
  );
};

export const CardPayment = forwardRef<CardPaymentHandle, CardPaymentProps>(function CardPayment(props, ref) {
  if (!STRIPE_TERMINAL_AVAILABLE || Platform.OS === 'web' || isExpoGo) {
    return <CardPaymentUnsupported />;
  }

  return <CardPaymentNative {...props} ref={ref} />;
});
