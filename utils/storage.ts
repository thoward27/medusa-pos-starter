import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Cross-platform secure storage utility
 *
 * Uses expo-secure-store on native platforms (iOS/Android)
 * Falls back to AsyncStorage on web (not truly secure, but functional)
 *
 * Note: Web fallback is for development only. The app is designed for native platforms.
 */

const isWeb = Platform.OS === 'web';

export const storage = {
  /**
   * Get an item from secure storage
   */
  async getItemAsync(key: string): Promise<string | null> {
    if (isWeb) {
      try {
        return await AsyncStorage.getItem(key);
      } catch (error) {
        console.warn(`Failed to get item ${key} from AsyncStorage:`, error);
        return null;
      }
    }
    return await SecureStore.getItemAsync(key);
  },

  /**
   * Set an item in secure storage
   */
  async setItemAsync(key: string, value: string): Promise<void> {
    if (isWeb) {
      try {
        await AsyncStorage.setItem(key, value);
      } catch (error) {
        console.warn(`Failed to set item ${key} in AsyncStorage:`, error);
      }
      return;
    }
    return await SecureStore.setItemAsync(key, value);
  },

  /**
   * Delete an item from secure storage
   */
  async deleteItemAsync(key: string): Promise<void> {
    if (isWeb) {
      try {
        await AsyncStorage.removeItem(key);
      } catch (error) {
        console.warn(`Failed to delete item ${key} from AsyncStorage:`, error);
      }
      return;
    }
    return await SecureStore.deleteItemAsync(key);
  },
};

/**
 * Legacy export for backward compatibility
 * @deprecated Use named export `storage` instead
 */
export default storage;
