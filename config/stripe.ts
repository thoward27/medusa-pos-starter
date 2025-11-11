// Stripe configuration for Medusa POS
// This file contains all Stripe-related configuration

export const STRIPE_CONFIG = {
  // Get from environment variables
  publishableKey: process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY || '',

  // Merchant identifier for Apple Pay (optional)
  merchantIdentifier: 'merchant.com.agilo.pos',

  // URL scheme for handling redirects (matches app.json)
  urlScheme: 'agilopos',

  // Merchant display name
  merchantDisplayName: 'Agilo POS',
};

// Validate configuration
export const validateStripeConfig = (): boolean => {
  if (!STRIPE_CONFIG.publishableKey) {
    console.error('Stripe publishable key is missing. Add EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY to your .env file');
    return false;
  }

  if (!STRIPE_CONFIG.publishableKey.startsWith('pk_')) {
    console.error('Invalid Stripe publishable key format');
    return false;
  }

  return true;
};

// Check if we're in test mode
export const isStripeTestMode = (): boolean => {
  return STRIPE_CONFIG.publishableKey.startsWith('pk_test_');
};

// Get the Stripe provider ID for Medusa
export const STRIPE_PROVIDER_ID = 'pp_stripe_stripe';
