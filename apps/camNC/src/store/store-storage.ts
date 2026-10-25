import { isDemoMode } from '@/lib/demo/demo-mode';
import { saveUserSettings } from '@/lib/settings-sync/settings-api';
import { throttle } from 'radashi';
import superjson from 'superjson';
import { Box2, Matrix3, Vector2, Vector3 } from 'three';
import { PersistStorage } from 'zustand/middleware';

superjson.registerCustom<Box2, { min: number[]; max: number[] }>(
  {
    isApplicable: value => value instanceof Box2,
    serialize: value => ({ min: value.min.toArray(), max: value.max.toArray() }),
    deserialize: value => new Box2(new Vector2().fromArray(value.min), new Vector2().fromArray(value.max)),
  },
  'Box2'
);
superjson.registerCustom<Vector2, number[]>(
  {
    isApplicable: value => value instanceof Vector2,
    serialize: value => value.toArray(),
    deserialize: value => new Vector2().fromArray(value),
  },
  'Vector2'
);
superjson.registerCustom<Vector3, number[]>(
  {
    isApplicable: value => value instanceof Vector3,
    serialize: value => value.toArray(),
    deserialize: value => new Vector3().fromArray(value),
  },
  'Vector3'
);
superjson.registerCustom<Matrix3, number[]>(
  {
    isApplicable: value => value instanceof Matrix3,
    serialize: value => value.toArray(),
    deserialize: value => new Matrix3().fromArray(value),
  },
  'Matrix3'
);

// Settings loaded from the server for the signed-in user, see SettingsSyncGate.
let serverSettings: unknown = null;

/** Takes superjson-serialized settings as returned by the settings API. */
export function setServerSettings(serialized: unknown) {
  serverSettings = serialized ? superjson.deserialize(serialized as any) : null;
}

export function createStorage() {
  const storage: PersistStorage<unknown> = {
    // The demo starts from its preset every time and never reads or writes real settings.
    getItem: name => {
      if (isDemoMode()) return null;
      if (name === 'settings' && serverSettings) {
        return serverSettings as any;
      }
      const str = localStorage.getItem(name);
      if (!str) return null;
      return superjson.parse(str);
    },
    // See https://github.com/pmndrs/zustand/discussions/2125
    setItem: throttle({ interval: 500, trailing: true }, async (name, value) => {
      if (isDemoMode()) return;
      localStorage.setItem(name, superjson.stringify(value));
      if (name === 'settings') serverSettings = null;
      await saveUserSettings(superjson.serialize(value));
    }),
    removeItem: name => {
      if (!isDemoMode()) localStorage.removeItem(name);
    },
  };
  return storage;
}
