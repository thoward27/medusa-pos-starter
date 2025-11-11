const { withInfoPlist, withAndroidManifest, withAppBuildGradle } = require('@expo/config-plugins');

/**
 * Expo Config Plugin for Stripe Terminal
 * Adds necessary permissions and configurations for iOS and Android
 */
const withStripeTerminal = (config, props = {}) => {
  const merchantDisplayName = props.merchantDisplayName || 'POS App';

  // Configure iOS
  config = withInfoPlist(config, (config) => {
    config.modResults.NFCReaderUsageDescription =
      props.nfcUsageDescription || `${merchantDisplayName} needs access to NFC to accept contactless payments`;

    // Add NFC entitlements
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
  config = withAndroidManifest(config, (config) => {
    const androidManifest = config.modResults.manifest;

    // Add permissions
    if (!androidManifest.$) {
      androidManifest.$ = {};
    }

    const permissions = [
      'android.permission.NFC',
      'android.permission.BLUETOOTH',
      'android.permission.BLUETOOTH_ADMIN',
      'android.permission.BLUETOOTH_CONNECT',
      'android.permission.BLUETOOTH_SCAN',
      'android.permission.ACCESS_FINE_LOCATION',
      'android.permission.ACCESS_COARSE_LOCATION',
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

    // Add NFC feature requirement (optional - won't exclude non-NFC devices)
    if (!androidManifest['uses-feature']) {
      androidManifest['uses-feature'] = [];
    }

    const nfcFeatureExists = androidManifest['uses-feature'].some(
      (item) => item.$['android:name'] === 'android.hardware.nfc',
    );

    if (!nfcFeatureExists) {
      androidManifest['uses-feature'].push({
        $: {
          'android:name': 'android.hardware.nfc',
          'android:required': 'false',
        },
      });
    }

    // Add Bluetooth LE feature
    const bleFeatureExists = androidManifest['uses-feature'].some(
      (item) => item.$['android:name'] === 'android.hardware.bluetooth_le',
    );

    if (!bleFeatureExists) {
      androidManifest['uses-feature'].push({
        $: {
          'android:name': 'android.hardware.bluetooth_le',
          'android:required': 'false',
        },
      });
    }

    // Add NFC library to application
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
  config = withAppBuildGradle(config, (config) => {
    const buildGradle = config.modResults.contents;

    // Add packaging block to resolve BouncyCastle conflicts
    const packagingBlock = `
android {
    packaging {
        resources {
            pickFirst '**/org/bouncycastle/**'
        }
    }
}`;

    // Check if packaging block already exists
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
