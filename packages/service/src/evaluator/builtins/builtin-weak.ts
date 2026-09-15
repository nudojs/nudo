import { type TypeValue, T } from "@nudojs/core";

export const WEAKMAP_INSTANCE_METHODS: Record<string, (...args: TypeValue[]) => TypeValue> = {
  get: (_key: TypeValue) => T.union(T.unknown, T.undefined),
  set: (_key: TypeValue, _value: TypeValue, map?: TypeValue) => map ?? T.unknown,
  has: () => T.boolean,
  delete: () => T.boolean,
};

export const WEAKSET_INSTANCE_METHODS: Record<string, (...args: TypeValue[]) => TypeValue> = {
  add: (_value: TypeValue, set?: TypeValue) => set ?? T.unknown,
  has: () => T.boolean,
  delete: () => T.boolean,
};

export function createWeakMapType(): TypeValue {
  return T.instanceOf("WeakMap", {});
}

export function createWeakSetType(): TypeValue {
  return T.instanceOf("WeakSet", {});
}
