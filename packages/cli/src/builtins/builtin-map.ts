import { type TypeValue, T, simplifyUnion } from "@nudojs/core";

export const MAP_INSTANCE_METHODS: Record<string, (...args: TypeValue[]) => TypeValue> = {
  get: (_key: TypeValue, map?: TypeValue) => {
    const typeArgs = (map as any)?._typeArgs;
    if (typeArgs?.V) return T.union(typeArgs.V, T.undefined);
    return T.undefined;
  },
  set: (_key: TypeValue, _value: TypeValue, map?: TypeValue) => map ?? T.unknown,
  has: () => T.boolean,
  delete: () => T.boolean,
  clear: () => T.undefined,
  forEach: () => T.undefined,
  keys: (map?: TypeValue) => {
    const typeArgs = (map as any)?._typeArgs;
    if (typeArgs?.K) return T.array(typeArgs.K);
    return T.array(T.unknown);
  },
  values: (map?: TypeValue) => {
    const typeArgs = (map as any)?._typeArgs;
    if (typeArgs?.V) return T.array(typeArgs.V);
    return T.array(T.unknown);
  },
  entries: (map?: TypeValue) => {
    const typeArgs = (map as any)?._typeArgs;
    if (typeArgs?.K && typeArgs?.V) return T.array(T.tuple([typeArgs.K, typeArgs.V]));
    return T.array(T.tuple([T.unknown, T.unknown]));
  },
};

export function createMapType(args?: TypeValue[]): TypeValue {
  const obj = T.instanceOf("Map", {});

  if (args && args.length > 0) {
    const arg = args[0];
    if (arg.kind === "tuple" || arg.kind === "array") {
      const elements = arg.kind === "tuple" ? arg.elements : [arg.element];
      const keys: TypeValue[] = [];
      const values: TypeValue[] = [];
      for (const el of elements) {
        if (el.kind === "tuple" && el.elements.length >= 2) {
          keys.push(el.elements[0]);
          values.push(el.elements[1]);
        }
      }
      if (keys.length > 0) {
        (obj as any)._typeArgs = { K: simplifyUnion(keys), V: simplifyUnion(values) };
      }
    }
  }

  if (!(obj as any)._typeArgs) {
    (obj as any)._typeArgs = { K: T.unknown, V: T.unknown };
  }

  return obj;
}
