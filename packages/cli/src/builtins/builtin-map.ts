import { type TypeValue, T, simplifyUnion, typeValueEquals } from "@nudojs/core";

// Literal/instance keys recorded at construction (`new Map([['k', v]])`) or
// via set() — precise enough for typeValueEquals lookup. Symbolic keys are
// skipped: they cannot be definitely matched, so get() falls back to the
// V | undefined approximation.
type MapEntry = { key: TypeValue; value: TypeValue };

function entryKeyTrackable(key: TypeValue | undefined): boolean {
  return key?.kind === "literal" || key?.kind === "instance";
}

// Union keys distribute: every member hitting → union of values, every
// member missing → undefined, mixed → values | undefined.
function lookupEntries(entries: MapEntry[], key: TypeValue): TypeValue | null {
  if (key.kind === "union") {
    const results = key.members.map((m) => lookupEntries(entries, m));
    if (results.some((r) => r === null)) return null;
    return simplifyUnion(results as TypeValue[]);
  }
  if (!entryKeyTrackable(key)) return null;
  const hit = entries.find((e) => typeValueEquals(e.key, key));
  return hit ? hit.value : T.undefined;
}

export const MAP_INSTANCE_METHODS: Record<string, (...args: TypeValue[]) => TypeValue> = {
  get: (key: TypeValue, map?: TypeValue) => {
    const entries = (map as any)?._entries as MapEntry[] | undefined;
    if (entries) {
      const looked = lookupEntries(entries, key);
      if (looked !== null) return looked;
    }
    const typeArgs = (map as any)?._typeArgs;
    if (typeArgs?.V) return T.union(typeArgs.V, T.undefined);
    return T.undefined;
  },
  set: (key: TypeValue, value: TypeValue, map?: TypeValue) => {
    if (map) {
      const typeArgs = (map as any)._typeArgs || { K: T.unknown, V: T.unknown };
      (map as any)._typeArgs = {
        K: typeArgs.K.kind === "unknown" ? key : simplifyUnion([typeArgs.K, key]),
        V: typeArgs.V.kind === "unknown" ? value : simplifyUnion([typeArgs.V, value]),
      };
      if (entryKeyTrackable(key)) {
        const entries = ((map as any)._entries as MapEntry[] | undefined) ?? ((map as any)._entries = []);
        const hit = entries.find((e) => typeValueEquals(e.key, key));
        if (hit) hit.value = value;
        else entries.push({ key, value });
      }
    }
    return map ?? T.unknown;
  },
  has: (key: TypeValue, map?: TypeValue) => {
    const entries = (map as any)?._entries as MapEntry[] | undefined;
    if (entries && entryKeyTrackable(key)) {
      return T.literal(entries.some((e) => typeValueEquals(e.key, key)));
    }
    return T.boolean;
  },
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
      const entries: MapEntry[] = [];
      for (const el of elements) {
        if (el.kind === "tuple" && el.elements.length >= 2) {
          keys.push(el.elements[0]);
          values.push(el.elements[1]);
          if (entryKeyTrackable(el.elements[0])) {
            entries.push({ key: el.elements[0], value: el.elements[1] });
          }
        }
      }
      if (keys.length > 0) {
        (obj as any)._typeArgs = { K: simplifyUnion(keys), V: simplifyUnion(values) };
      }
      if (entries.length > 0) {
        (obj as any)._entries = entries;
      }
    }
  }

  if (!(obj as any)._typeArgs) {
    (obj as any)._typeArgs = { K: T.unknown, V: T.unknown };
  }

  return obj;
}
