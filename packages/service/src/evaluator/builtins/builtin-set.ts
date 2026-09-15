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
        // An exact list can start on the first trackable add (nothing
        // untracked came before); once partial it stays partial.
        if ((set as any)._values === undefined && (set as any)._valuesExact !== false) {
          (set as any)._values = [];
          (set as any)._valuesExact = true;
        }
        if ((set as any)._valuesExact) {
          const values = (set as any)._values as TypeValue[];
          if (!values.some((v) => typeValueEquals(v, value))) values.push(value);
        }
      } else {
        (set as any)._valuesExact = false;
      }
    }
    return set ?? T.unknown;
  },
  has: (value: TypeValue, set?: TypeValue) => {
    const values = exactSetValues(set);
    if (values) {
      const looked = lookupValues(values, value);
      if (looked !== null) return T.literal(looked);
    }
    return T.boolean;
  },
  delete: (value: TypeValue, set?: TypeValue) => {
    const values = exactSetValues(set);
    if (values && valueTrackable(value)) {
      const idx = values.findIndex((v) => typeValueEquals(v, value));
      if (idx >= 0) {
        values.splice(idx, 1);
        return T.literal(true);
      }
      return T.literal(false);
    }
    return T.boolean;
  },
  clear: (value?: TypeValue, set?: TypeValue) => {
    // s.clear() arrives as clear(receiver): the set sits in the first
    // param slot when the call has no arguments.
    const target = set ?? value;
    if (target && (target as any)._valuesExact) {
      (target as any)._values = [];
    }
    return T.undefined;
  },
  forEach: () => T.undefined,
  values: (set?: TypeValue) => setValuesIterable(set),
  // For Set, keys() is the same as values()
  keys: (set?: TypeValue) => setValuesIterable(set),
  entries: (set?: TypeValue) => {
    const values = exactSetValues(set);
    if (values) return T.tuple(values.map((v) => T.tuple([v, v])));
    const typeArgs = (set as any)?._typeArgs;
    if (typeArgs?.T) return T.array(T.tuple([typeArgs.T, typeArgs.T]));
    return T.array(T.tuple([T.unknown, T.unknown]));
  },
};

// Exact membership side table: present only when every member seen so far
// (construction elements + adds) was trackable. Partial tables must not
// decide has()/delete()/iteration — an untracked member could be anything.
export function exactSetValues(set: TypeValue | undefined): TypeValue[] | undefined {
  if (!set || (set as any)._valuesExact !== true) return undefined;
  return (set as any)._values as TypeValue[] | undefined;
}

// values()/keys() keep feeding `new Set(...)`-style consumers: a tuple of
// the exact members when the side table is complete, else array<T>.
export function setValuesIterable(set: TypeValue | undefined): TypeValue {
  const values = exactSetValues(set);
  if (values) return T.tuple([...values]);
  const typeArgs = (set as any)?._typeArgs;
  if (typeArgs?.T) return T.array(typeArgs.T);
  return T.array(T.unknown);
}

export function createSetType(args?: TypeValue[]): TypeValue {
  const obj = T.instanceOf("Set", {});

  if (args && args.length > 0) {
    const arg = args[0];
    if (arg.kind === "tuple" || arg.kind === "array") {
      const elements = arg.kind === "tuple" ? arg.elements : [arg.element];
      (obj as any)._typeArgs = { T: simplifyUnion(elements) };
      // Only a fully trackable element list is exact: symbolic elements
      // mean the recorded values are a subset of the real membership.
      const exact = elements.every(valueTrackable);
      if (exact && elements.length > 0) {
        (obj as any)._values = elements;
        (obj as any)._valuesExact = true;
      } else if (!exact) {
        (obj as any)._valuesExact = false;
      }
    }
  }

  if (!(obj as any)._typeArgs) {
    (obj as any)._typeArgs = { T: T.unknown };
  }

  return obj;
}
