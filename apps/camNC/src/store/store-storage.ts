import { updateUserSettings } from '@/db/functions';
import { parse as devalueParse } from 'devalue';
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

// As injected in __root.tsx
let __initialStorageData: any = undefined;
export function getInitialStorageData() {
  if (__initialStorageData === undefined) {
    const script = document.getElementById('__APP_STATE__');
    if (script) {
      __initialStorageData = superjson.deserialize(devalueParse(script.textContent as any));
    } else {
      __initialStorageData = null;
    }
  }
  return __initialStorageData;
}

export function createStorage() {
  const storage: PersistStorage<unknown> = {
    getItem: name => {
      const initialData = getInitialStorageData();
      console.log('have initialStorageData', !!initialData);
      if (initialData) {
        return initialData;
      }
      const str = localStorage.getItem(name);
      if (!str) return null;
      return superjson.parse(str);
    },
    // See https://github.com/pmndrs/zustand/discussions/2125
    setItem: throttle({ interval: 500, trailing: true }, async (name, value) => {
      localStorage.setItem(name, superjson.stringify(value));
      await updateUserSettings({ data: superjson.serialize(value) });
    }),
    removeItem: name => localStorage.removeItem(name),
  };
  return storage;
}
