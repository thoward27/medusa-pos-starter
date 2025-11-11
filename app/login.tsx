import { Form } from '@/components/form/Form';
import { FormButton } from '@/components/form/FormButton';
import { TextField } from '@/components/form/TextField';
import { InfoBanner } from '@/components/InfoBanner';
import { LayoutWithKeyboardAvoidingScroll } from '@/components/ui/Layout';
import { Text } from '@/components/ui/Text';
import { useAuthCtx } from '@/contexts/auth';
import React, { useState } from 'react';
import { View } from 'react-native';
import * as z from 'zod/v4';

const normalizeUrl = (url: string): string => {
  if (!url) return url;
  // In development mode, preserve http:// if present, otherwise remove protocol
  if (__DEV__) {
    // Check if URL starts with http:// (not https://)
    if (url.match(/^http:\/\//)) {
      return url; // Keep http:// in dev mode
    }
  }
  // Remove http:// or https:// if present
  return url.replace(/^https?:\/\//, '');
};

const validateMedusaUrl = async (url: string): Promise<boolean> => {
  try {
    const normalizedUrl = normalizeUrl(url);
    if (!normalizedUrl) {
      console.error('Invalid URL: empty or undefined');
      return false;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    // In dev mode, check if URL already has http:// protocol
    const fullUrl =
      normalizedUrl.startsWith('http://') || normalizedUrl.startsWith('https://')
        ? normalizedUrl
        : `https://${normalizedUrl}`;

    const response = await fetch(`${fullUrl}/health`, {
      method: 'GET',
      signal: controller.signal,
      credentials: 'omit',
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.error(`Invalid response from Medusa URL: ${response.status}`);
      console.error('Response body:', await response.text());
      return false;
    }

    const text = await response.text();
    return text.trim().toLowerCase() === 'ok';
  } catch (error) {
    console.error('Error validating Medusa URL:', error);
    return false;
  }
};

const loginSchema = z.object({
  medusaUrl: z
    .string()
    .min(1, 'Shop URL is required')
    .transform(normalizeUrl)
    .refine(
      async (url) => {
        if (!url) return false;

        try {
          // In dev mode, check if URL already has http:// protocol
          const fullUrl = url.startsWith('http://') || url.startsWith('https://') ? url : `https://${url}`;
          new URL(fullUrl);
        } catch {
          console.error('Invalid URL format');
          return false;
        }

        return await validateMedusaUrl(url);
      },
      {
        message: 'Please enter a valid Medusa shop URL',
      },
    ),
  email: z.email('Please enter a valid email address').min(3, 'Email is required'),
  password: z.string().min(1, 'Password is required'),
});

type LoginFormData = z.infer<typeof loginSchema>;

export default function LoginScreen() {
  const auth = useAuthCtx();

  const [error, setError] = useState<string | null>(null);

  const handleLogin = async (data: LoginFormData) => {
    setError(null);
    // In dev mode, check if URL already has http:// or https:// protocol
    const fullUrl =
      data.medusaUrl.startsWith('http://') || data.medusaUrl.startsWith('https://')
        ? data.medusaUrl
        : `https://${data.medusaUrl}`;
    try {
      await auth.login(fullUrl, data.email, data.password);
    } catch (err: any) {
      setError(err?.message || 'Login failed. Please try again.');
    }
  };

  const defaultValues: Partial<LoginFormData> = {
    medusaUrl:
      auth.state.status !== 'loading' ? (auth.state.medusaUrl ?? process.env.EXPO_PUBLIC_MEDUSA_BACKEND_URL ?? '') : '',
    email: '',
    password: '',
  };

  return (
    <LayoutWithKeyboardAvoidingScroll>
      <View className="items-center">
        <View className="w-full max-w-xl gap-6">
          <Text className="text-4xl">Login</Text>
          {error && <InfoBanner colorScheme="error">{error}</InfoBanner>}
          <Form
            key={auth.state.status === 'loading' ? 'loading' : 'form'}
            schema={loginSchema}
            onSubmit={handleLogin}
            defaultValues={defaultValues}
            className="gap-6"
          >
            <TextField
              name="medusaUrl"
              floatingPlaceholder
              placeholder="Shop URL"
              keyboardType="url"
              autoCapitalize="none"
              autoCorrect={false}
              readOnly={auth.state.status === 'loading'}
              textContentType="URL"
              autoComplete="url"
              testID="loginShopUrl"
            />

            <TextField
              name="email"
              floatingPlaceholder
              placeholder="Email Address"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              readOnly={auth.state.status === 'loading'}
              textContentType="emailAddress"
              autoComplete="email"
              testID="loginEmail"
            />

            <TextField
              name="password"
              floatingPlaceholder
              placeholder="Password"
              secureTextEntry
              autoCapitalize="none"
              readOnly={auth.state.status === 'loading'}
              textContentType="password"
              autoComplete="password"
              testID="loginPassword"
            />

            <FormButton isPending={auth.state.status === 'loading'}>Sign In</FormButton>
          </Form>
        </View>
      </View>
    </LayoutWithKeyboardAvoidingScroll>
  );
}
