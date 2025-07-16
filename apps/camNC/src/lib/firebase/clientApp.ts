/* eslint-disable turbo/no-undeclared-env-vars */
import { initFbApp } from '@wbcnc/public-config/firebase';
import { getApps } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseApp = getApps().length === 0 ? initFbApp() : getApps()[0];

export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);

if (import.meta.env.MODE === 'development') {
  connectAuthEmulator(auth, 'http://localhost:9099');
}
