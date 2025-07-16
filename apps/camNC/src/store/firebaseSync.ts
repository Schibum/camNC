import { auth } from '@/lib/firebase/clientApp';
import { initFbApp } from '@wbcnc/public-config/firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, getDoc, getFirestore, setDoc } from 'firebase/firestore';
import superjson from 'superjson';
import { useStore } from './store';

const db = getFirestore(initFbApp());

let unsubStore: (() => void) | undefined;
let unsubDoc: (() => void) | undefined;

onAuthStateChanged(auth, async (user: User | null) => {
  console.log('onAuthStateChanged', user);
  if (unsubStore) unsubStore();
  if (unsubDoc) unsubDoc();

  if (user) {
    const ref = doc(db, 'settings', user.uid);

    try {
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const data = snap.data();
        if (data.camSource) {
          console.log('syncing camSource from db', data.camSource);
          useStore.setState({ camSource: superjson.parse(data.camSource) });
        }
      }
    } catch (e) {
      console.debug('Error getting doc');
    }

    // unsubDoc = onSnapshot(ref, s => {
    //   const d = s.data();
    //   if (d?.camSource) {
    //     useStore.setState({ camSource: superjson.parse(d.camSource) });
    //   }
    // });

    unsubStore = useStore.subscribe(
      s => s.camSource,
      camSource => {
        if (camSource) {
          console.log('syncing camSource to db', camSource);
          setDoc(ref, { camSource: superjson.stringify(camSource) }, { merge: true });
        }
      }
    );
  }
});
