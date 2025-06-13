import { FirebaseApp, initializeApp } from 'firebase/app';

export const firebaseConfig = {
  apiKey: 'AIzaSyAhBi6p_4cMPWBhlAbkqxPzsllGcF_Awdo',
  authDomain: 'wbcnc-ec187.firebaseapp.com',
  projectId: 'wbcnc-ec187',
  storageBucket: 'wbcnc-ec187.firebasestorage.app',
  messagingSenderId: '152002882420',
  appId: '1:152002882420:web:1411e816ec99452505da21',
  measurementId: 'G-Z5BYBFX6R0',
  databaseURL: 'https://wbcnc-ec187-default-rtdb.europe-west1.firebasedatabase.app',
};

let _app: FirebaseApp | undefined;

export function initFbApp() {
  if (_app) return _app;
  _app = initializeApp(firebaseConfig);
  return _app;
}
