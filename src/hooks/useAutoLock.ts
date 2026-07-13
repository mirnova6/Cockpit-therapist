import { useEffect, useRef } from 'react';
import { useAuthStore } from '../state/authStore';

const ACTIVITY_EVENTS: Array<keyof WindowEventMap> = [
  'pointerdown',
  'keydown',
  'wheel',
  'touchstart',
];

/**
 * Locks the workspace after the configured period of inactivity.
 * Also locks immediately when the tab is hidden for longer than the timeout.
 */
export function useAutoLock(): void {
  const status = useAuthStore((s) => s.status);
  const minutes = useAuthStore((s) => s.autoLockMinutes);
  const lock = useAuthStore((s) => s.lock);
  const lastActivity = useRef(Date.now());

  useEffect(() => {
    if (status !== 'unlocked' || minutes <= 0) return;

    const markActivity = () => {
      lastActivity.current = Date.now();
    };
    ACTIVITY_EVENTS.forEach((event) => window.addEventListener(event, markActivity, { passive: true }));

    const interval = window.setInterval(() => {
      if (Date.now() - lastActivity.current >= minutes * 60_000) {
        void lock();
      }
    }, 5_000);

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        if (Date.now() - lastActivity.current >= minutes * 60_000) void lock();
        else markActivity();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      ACTIVITY_EVENTS.forEach((event) => window.removeEventListener(event, markActivity));
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [status, minutes, lock]);
}
