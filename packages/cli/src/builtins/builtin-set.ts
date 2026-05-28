import { type TypeValue, T, simplifyUnion } from "@nudojs/core";

export const SET_INSTANCE_METHODS: Record<string, (...args: TypeValue[]) => TypeValue> = {
  add: (_value: TypeValue, set?: TypeValue) => {
    if (set) {
      const typeArgs = (set as any)._typeArgs || { T: T.unknown };
      (set as any)._typeArgs = {
        T: typeArgs.T.kind === "unknown" ? _value : simplifyUnion([typeArgs.T, _value]),
      };
    }
    return set ?? T.unknown;
  },
  has: () => T.boolean,
  delete: () => T.boolean,
  clear: () => T.undefined,
  forEach: () => T.undefined,
  values: (set?: TypeValue) => {
    const typeArgs = (set as any)?._typeArgs;
    if (typeArgs?.T) return T.array(typeArgs.T);
    return T.array(T.unknown);
  },
  keys: (set?: TypeValue) => {
    // For Set, keys() is the same as values()
    const typeArgs = (set as any)?._typeArgs;
    if (typeArgs?.T) return T.array(typeArgs.T);
    return T.array(T.unknown);
  },
  entries: (set?: TypeValue) => {
    const typeArgs = (set as any)?._typeArgs;
    if (typeArgs?.T) return T.array(T.tuple([typeArgs.T, typeArgs.T]));
    return T.array(T.tuple([T.unknown, T.unknown]));
  },
};

export function createSetType(args?: TypeValue[]): TypeValue {
  const obj = T.instanceOf("Set", {});

  if (args && args.length > 0) {
    const arg = args[0];
    if (arg.kind === "tuple" || arg.kind === "array") {
      const elements = arg.kind === "tuple" ? arg.elements : [arg.element];
      (obj as any)._typeArgs = { T: simplifyUnion(elements) };
    }
  }

  if (!(obj as any)._typeArgs) {
    (obj as any)._typeArgs = { T: T.unknown };
  }

  return obj;
}
