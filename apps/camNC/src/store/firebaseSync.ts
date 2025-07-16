import { useStore } from './store';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, onSnapshot, setDoc, getFirestore } from 'firebase/firestore';
import { auth } from '@/lib/firebase/clientApp';
import { initFbApp } from '@wbcnc/public-config/firebase';
import superjson from 'superjson';

const db = getFirestore(initFbApp());

let unsubStore: (() => void) | undefined;
let unsubDoc: (() => void) | undefined;

onAuthStateChanged(auth, async (user: import('firebase/auth').User | null) => {
  if (unsubStore) unsubStore();
  if (unsubDoc) unsubDoc();

  if (user) {
    const ref = doc(db, 'settings', user.uid);

    const snap = await getDoc(ref);
    if (snap.exists()) {
      const data = snap.data();
      if (data.camSource) {
        useStore.setState({ camSource: superjson.parse(data.camSource) });
      }
    }

    unsubDoc = onSnapshot(ref, s => {
      const d = s.data();
      if (d?.camSource) {
        useStore.setState({ camSource: superjson.parse(d.camSource) });
      }
    });

    unsubStore = useStore.subscribe(state => {
      const camSource = state.camSource;
      if (camSource) {
        setDoc(ref, { camSource: superjson.stringify(camSource) }, { merge: true });
      }
    });
  }
});
