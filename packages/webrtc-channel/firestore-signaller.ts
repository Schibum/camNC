import { FirebaseApp, initializeApp } from "firebase/app";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  Firestore,
  getFirestore,
  onSnapshot,
  serverTimestamp,
  setDoc,
  Timestamp,
  Unsubscribe,
  updateDoc,
} from "firebase/firestore";
import mitt, { Emitter } from "mitt";

// ──────────────────────────── Types ────────────────────────────

export interface FirestoreSignallerOptions {
  firebaseApp?: FirebaseApp;
  /** When no app instance is passed, the projectId to initialise on the fly. */
  appId?: string;
  /** Root collection for all signalling data (default: `signaller`). */
  rootPath?: string;
  /** Presence TTL (seconds). Default: 5 min. */
  presenceTtlSeconds?: number;
  /** Message TTL (seconds). Default: 10 min. */
  messageTtlSeconds?: number;
}

export interface PeerInfo {
  peerId: string;
  role: string;
}

interface Events {
  "peer-joined": PeerInfo;
  signal: { from: string; data: unknown };
}

// ────────────────────────── Constants ──────────────────────────

const SUBCOLLECTION_INBOX = "inbox";

// ─────────────────────── FirestoreSignaller ─────────────────────

export class FirestoreSignaller {
  // Public state
  public readonly peerId: string;
  public readonly roomId?: string;
  public readonly role?: string;

  // mitt API passthrough
  public readonly on: Emitter<Events>["on"];
  public readonly off: Emitter<Events>["off"];
  public readonly emit: Emitter<Events>["emit"];

  constructor(private readonly opts: FirestoreSignallerOptions) {
    const bus = mitt<Events>();
    this.on = bus.on;
    this.off = bus.off;
    this.emit = bus.emit;

    this.peerId = FirestoreSignaller.generateId();
  }

  // ────────────────────────── Lifecycle ─────────────────────────

  async join(roomId: string, role = "default"): Promise<void> {
    if (this._roomRef) throw new Error("Already joined a room");

    this._roomId = roomId;
    this.role = role;

    const db = this.db();
    const root = this.rootPath();

    this._roomRef = doc(db, root, roomId);
    this._selfDoc = doc(db, root, roomId, "peers", this.peerId);

    const presenceTtl = this.opts.presenceTtlSeconds ?? 300;
    await setDoc(this._selfDoc, {
      peerId: this.peerId,
      role,
      lastSeen: serverTimestamp(),
      expiresAt: Timestamp.fromMillis(Date.now() + presenceTtl * 1000),
    });

    // refresh heartbeat periodically
    this._heartbeat = setInterval(
      () => this.refreshPresence(),
      (presenceTtl * 1000) / 2
    );

    // best‑effort cleanup on tab close
    if (typeof window !== "undefined") {
      const fn = () => deleteDoc(this._selfDoc!).catch(() => void 0);
      window.addEventListener("beforeunload", fn, { once: true });
      this._unloadFn = fn;
    }

    this.watchPeers();
    this.watchInbox();
  }

  async sendMessage<T>(targetPeerId: string, data: T): Promise<void> {
    if (!this._roomId) throw new Error("join() first");

    const db = this.db();
    const root = this.rootPath();
    const msgTtl = this.opts.messageTtlSeconds ?? 600;

    const inboxCol = collection(
      db,
      root,
      this._roomId,
      "peers",
      targetPeerId,
      SUBCOLLECTION_INBOX
    );
    await addDoc(inboxCol, {
      from: this.peerId,
      data,
      ts: serverTimestamp(),
      expiresAt: Timestamp.fromMillis(Date.now() + msgTtl * 1000),
    });
  }

  async disconnect(): Promise<void> {
    this._subs.forEach((u) => u());
    this._subs.length = 0;

    if (this._heartbeat) clearInterval(this._heartbeat);
    if (this._unloadFn && typeof window !== "undefined")
      window.removeEventListener("beforeunload", this._unloadFn);

    if (this._selfDoc) await deleteDoc(this._selfDoc).catch(() => void 0);

    this._roomRef = undefined;
    this._selfDoc = undefined;
  }

  // ──────────────────────── Internals ───────────────────────────

  private _roomId?: string;
  private _roomRef?: ReturnType<typeof doc>;
  private _selfDoc?: ReturnType<typeof doc>;
  private _db!: Firestore;
  private _subs: Unsubscribe[] = [];
  private _heartbeat?: ReturnType<typeof setInterval>;
  private _unloadFn?: () => void;

  private watchPeers() {
    const peersCol = collection(
      this.db(),
      this.rootPath(),
      this._roomId!,
      "peers"
    );
    let init = false;
    this._subs.push(
      onSnapshot(peersCol, (snap) => {
        if (!init) {
          init = true;
          return;
        }
        snap.docChanges().forEach((c) => {
          if (c.type === "added") {
            const data = c.doc.data() as PeerInfo;
            if (data.peerId !== this.peerId) this.emit("peer-joined", data);
          }
        });
      })
    );
  }

  private watchInbox() {
    const inboxCol = collection(
      this.db(),
      this.rootPath(),
      this._roomId!,
      "peers",
      this.peerId,
      SUBCOLLECTION_INBOX
    );
    this._subs.push(
      onSnapshot(inboxCol, (snap) => {
        snap.docChanges().forEach((chg) => {
          if (chg.type === "added") {
            const { from, data } = chg.doc.data() as {
              from: string;
              data: unknown;
            };
            this.emit("signal", { from, data });
            deleteDoc(chg.doc.ref).catch(() => void 0); // cleanup after read
          }
        });
      })
    );
  }

  private async refreshPresence() {
    if (!this._selfDoc) return;
    const ttl = this.opts.presenceTtlSeconds ?? 300;
    await updateDoc(this._selfDoc, {
      lastSeen: serverTimestamp(),
      expiresAt: Timestamp.fromMillis(Date.now() + ttl * 1000),
    }).catch(() => void 0);
  }

  private db(): Firestore {
    if (this._db) return this._db;

    if (this.opts.firebaseApp)
      this._db = getFirestore(this.opts.firebaseApp, "signalling");
    else if (this.opts.appId)
      this._db = getFirestore(initializeApp({ projectId: this.opts.appId }));
    else throw new Error("Provide firebaseApp or appId");
    return this._db;
  }

  private rootPath() {
    return this.opts.rootPath ?? "signaller";
  }

  private static generateId() {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto)
      return crypto.randomUUID();
    const b = new Uint8Array(16);
    (typeof crypto !== "undefined"
      ? crypto
      : require("crypto")
    ).getRandomValues(b);
    return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  }
}
