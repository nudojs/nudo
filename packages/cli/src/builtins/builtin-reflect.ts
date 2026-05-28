import { type TypeValue, T } from "@nudojs/core";

export const REFLECT_METHODS: Record<string, (...args: TypeValue[]) => TypeValue> = {
  has: () => T.boolean,
  get: () => T.unknown,
  set: () => T.boolean,
  deleteProperty: () => T.boolean,
  apply: () => T.unknown,
  construct: () => T.object({}),
  ownKeys: () => T.array(T.string),
  getPrototypeOf: () => T.union(T.object({}), T.null),
  getOwnPropertyDescriptor: () => T.union(T.object({}), T.undefined),
};
