import { FirebaseApp } from "firebase/app";
import {
  child,
  Database,
  DatabaseReference,
  getDatabase,
  off,
  onChildAdded,
  onDisconnect,
  push,
  ref,
  remove,
  serverTimestamp,
  set,
} from "firebase/database";
import mitt, { Emitter } from "mitt";

/** ────────────────────────────────────────────────────────────────
 *  Typings
 * ────────────────────────────────────────────────────────────────*/

export interface FirebaseSignallerOptions {
  /** Pre‑initialised Firebase *App* (browser or Node). */
  firebaseApp?: FirebaseApp;
  /** Database URL (only required when `firebaseApp` is omitted). */
  appId?: string;
  /** Path under which all signalling data is stored. */
  rootPath?: string;
}

export interface PeerInfo {
  peerId: string;
  role: string;
}

/** Event map for our small `mitt` bus. */
type Events = {
  "peer-joined": PeerInfo;
  signal: { from: string; data: unknown };
};
/** ────────────────────────────────────────────────────────────────
 *  FirebaseSignaller
 * ────────────────────────────────────────────────────────────────*/

export class FirebaseSignaller {
  /* Public state */
  public readonly peerId: string;
  public readonly roomId?: string;
  public role?: string;

  /* Event API – re‑exported from mitt */
  public readonly on: Emitter<Events>["on"];
  public readonly off: Emitter<Events>["off"];
  public readonly emit: Emitter<Events>["emit"];

  constructor(private readonly opts: FirebaseSignallerOptions = {}) {
    const bus = mitt<Events>();
    this.on = bus.on;
    this.off = bus.off;
    this.emit = bus.emit;

    this.peerId = FirebaseSignaller.generateId();
  }

  /** Join (or create) a room and start signalling. */
  async join(roomId: string, role = "default"): Promise<void> {
    if (this._roomRef) throw new Error("This instance already joined a room");

    this._roomId = roomId;
    this.role = role;

    const db = this.initDatabase();
    this._roomRef = child(
      ref(db, this.opts.rootPath ?? "__signaller__"),
      roomId
    );
    this._selfRef = child(this._roomRef, this.peerId);

    await remove(this._selfRef).catch(() => void 0); // clear potential leftovers

    await set(this._selfRef, {
      _: { peerId: this.peerId, role, ts: serverTimestamp() },
    });
    onDisconnect(this._selfRef).remove();

    this.watchRoom();
    this.watchInbox();
  }

  /** Send a WebRTC signal to `targetPeerId`. */
  async sendMessage<T>(targetPeerId: string, data: T): Promise<void> {
    if (!this._roomRef) throw new Error("join() must be called first");

    const msgRef = push(child(this._roomRef, `${targetPeerId}/${this.peerId}`));
    onDisconnect(msgRef).remove();
    await set(msgRef, data);
  }

  /** Leave the room and clean up every node we created. */
  async disconnect(): Promise<void> {
    if (!this._roomRef || !this._selfRef) return;

    off(this._roomRef);
    off(this._selfRef);
    await remove(this._selfRef).catch(() => void 0);

    for (const unsub of this._unsubs) unsub();
    this._unsubs.length = 0;

    this._roomRef = undefined;
    this._selfRef = undefined;
  }

  /* ──────────── Internal Firebase references & helpers ─────────── */

  private _roomId?: string;
  private _roomRef?: DatabaseReference;
  private _selfRef?: DatabaseReference;
  private readonly _unsubs: Array<() => void> = [];
  private _db!: Database;

  /** Watch for late‑joining peers and emit `peer-joined`. */
  private watchRoom(): void {
    if (!this._roomRef) return;

    // let initialised = false;

    // // Mark when initial snapshot arrived so we don’t emit existing peers.
    // this._unsubs.push(
    //   onValue(this._roomRef, () => (initialised = true), { onlyOnce: true })
    // );

    this._unsubs.push(
      onChildAdded(this._roomRef, (snap) => {
        // if (!initialised) return;
        if (snap.key === this.peerId) return; // ignore self

        const presence = snap.child("_").val() as PeerInfo | null;
        if (presence) this.emit("peer-joined", presence);
      })
    );
  }

  /** Listen for inbound messages directed at *this* peer and emit `signal`. */
  private watchInbox(): void {
    if (!this._selfRef) return;

    const processed: Record<string, Record<string, true>> = {};

    const processMessage = (fromPeerId: string, key: string, val: unknown) => {
      processed[fromPeerId] ??= {};
      if (key in processed[fromPeerId]) {
        console.log("YYYYde-duped", key);
        return; // de‑dupe
      }
      processed[fromPeerId][key] = true;

      this.emit("signal", { from: fromPeerId, data: val });
    };

    console.log("adding top listener");
    this._unsubs.push(
      onChildAdded(this._selfRef, (peerDirSnap) => {
        const fromPeerId = peerDirSnap.key!;
        if (fromPeerId === "_") return; // skip presence marker

        // console.log(
        //   "adding onValue",
        //   this._unsubs.length,
        //   peerDirSnap.val(),
        //   peerDirSnap.ref.toString()
        // );
        for (const [key, val] of Object.entries(peerDirSnap.val())) {
          console.log("procesiing parsed msg", key, val);
          processMessage(fromPeerId, key, val);
        }

        this._unsubs.push(
          onChildAdded(peerDirSnap.ref, (msgSnap) => {
            processMessage(fromPeerId, msgSnap.key!, msgSnap.val());
            // would tre-trigger top onChildAdded if it removes the last item
            // remove(msgSnap.ref).catch(() => void 0);
          })
        );
      })
    );
  }

  /** Resolve the `Database` handle from options. */
  private initDatabase(): Database {
    if (this._db) return this._db;

    this._db = getDatabase(this.opts.firebaseApp);
    return this._db;
  }

  /** Generate a cryptographically strong random ID. */
  private static generateId(): string {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto)
      return crypto.randomUUID();

    const bytes = new Uint8Array(16);
    (typeof crypto !== "undefined"
      ? crypto
      : require("crypto")
    ).getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }
}
