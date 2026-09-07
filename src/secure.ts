/**
 * Secure, on-device key/value storage for settings (API key, system prompt,
 * model, sampling params, endpoint, context-window size).
 *
 * Native (iOS/Android — the ship target): expo-secure-store, backed by the iOS
 * keychain / Android keystore. This is where the API key actually belongs.
 *
 * Web: expo-secure-store is NOT supported on web. So the browser dev preview
 * (acceptance criterion §9.1) can still run, we fall back to localStorage.
 * localStorage is NOT secure — it's a development convenience only. The real
 * app runs on native, where the keychain is used. This keeps `npx expo start`
 * → web working without a rewrite for the actual mobile build.
 */
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

// SecureStore keys (brief §5).
export const KEYS = {
  apiKey: 'modelslab_api_key',
  systemPrompt: 'system_prompt',
  model: 'model_name',
  maxTokens: 'max_tokens',
  temperature: 'temperature',
  endpoint: 'endpoint_url',
  contextWindow: 'context_window',
  searchApiKey: 'search_api_key',
  searchProvider: 'search_provider',
} as const;

const isWeb = Platform.OS === 'web';

export async function setSecure(key: string, value: string): Promise<void> {
  if (isWeb) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Storage may be unavailable (private mode); nothing more we can do.
    }
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

export async function getSecure(key: string): Promise<string | null> {
  if (isWeb) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }
  return SecureStore.getItemAsync(key);
}

export async function deleteSecure(key: string): Promise<void> {
  if (isWeb) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // ignore
    }
    return;
  }
  await SecureStore.deleteItemAsync(key);
}
