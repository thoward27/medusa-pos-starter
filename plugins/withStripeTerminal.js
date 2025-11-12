const { withInfoPlist, withAndroidManifest, withAppBuildGradle } = require('@expo/config-plugins');

/**
 * Expo Config Plugin for Stripe Terminal
 * Adds necessary permissions and configurations for iOS and Android
 * Also handles camera permissions for barcode scanning functionality
 */
const withStripeTerminal = (config, props = {}) => {
  const merchantDisplayName = props.merchantDisplayName || 'POS App';

  // Configure iOS
  // Based on: https://docs.stripe.com/terminal/payments/setup-integration?terminal-sdk-platform=react-native#ios
  config = withInfoPlist(config, (config) => {
    // 1. Enable location services (required to reduce fraud risks and minimize disputes)
    // Stripe must know where payments occur. If SDK can't determine location, payments are disabled.
    config.modResults.NSLocationWhenInUseUsageDescription =
      props.locationWhenInUsePermission || 'Location access is required to accept payments.';

    // 2. Background mode for Bluetooth readers
    // Allows reader to remain in standby mode when app is in background or device is locked
    if (!config.modResults.UIBackgroundModes) {
      config.modResults.UIBackgroundModes = [];
    }
    if (!config.modResults.UIBackgroundModes.includes('bluetooth-central')) {
      config.modResults.UIBackgroundModes.push('bluetooth-central');
    }

    // 3. Bluetooth Always Usage Description
    // Required for iOS 13+ - Apps linking with Core Bluetooth must include this
    config.modResults.NSBluetoothAlwaysUsageDescription =
      props.bluetoothAlwaysUsagePermission || 'This app uses Bluetooth to connect to supported card readers.';

    // 4. Bluetooth Peripheral Usage Description (for SDK < 3.4.0 compatibility)
    // Required to pass app validation checks when submitting to App Store
    config.modResults.NSBluetoothPeripheralUsageDescription =
      props.bluetoothPeripheralPermission || 'Connecting to supported card readers requires Bluetooth access.';

    // 5. Camera Usage Description (for barcode scanning)
    // Required to scan product barcodes for inventory management
    config.modResults.NSCameraUsageDescription =
      props.cameraUsageDescription || `${merchantDisplayName} needs access to your camera to scan product barcodes`;

    // 6. NFC Reader Usage Description (for Tap to Pay and NFC readers)
    config.modResults.NFCReaderUsageDescription =
      props.nfcUsageDescription || `${merchantDisplayName} needs access to NFC to accept contactless payments`;

    // 7. Add NFC entitlements for Tap to Pay on iPhone support
    if (!config.modResults.com) {
      config.modResults.com = {};
    }
    if (!config.modResults.com.apple) {
      config.modResults.com.apple = {};
    }
    if (!config.modResults.com.apple.developer) {
      config.modResults.com.apple.developer = {};
    }
    config.modResults.com.apple.developer['nfc.readersession.formats'] = ['TAG'];

    return config;
  });

  // Configure Android
  // Based on: https://docs.stripe.com/terminal/payments/setup-integration?terminal-sdk-platform=react-native#android
  config = withAndroidManifest(config, (config) => {
    const androidManifest = config.modResults.manifest;

    // Add permissions required by Stripe Terminal SDK
    if (!androidManifest.$) {
      androidManifest.$ = {};
    }

    // Required permissions for Stripe Terminal SDK as per official documentation:
    //
    // 1. BLUETOOTH_CONNECT (Android 12+): Connect to Bluetooth readers
    // 2. BLUETOOTH_SCAN (Android 12+): Discover Bluetooth readers
    // 3. ACCESS_FINE_LOCATION: Required for all payments
    //    - Stripe needs to know where payments occur to reduce fraud risks and minimize disputes
    //    - If SDK can't determine location, payments are disabled until location access is restored
    // 4. BLUETOOTH & BLUETOOTH_ADMIN: Required for Android 11 and below
    // 5. NFC: For Tap to Pay on Android and NFC-enabled readers
    // 6. INTERNET: Required for API communication
    const permissions = [
      'android.permission.NFC',
      'android.permission.BLUETOOTH',
      'android.permission.BLUETOOTH_ADMIN',
      'android.permission.BLUETOOTH_CONNECT',
      'android.permission.BLUETOOTH_SCAN',
      'android.permission.ACCESS_FINE_LOCATION',
      'android.permission.ACCESS_COARSE_LOCATION',
      'android.permission.INTERNET',
    ];

    if (!androidManifest['uses-permission']) {
      androidManifest['uses-permission'] = [];
    }

    permissions.forEach((permission) => {
      const exists = androidManifest['uses-permission'].some((item) => item.$['android:name'] === permission);
      if (!exists) {
        androidManifest['uses-permission'].push({
          $: { 'android:name': permission },
        });
      }
    });

    // Add hardware feature declarations (optional - required=false won't exclude devices)
    // These inform the Play Store about hardware used but don't restrict installation
    if (!androidManifest['uses-feature']) {
      androidManifest['uses-feature'] = [];
    }

    // NFC hardware feature for Tap to Pay and NFC readers
    const nfcFeatureExists = androidManifest['uses-feature'].some(
      (item) => item.$['android:name'] === 'android.hardware.nfc',
    );

    if (!nfcFeatureExists) {
      androidManifest['uses-feature'].push({
        $: {
          'android:name': 'android.hardware.nfc',
          'android:required': 'false', // Optional - app works on non-NFC devices
        },
      });
    }

    // Bluetooth LE feature for Bluetooth reader support
    const bleFeatureExists = androidManifest['uses-feature'].some(
      (item) => item.$['android:name'] === 'android.hardware.bluetooth_le',
    );

    if (!bleFeatureExists) {
      androidManifest['uses-feature'].push({
        $: {
          'android:name': 'android.hardware.bluetooth_le',
          'android:required': 'false', // Optional - app works without BLE
        },
      });
    }

    // Add NFC library to application element
    // Required for NFC functionality on Android
    if (!androidManifest.application) {
      androidManifest.application = [{ $: {} }];
    }

    const application = androidManifest.application[0];

    if (!application['uses-library']) {
      application['uses-library'] = [];
    }

    const nfcLibExists = application['uses-library'].some(
      (item) => item.$['android:name'] === 'com.android.nfc_extras',
    );

    if (!nfcLibExists) {
      application['uses-library'].push({
        $: {
          'android:name': 'com.android.nfc_extras',
          'android:required': 'false',
        },
      });
    }

    return config;
  });

  // Configure Android build.gradle to resolve packaging conflicts
  // Stripe Terminal SDK may have dependency conflicts that need resolution
  config = withAppBuildGradle(config, (config) => {
    const buildGradle = config.modResults.contents;

    // Add packaging block to resolve BouncyCastle cryptography library conflicts
    // This picks the first occurrence when multiple versions are found in dependencies
    const packagingBlock = `
android {
    packaging {
        resources {
            pickFirst '**/org/bouncycastle/**'
        }
    }
}`;

    // Check if packaging block already exists to avoid duplicates
    if (!buildGradle.includes('packaging {')) {
      // Find the android block and add packaging configuration
      const androidBlockRegex = /android\s*\{/;
      if (androidBlockRegex.test(buildGradle)) {
        // Insert packaging block after the opening android block
        config.modResults.contents = buildGradle.replace(
          androidBlockRegex,
          `android {
    packaging {
        resources {
            pickFirst '**/org/bouncycastle/**'
        }
    }`,
        );
      }
    }

    return config;
  });

  return config;
};

module.exports = withStripeTerminal;
