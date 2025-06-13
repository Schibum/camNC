/**
 * @fileoverview
 * Simple comlink MessagePort middleware that enables sending proxy objects over
 * RTCDataChannel which does not support transferables.
 *
 * Key functionality:
 * - Intercepts ep.postMessage(msg, transferList)
 * - Replaces MessagePorts in transfer-list with stub IDs
 * - Stores real ports locally and multiplexes their traffic
 * - Recreates VirtualMessagePort on the receiving side
 * - Returns MessagePort (real or virtual) to Comlink for built-in "proxy" TransferHandler
 */

import type { Endpoint } from 'comlink';

/* Comlink’s enum value for “HANDLER” (duplicated here to avoid import soup) */
const HANDLER = 'HANDLER';

interface WireProxyValue {
  type: typeof HANDLER;
  name: 'proxy';
  value: any; // MessagePort during outbound, Stub during inbound
}

interface PortFrame {
  __mpx__: true;
  portId: string;
  payload?: any;
  close?: true;
}

const genId = () => crypto.randomUUID();

/* The only virtual object we ever instantiate                        */
class VirtualMessagePort extends EventTarget implements Endpoint {
  onmessage: ((this: VirtualMessagePort, ev: MessageEvent) => any) | null = null;
  constructor(
    private readonly tx: (f: PortFrame) => void,
    readonly portId: string
  ) {
    super();
  }
  postMessage(m: any, _o?: any) {
    this.tx({ __mpx__: true, portId: this.portId, payload: m });
  }
  start() {} // no-op – mirrors real MessagePort
  close() {
    this.tx({ __mpx__: true, portId: this.portId, close: true });
    this.dispatchEvent(new Event('close'));
  }
  /* internal */ _in(d: any) {
    const ev = new MessageEvent('message', { data: d });
    this.onmessage?.call(this, ev);
    this.dispatchEvent(ev);
  }
}

/* Main factory – wrap a *physical* Endpoint (e.g. an RTCDataChannel) */
export function comlinkMpMiddleware(phys: Endpoint): Endpoint {
  /* id ⇆ real/virtual port registry (shared by both directions) */
  const portTable = new Map<string, MessagePort | VirtualMessagePort>();
  const lsn = new Set<(ev: MessageEvent) => void>();

  /* -- outbound -------------------------------------------------- */
  function postMessage(msg: any, xfer?: Transferable[]) {
    if (!xfer || !xfer.length) {
      phys.postMessage(msg, []); // fast path: no MessagePorts
      return;
    }

    let xp = 0; // index inside transfer list
    const patched = { ...msg };

    /* a) scan argumentList (Comlink only puts ports there) */
    if (Array.isArray(patched.argumentList)) {
      patched.argumentList = patched.argumentList.map((wv: WireProxyValue) => {
        if (wv.type === HANDLER && wv.name === 'proxy') {
          const port = xfer[xp++] as MessagePort;
          const id = genId();
          portTable.set(id, port);

          /* tap outgoing traffic of the *real* MessagePort so that the
             virtual twin on the other side receives it */
          port.addEventListener('message', ev => phys.postMessage({ __mpx__: true, portId: id, payload: ev.data }, []));
          port.addEventListener('close', () => phys.postMessage({ __mpx__: true, portId: id, close: true }, []));
          port.start?.();

          return { ...wv, value: { __stub__: id } }; // JSON-safe stub
        }
        return wv;
      });
    }

    /* b) SET messages carry a single value (rare, but fix it too) */
    if (patched.type === 1 /* SET */ && patched.value && (patched.value as WireProxyValue).type === HANDLER) {
      const port = xfer[xp++] as MessagePort;
      const id = genId();
      portTable.set(id, port);
      patched.value = { ...patched.value, value: { __stub__: id } };
    }

    phys.postMessage(patched, []); // === JSON only
  }

  /* -- inbound ---------------------------------------------------- */
  phys.addEventListener('message', (ev: Event) => {
    if (!(ev instanceof MessageEvent)) throw new Error('Expected MessageEvent');
    const d = ev.data;

    /* 1. mux frames for MessagePort traffic --------------------- */
    if (d && d.__mpx__) {
      const f = d as PortFrame;
      const p = portTable.get(f.portId);
      if (!p) return; // unknown … ignore
      if (f.close) {
        (p as any).dispatchEvent(new Event('close'));
        portTable.delete(f.portId);
      } else {
        if ('_in' in p) (p as VirtualMessagePort)._in(f.payload);
        else (p as MessagePort).postMessage(f.payload);
      }
      return;
    }

    /* 2. ordinary Comlink RPC message --------------------------- */
    const transferBack: Transferable[] = [];

    function revive(wv: any): any {
      if (Array.isArray(wv)) return wv.map(revive);
      if (wv && typeof wv === 'object') {
        if (wv.__stub__) {
          const id = wv.__stub__ as string;
          let port = portTable.get(id);
          if (!port) {
            port = new VirtualMessagePort(f => phys.postMessage(f, []), id);
            portTable.set(id, port);
          }
          transferBack.push(port);
          return port;
        }
        const o: any = {};
        for (const [k, v] of Object.entries(wv)) o[k] = revive(v);
        return o;
      }
      return wv;
    }

    const msgForComlink = revive(d);
    /* forward to the local Comlink actor */
    const evt = new MessageEvent('message', { data: msgForComlink });
    for (const f of lsn) f(evt);
  });

  return {
    postMessage,
    addEventListener: (_t, cb) => lsn.add(cb as any),
    removeEventListener: (_t, cb) => lsn.delete(cb as any),
    start: phys.start?.bind(phys),
  };
}
