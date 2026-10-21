import * as Comlink from 'comlink';
import { Matrix3, Vector3 } from 'three';

/**
 * Registers a Comlink transfer handler that deeply walks arbitrary objects and
 * replaces any Three.js Matrix3 / Vector3 instances it encounters with a plain
 * JSON representation.  This avoids the need for multiple nearly-identical
 * handlers and guarantees that nested occurrences (in arrays, objects, etc.)
 * are handled correctly.
 *
 * NOTE: We COPY the underlying numeric data – no ArrayBuffer transfer – to keep
 * the original objects usable on the sender side.
 */
export function registerThreeJsTransferHandlers(): void {
  const THREE_DEEP_ID = 'THREE.DEEP';

  if (Comlink.transferHandlers.has(THREE_DEEP_ID)) return; // idempotent

  type SerializableThree = { __three__: 'Matrix3'; values: number[] } | { __three__: 'Vector3'; values: [number, number, number] };

  function isMatrix3(val: unknown): val is Matrix3 {
    return val instanceof Matrix3;
  }
  function isVector3(val: unknown): val is Vector3 {
    return val instanceof Vector3;
  }

  // Only arrays and plain objects are walked. Everything else (typed arrays, ImageData, streams, ...) is left
  // as is for structured cloning; walking e.g. a large Float32Array element by element would be very slow.
  function isTraversable(val: unknown): val is unknown[] | Record<string, unknown> {
    if (Array.isArray(val)) return true;
    if (!val || typeof val !== 'object') return false;
    const proto = Object.getPrototypeOf(val);
    return proto === Object.prototype || proto === null;
  }

  // Recursively test if a value contains any Matrix3 / Vector3, to decide if
  // this handler should take over.
  function containsThree(obj: unknown, seen = new WeakSet<object>()): boolean {
    if (isMatrix3(obj) || isVector3(obj)) return true;
    if (!isTraversable(obj) || seen.has(obj)) return false;
    seen.add(obj);
    return Object.values(obj).some(value => containsThree(value, seen));
  }

  function serializeDeep<T>(value: T): any {
    if (isMatrix3(value)) {
      return { __three__: 'Matrix3', values: [...value.elements] } satisfies SerializableThree;
    }
    if (isVector3(value)) {
      return { __three__: 'Vector3', values: [value.x, value.y, value.z] } satisfies SerializableThree;
    }
    if (Array.isArray(value)) {
      return value.map(serializeDeep);
    }
    if (isTraversable(value)) {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        out[k] = serializeDeep(v);
      }
      return out;
    }
    return value;
  }

  function deserializeDeep<T>(value: any): T {
    if (value && typeof value === 'object' && '__three__' in value && (value.__three__ === 'Matrix3' || value.__three__ === 'Vector3')) {
      if (value.__three__ === 'Matrix3') {
        return new Matrix3().fromArray(value.values) as unknown as T;
      }
      if (value.__three__ === 'Vector3') {
        const [x, y, z] = value.values as [number, number, number];
        return new Vector3(x, y, z) as unknown as T;
      }
    }
    if (Array.isArray(value)) {
      return value.map(deserializeDeep) as unknown as T;
    }
    if (isTraversable(value)) {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        out[k] = deserializeDeep(v);
      }
      return out as T;
    }
    return value as T;
  }

  Comlink.transferHandlers.set(THREE_DEEP_ID, {
    canHandle: (obj: unknown): obj is object => containsThree(obj),
    serialize: (obj: any): [any, Transferable[]] => {
      const serialized = serializeDeep(obj);
      return [serialized, []]; // copy, no transferables
    },
    deserialize: deserializeDeep,
  });
}
