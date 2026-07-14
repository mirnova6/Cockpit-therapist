import { create } from 'zustand';
import { AuthError, authService, type AuthStatus } from '../core/auth/authService';
import { useDataStore } from './dataStore';
import { useStructuredStore } from './structuredStore';

interface AuthState {
  status: AuthStatus | 'loading';
  profileName?: string;
  hasPin: boolean;
  autoLockMinutes: number;
  error?: string;
  lockoutUntil?: number;

  refresh: () => Promise<void>;
  setup: (args: {
    name: string;
    passphrase: string;
    pin?: string;
    autoLockMinutes?: number;
  }) => Promise<void>;
  unlock: (secret: string, method: 'passphrase' | 'pin') => Promise<boolean>;
  lock: () => Promise<void>;
  setAutoLockMinutes: (minutes: number) => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  status: 'loading',
  hasPin: false,
  autoLockMinutes: 5,

  refresh: async () => {
    const status = await authService.getStatus();
    const profile = await authService.getProfile();
    const security = await authService.getSecurity();
    const hasPin = await authService.hasPin();
    set({
      status,
      profileName: profile?.name,
      hasPin,
      autoLockMinutes: security.autoLockMinutes,
      lockoutUntil: security.lockoutUntil,
    });
  },

  setup: async (args) => {
    await authService.setup(args);
    set({
      status: 'unlocked',
      profileName: args.name,
      hasPin: Boolean(args.pin),
      autoLockMinutes: args.autoLockMinutes ?? 5,
      error: undefined,
    });
    await useDataStore.getState().loadAll();
  },

  unlock: async (secret, method) => {
    try {
      if (method === 'pin') await authService.unlockWithPin(secret);
      else await authService.unlockWithPassphrase(secret);
      set({ status: 'unlocked', error: undefined, lockoutUntil: undefined });
      await useDataStore.getState().loadAll();
      return true;
    } catch (err) {
      if (err instanceof AuthError) {
        set({ error: err.message, lockoutUntil: err.lockoutUntil });
      } else {
        set({ error: 'Unable to unlock. Please try again.' });
      }
      return false;
    }
  },

  lock: async () => {
    await authService.lock();
    useDataStore.getState().reset();
    useStructuredStore.getState().reset();
    set({ status: 'locked', error: undefined });
  },

  setAutoLockMinutes: async (minutes) => {
    await authService.setSecurity({ autoLockMinutes: minutes });
    set({ autoLockMinutes: minutes });
  },

  clearError: () => set({ error: undefined }),
}));
