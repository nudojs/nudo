import { type TypeValue, T, simplifyUnion, typeValueEquals } from "@nudojs/core";

// Literal/instance keys recorded at construction (`new Map([['k', v]])`) or
// via set() — precise enough for typeValueEquals lookup. Symbolic keys are
// skipped: they cannot be definitely matched, so get() falls back to the
// V | undefined approximation.
export type MapEntry = { key: TypeValue; value: TypeValue };

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
    const entries = exactMapEntries(map);
    if (entries) {
      const looked = lookupEntries(entries, key);
      if (looked !== null) return looked;
    }
    const typeArgs = (map as any)?._typeArgs;
    if (typeArgs?.V) return T.union(typeArgs.V, T.undefined);
    // Untyped receiver (unknown / non-Map value reaching the impl): a
    // definite undefined would be a false claim and poison downstream
    // guards (hoek isDeepEqual's `ref.name` path) into error-severity
    // misses. Unknown keeps it honest.
    return T.unknown;
  },
  set: (key: TypeValue, value: TypeValue, map?: TypeValue) => {
    if (map) {
      const typeArgs = (map as any)._typeArgs || { K: T.unknown, V: T.unknown };
      (map as any)._typeArgs = {
        K: typeArgs.K.kind === "unknown" ? key : simplifyUnion([typeArgs.K, key]),
        V: typeArgs.V.kind === "unknown" ? value : simplifyUnion([typeArgs.V, value]),
      };
      if (entryKeyTrackable(key)) {
        // An exact entry list can start on the first trackable set()
        // (nothing untracked came before); once partial it stays partial.
        if ((map as any)._entries === undefined && (map as any)._entriesExact !== false) {
          (map as any)._entries = [];
          (map as any)._entriesExact = true;
        }
        if ((map as any)._entriesExact) {
          const entries = (map as any)._entries as MapEntry[];
          const hit = entries.find((e) => typeValueEquals(e.key, key));
          if (hit) hit.value = value;
          else entries.push({ key, value });
        }
      } else {
        (map as any)._entriesExact = false;
      }
    }
    return map ?? T.unknown;
  },
  has: (key: TypeValue, map?: TypeValue) => {
    const entries = exactMapEntries(map);
    if (entries && entryKeyTrackable(key)) {
      return T.literal(entries.some((e) => typeValueEquals(e.key, key)));
    }
    return T.boolean;
  },
  delete: (key: TypeValue, map?: TypeValue) => {
    const entries = exactMapEntries(map);
    if (entries && entryKeyTrackable(key)) {
      const idx = entries.findIndex((e) => typeValueEquals(e.key, key));
      if (idx >= 0) {
        entries.splice(idx, 1);
        return T.literal(true);
      }
      return T.literal(false);
    }
    return T.boolean;
  },
  clear: (value?: TypeValue, map?: TypeValue) => {
    // m.clear() arrives as clear(receiver): the map sits in the first
    // param slot when the call has no arguments.
    const target = map ?? value;
    if (target && (target as any)._entriesExact) {
      (target as any)._entries = [];
    }
    return T.undefined;
  },
  forEach: () => T.undefined,
  keys: (map?: TypeValue) => {
    const entries = exactMapEntries(map);
    if (entries) return T.tuple(entries.map((e) => e.key));
    const typeArgs = (map as any)?._typeArgs;
    if (typeArgs?.K) return T.array(typeArgs.K);
    return T.array(T.unknown);
  },
  values: (map?: TypeValue) => {
    const entries = exactMapEntries(map);
    if (entries) return T.tuple(entries.map((e) => e.value));
    const typeArgs = (map as any)?._typeArgs;
    if (typeArgs?.V) return T.array(typeArgs.V);
    return T.array(T.unknown);
  },
  entries: (map?: TypeValue) => mapEntriesIterable(map),
};

// Exact entry side table: present only when every key seen so far
// (construction pairs + set() calls) was trackable. Partial tables must
// not decide get()/has()/delete()/iteration — an untracked key could map
// to anything.
export function exactMapEntries(map: TypeValue | undefined): MapEntry[] | undefined {
  if (!map || (map as any)._entriesExact !== true) return undefined;
  return (map as any)._entries as MapEntry[] | undefined;
}

// entries() keeps feeding for-of destructuring (`for (const [k, v] of m)`)
// and `new Map(...)` consumers: a tuple of [key, value] pairs when the
// side table is complete, else Array<[K, V]>.
export function mapEntriesIterable(map: TypeValue | undefined): TypeValue {
  const entries = exactMapEntries(map);
  if (entries) return T.tuple(entries.map((e) => T.tuple([e.key, e.value])));
  const typeArgs = (map as any)?._typeArgs;
  if (typeArgs?.K && typeArgs?.V) return T.array(T.tuple([typeArgs.K, typeArgs.V]));
  return T.array(T.tuple([T.unknown, T.unknown]));
}

export function createMapType(args?: TypeValue[]): TypeValue {
  const obj = T.instanceOf("Map", {});

  if (args && args.length > 0) {
    const arg = args[0];
    if (arg.kind === "tuple" || arg.kind === "array") {
      const elements = arg.kind === "tuple" ? arg.elements : [arg.element];
      const keys: TypeValue[] = [];
      const values: TypeValue[] = [];
      const entries: MapEntry[] = [];
      let exact = true;
      for (const el of elements) {
        if (el.kind === "tuple" && el.elements.length >= 2) {
          keys.push(el.elements[0]);
          values.push(el.elements[1]);
          if (entryKeyTrackable(el.elements[0])) {
            entries.push({ key: el.elements[0], value: el.elements[1] });
          } else {
            exact = false;
          }
        }
      }
      if (keys.length > 0) {
        (obj as any)._typeArgs = { K: simplifyUnion(keys), V: simplifyUnion(values) };
      }
      // Only a fully trackable key list is exact: symbolic keys mean the
      // recorded entries are a subset of the real ones.
      if (exact && entries.length > 0) {
        (obj as any)._entries = entries;
        (obj as any)._entriesExact = true;
      } else if (!exact) {
        (obj as any)._entriesExact = false;
      }
    }
  }

  if (!(obj as any)._typeArgs) {
    (obj as any)._typeArgs = { K: T.unknown, V: T.unknown };
  }

  return obj;
}
