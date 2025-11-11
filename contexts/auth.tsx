import { isUnauthorizedError } from '@/utils/errors';
import { storage } from '@/utils/storage';
import Medusa from '@medusajs/js-sdk';
import * as React from 'react';
import Toast from 'react-native-toast-message';

export type AuthStateType =
  | {
      status: 'loading';
    }
  | {
      status: 'unauthenticated';
      medusaUrl?: string;
      userEmail?: string;
    }
  | {
      status: 'authenticated';
      user: {
        id: string;
        name: string;
        email: string;
      };
      medusaUrl: string;
      userEmail: string;
      apiKey: string;
    };

export type AuthContextType = {
  state: AuthStateType;
  login: (medusaUrl: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

export const AuthContext = React.createContext<AuthContextType>({
  state: { status: 'loading' },
  login: async () => {
    throw new Error('login function not implemented');
  },
  logout: async () => {
    throw new Error('logout function not implemented');
  },
});

export const AuthProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [state, setState] = React.useState<AuthStateType>({
    status: 'loading',
  });

  const login = React.useCallback(
    async (medusaUrl: string, email: string, password: string) => {
      if (state.status === 'authenticated') {
        throw new Error('User is already authenticated');
      }

      try {
        const sdk = new Medusa({
          baseUrl: medusaUrl,
          debug: false,
          auth: {
            type: 'jwt',
            jwtTokenStorageMethod: 'nostore',
          },
        });

        const loginResponse = await sdk.auth.login('user', 'emailpass', {
          email,
          password,
        });

        if (typeof loginResponse !== 'string') {
          throw new Error('Handle this redirect later');
        }

        const apiKey = loginResponse;

        const userResponse = await sdk.admin.user.me(undefined, {
          Authorization: `Bearer ${apiKey}`,
        });

        await storage.setItemAsync('medusaUrl', medusaUrl);
        await storage.setItemAsync('userEmail', email);
        await storage.setItemAsync('apiKey', apiKey);

        setState({
          status: 'authenticated',
          user: {
            id: userResponse.user.id,
            name:
              [userResponse.user.first_name, userResponse.user.last_name].filter(Boolean).join(' ') ||
              userResponse.user.email.split('@')[0],
            email: userResponse.user.email,
          },
          userEmail: email,
          medusaUrl,
          apiKey,
        });
      } catch (error) {
        console.error('Login failed:', error);

        if (isUnauthorizedError(error)) {
          Toast.show({
            type: 'error',
            text1: 'Login Failed',
            text2: 'Invalid email or password',
            visibilityTime: 4000,
          });
        } else {
          const message = error instanceof Error ? error.message : 'Login failed. Please try again.';
          Toast.show({
            type: 'error',
            text1: 'Login Error',
            text2: message,
            visibilityTime: 4000,
          });
        }
      }
    },
    [state.status],
  );

  const logout = React.useCallback(async () => {
    if (state.status !== 'authenticated') {
      throw new Error('User is not authenticated');
    }

    await storage.deleteItemAsync('apiKey');
    setState({ status: 'unauthenticated' });
  }, [state.status]);

  React.useEffect(() => {
    let cancelled = false;

    const loadAuthState = async () => {
      try {
        const medusaUrl = await storage.getItemAsync('medusaUrl');
        const userEmail = await storage.getItemAsync('userEmail');
        const apiKey = await storage.getItemAsync('apiKey');

        if (cancelled) {
          return;
        }

        if (medusaUrl && apiKey) {
          const sdk = new Medusa({
            baseUrl: medusaUrl,
            debug: false,
            auth: {
              type: 'jwt',
              jwtTokenStorageMethod: 'custom',
              storage: {
                getItem: () => apiKey,
                setItem: () => {},
                removeItem: () => {},
              },
            },
          });

          if (cancelled) {
            return;
          }

          const userResponse = await sdk.admin.user.me();

          if (cancelled) {
            return;
          }

          setState({
            status: 'authenticated',
            user: {
              id: userResponse.user.id,
              name:
                [userResponse.user.first_name, userResponse.user.last_name].filter(Boolean).join(' ') ||
                userResponse.user.email.split('@')[0],
              email: userResponse.user.email,
            },
            userEmail: userResponse.user.email,
            medusaUrl,
            apiKey,
          });
        } else {
          if (cancelled) {
            return;
          }

          await storage.deleteItemAsync('apiKey');

          setState({
            status: 'unauthenticated',
            medusaUrl: medusaUrl ?? undefined,
            userEmail: userEmail ?? undefined,
          });
        }
      } catch (error) {
        if (cancelled) {
          return;
        }

        await storage.deleteItemAsync('apiKey');

        if (isUnauthorizedError(error)) {
          Toast.show({
            type: 'error',
            text1: 'Session Expired',
            text2: 'Your session has expired. Please log in again.',
            visibilityTime: 4000,
          });
        } else {
          console.error('Failed to load auth state:', error);
          Toast.show({
            type: 'error',
            text1: 'Authentication Error',
            text2: 'Failed to load authentication state. Please try again.',
            visibilityTime: 4000,
          });
        }

        setState({ status: 'unauthenticated', medusaUrl: undefined });
      }
    };

    loadAuthState();

    return () => {
      cancelled = true;
    };
  }, []);

  return <AuthContext.Provider value={{ state, login, logout }}>{children}</AuthContext.Provider>;
};

export const useAuthCtx = () => {
  const context = React.useContext(AuthContext);
  if (!context) {
    throw new Error('useAuthCtx must be used within an AuthProvider');
  }
  return context;
};

export const useAuthenticated = () => {
  const { state } = useAuthCtx();

  if (state.status !== 'authenticated') {
    throw new Error('User is not authenticated');
  }

  return state;
};

export const useMedusaSdk = () => {
  const { state } = useAuthCtx();

  if (state.status !== 'authenticated') {
    throw new Error('User is not authenticated');
  }

  return React.useMemo(
    () =>
      new Medusa({
        baseUrl: state.medusaUrl,
        debug: false,
        auth: {
          type: 'jwt',
          jwtTokenStorageMethod: 'custom',
          storage: {
            getItem: () => state.apiKey,
            setItem: () => {},
            removeItem: () => {},
          },
        },
      }),
    [state.medusaUrl, state.apiKey],
  );
};
