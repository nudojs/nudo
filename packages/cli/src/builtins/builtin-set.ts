import { type TypeValue, T, simplifyUnion, typeValueEquals } from "@nudojs/core";

// Literal/instance values recorded at construction (`new Set([a, b])`) or
// via add() — precise enough for typeValueEquals lookup in has(). Symbolic
// values are skipped and has() falls back to boolean.
function valueTrackable(v: TypeValue | undefined): boolean {
  return v?.kind === "literal" || v?.kind === "instance";
}

// Union values distribute: every member present → true, none present →
// false, mixed/not comparable → null (symbolic boolean fallback).
function lookupValues(values: TypeValue[], value: TypeValue): boolean | null {
  if (value.kind === "union") {
    const results = value.members.map((m) => lookupValues(values, m));
    if (results.some((r) => r === null)) return null;
    return results.some((r) => r === true) && results.every((r) => r === true);
  }
  if (!valueTrackable(value)) return null;
  return values.some((v) => typeValueEquals(v, value));
}

export const SET_INSTANCE_METHODS: Record<string, (...args: TypeValue[]) => TypeValue> = {
  add: (value: TypeValue, set?: TypeValue) => {
    if (set) {
      const typeArgs = (set as any)._typeArgs || { T: T.unknown };
      (set as any)._typeArgs = {
        T: typeArgs.T.kind === "unknown" ? value : simplifyUnion([typeArgs.T, value]),
      };
      if (valueTrackable(value)) {
        const values = ((set as any)._values as TypeValue[] | undefined) ?? ((set as any)._values = []);
        if (!values.some((v) => typeValueEquals(v, value))) values.push(value);
      }
    }
    return set ?? T.unknown;
  },
  has: (value: TypeValue, set?: TypeValue) => {
    const values = (set as any)?._values as TypeValue[] | undefined;
    if (values) {
      const looked = lookupValues(values, value);
      if (looked !== null) return T.literal(looked);
    }
    return T.boolean;
  },
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
      const values = elements.filter(valueTrackable);
      if (values.length > 0) {
        (obj as any)._values = values;
      }
    }
  }

  if (!(obj as any)._typeArgs) {
    (obj as any)._typeArgs = { T: T.unknown };
  }

  return obj;
}
