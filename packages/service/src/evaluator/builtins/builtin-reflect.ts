import { type TypeValue, T } from "@nudojs/core";

export const REFLECT_METHODS: Record<string, (...args: TypeValue[]) => TypeValue> = {
  has: () => T.boolean,
  get: () => T.unknown,
  set: () => T.boolean,
  deleteProperty: () => T.boolean,
  apply: () => T.unknown,
  construct: () => T.object({}),
  // Shape-aware like Object.keys: known receivers list their declared
  // own-property names (hoek's Utils.keys → clone/flatten key loops then
  // iterate concrete keys instead of a symbolic string), arrays add the
  // non-enumerable "length" own key. Unknown shapes keep the approximation.
  ownKeys: (target?: TypeValue) => {
    let base = target;
    while (base?.kind === "refined") base = base.base;
    if (base && (base.kind === "object" || base.kind === "instance")) {
      return T.tuple(Object.keys(base.properties).map((k) => T.literal(k)));
    }
    if (base?.kind === "tuple") {
      return T.tuple([
        ...base.elements.map((_, i) => T.literal(String(i))),
        T.literal("length"),
      ]);
    }
    return T.array(T.string);
  },
  getPrototypeOf: () => T.union(T.object({}), T.null),
  getOwnPropertyDescriptor: () => T.union(T.object({}), T.undefined),
};
