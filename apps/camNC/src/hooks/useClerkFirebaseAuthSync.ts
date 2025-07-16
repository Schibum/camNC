import { auth as fbAuth } from '@/lib/firebase/clientApp';
import { useAuth } from '@clerk/clerk-react';
import { signOut as fbSignOut, signInWithCustomToken } from 'firebase/auth';
import { useEffect } from 'react';

/**
 * Keeps Firebase authentication state in sync with Clerk authentication.
 *
 * Usage:
 *   Call within a component rendered while Clerk is mounted (e.g. in _app).
 *   No return value – the hook triggers side-effects only.
 */
export function useClerkFirebaseAuthSync(): void {
  const { isSignedIn, userId, getToken } = useAuth();

  useEffect(() => {
    let cancelled = false;

    const sync = async () => {
      if (!isSignedIn) {
        // Ensure Firebase is signed out when Clerk signs out.
        if (fbAuth.currentUser) {
          try {
            await fbSignOut(fbAuth);
          } catch (err) {
            console.error('Failed to sign out from Firebase:', err);
          }
        }
        return;
      }

      // If already signed in with the same user, skip.
      if (fbAuth.currentUser?.uid === userId) return;

      try {
        const token = await getToken({ template: 'integration_firebase' });
        if (!token || cancelled) return;
        await signInWithCustomToken(fbAuth, token);
      } catch (err) {
        console.error('Failed to sync Firebase auth with Clerk:', err);
      }
    };

    void sync();

    return () => {
      cancelled = true;
    };
    // Re-run when Clerk sign-in state changes or user switches.
  }, [isSignedIn, userId, getToken]);
}
