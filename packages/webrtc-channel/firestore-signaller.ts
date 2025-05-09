// signaller.js  (modular SDK v10+)
import { initializeApp } from "firebase/app";
import {
  addDoc,
  collection,
  CollectionReference,
  doc,
  DocumentReference,
  Firestore,
  getFirestore,
  onSnapshot,
  orderBy,
  query,
  Query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from "firebase/firestore";
// constants.ts
export const ROOM_TTL_MS = 60 * 60 * 1000; // 1 hour
export const SIGNAL_TTL_MS = 5 * 60 * 1000; // 5 minutes
export const TTL_FIELD = "expiresAt"; // the field Firestore watches

const firebaseConfig = {
  apiKey: "AIzaSyAhBi6p_4cMPWBhlAbkqxPzsllGcF_Awdo",
  authDomain: "wbcnc-ec187.firebaseapp.com",
  projectId: "wbcnc-ec187",
  storageBucket: "wbcnc-ec187.firebasestorage.app",
  messagingSenderId: "152002882420",
  appId: "1:152002882420:web:1411e816ec99452505da21",
  measurementId: "G-Z5BYBFX6R0",
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

type IPayload = {
  [key: string]: any;
};

export class FirestoreSignaller {
  private roomId: string;
  private db: Firestore;
  private me: string;
  private roomRef: DocumentReference;
  private signals: CollectionReference;
  private q: Query;

  constructor(roomId: string, db = getFirestore(app, "signalling")) {
    this.roomId = roomId;
    this.db = db;
    this.me = crypto.randomUUID();

    this.roomRef = doc(db, "rooms", roomId);
    this.signals = collection(this.roomRef, "signals");
    this.q = query(this.signals, orderBy("ts"));

    /** Make sure the room doc exists and renew its expiry */
    this.touchRoom();
  }

  /** Send a signalling message.
   *  `payload` **must** contain a `.type` field: "offer" | "answer" | "ice".
   */
  async send(payload: IPayload) {
    await addDoc(this.signals, {
      from: this.me,
      payload, // <-- now carries { type, … }
      ts: serverTimestamp(),
      [TTL_FIELD]: Timestamp.fromMillis(Date.now() + SIGNAL_TTL_MS),
    });

    await this.extendRoomTtl();
  }

  /** Subscribe to *remote* messages only */
  onSignal(cb: (from: string, payload: IPayload) => void) {
    return onSnapshot(this.q, (snap) =>
      snap.docChanges().forEach((c) => {
        if (c.type === "added") {
          const d = c.doc.data();
          if (d.from !== this.me) cb(d.from, d.payload); // emit just the payload
        }
      })
    );
  }

  /* ───── internal helpers ───────────────────────────────────────── */
  private async touchRoom() {
    await setDoc(
      this.roomRef,
      {
        createdAt: serverTimestamp(),
        [TTL_FIELD]: Timestamp.fromMillis(Date.now() + ROOM_TTL_MS),
      },
      { merge: true } // don’t clobber existing fields
    );
  }

  private async extendRoomTtl() {
    await updateDoc(this.roomRef, {
      [TTL_FIELD]: Timestamp.fromMillis(Date.now() + ROOM_TTL_MS),
    });
  }
}

// # One-time setup (console or gcloud);

// gcloud firestore fields ttls update expiresAt \
//   --collection-group=rooms   --enable-ttl   # room docs
// gcloud firestore fields ttls update expiresAt \
//   --collection-group=signals --enable-ttl   # signalling docs
