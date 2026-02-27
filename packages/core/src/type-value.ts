import type { Node } from "@babel/types";
import type { Environment } from "./environment.ts";

// --- TypeValue discriminated union ---

export type LiteralValue = string | number | boolean | null | undefined;

export type Refinement = {
  name: string;
  meta: Record<string, unknown>;
  check?: (value: unknown) => boolean;
  ops?: Record<string, (self: TypeValue, other: TypeValue) => TypeValue | undefined>;
  methods?: Record<string, (self: TypeValue, args: TypeValue[]) => TypeValue | undefined>;
  properties?: Record<string, (self: TypeValue) => TypeValue | undefined>;
};

export type TypeValue =
  | { kind: "literal"; value: LiteralValue }
  | {
      kind: "primitive";
      type: "number" | "string" | "boolean" | "bigint" | "symbol";
    }
  | { kind: "refined"; base: TypeValue; refinement: Refinement }
  | { kind: "object"; properties: Record<string, TypeValue>; id: symbol }
  | { kind: "array"; element: TypeValue }
  | { kind: "tuple"; elements: TypeValue[] }
  | {
      kind: "function";
      params: string[];
      body: Node;
      closure: Environment;
    }
  | { kind: "promise"; value: TypeValue }
  | { kind: "instance"; className: string; properties: Record<string, TypeValue> }
  | { kind: "union"; members: TypeValue[] }
  | { kind: "never" }
  | { kind: "unknown" };

// --- T: static factory ---

function createUnion(...members: TypeValue[]): TypeValue {
  return simplifyUnion(members);
}

export const T = {
  literal: (value: LiteralValue): TypeValue => ({ kind: "literal", value }),
  number: { kind: "primitive", type: "number" } as TypeValue,
  string: { kind: "primitive", type: "string" } as TypeValue,
  boolean: { kind: "primitive", type: "boolean" } as TypeValue,
  bigint: { kind: "primitive", type: "bigint" } as TypeValue,
  symbol: { kind: "primitive", type: "symbol" } as TypeValue,
  null: { kind: "literal", value: null } as TypeValue,
  undefined: { kind: "literal", value: undefined } as TypeValue,
  unknown: { kind: "unknown" } as TypeValue,
  never: { kind: "never" } as TypeValue,

  object: (properties: Record<string, TypeValue>): TypeValue => ({
    kind: "object",
    properties,
    id: Symbol("object"),
  }),
  array: (element: TypeValue): TypeValue => ({ kind: "array", element }),
  tuple: (elements: TypeValue[]): TypeValue => ({ kind: "tuple", elements }),
  promise: (value: TypeValue): TypeValue => ({ kind: "promise", value }),
  instanceOf: (className: string, properties: Record<string, TypeValue> = {}): TypeValue => ({
    kind: "instance",
    className,
    properties,
  }),
  union: createUnion,
  fn: (
    params: string[],
    body: Node,
    closure: Environment,
  ): TypeValue => ({
    kind: "function",
    params,
    body,
    closure,
  }),
  refine: (base: TypeValue, refinement: Refinement): TypeValue => ({
    kind: "refined",
    base,
    refinement,
  }),
} as const;

// --- Helpers ---

export function typeValueEquals(a: TypeValue, b: TypeValue): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "literal" && b.kind === "literal") return a.value === b.value;
  if (a.kind === "primitive" && b.kind === "primitive") return a.type === b.type;
  if (a.kind === "never" && b.kind === "never") return true;
  if (a.kind === "unknown" && b.kind === "unknown") return true;
  if (a.kind === "refined" && b.kind === "refined") {
    return a.refinement.name === b.refinement.name && typeValueEquals(a.base, b.base);
  }
  if (a.kind === "promise" && b.kind === "promise") {
    return typeValueEquals(a.value, b.value);
  }
  if (a.kind === "instance" && b.kind === "instance") {
    return a.className === b.className;
  }
  if (a.kind === "union" && b.kind === "union") {
    return (
      a.members.length === b.members.length &&
      a.members.every((m, i) => typeValueEquals(m, b.members[i]))
    );
  }
  return a === b;
}

export function simplifyUnion(members: TypeValue[]): TypeValue {
  const flat: TypeValue[] = [];
  for (const m of members) {
    if (m.kind === "never") continue;
    if (m.kind === "union") {
      flat.push(...m.members);
    } else {
      flat.push(m);
    }
  }

  const deduped: TypeValue[] = [];
  for (const m of flat) {
    if (!deduped.some((d) => typeValueEquals(d, m))) {
      deduped.push(m);
    }
  }

  if (deduped.length === 0) return T.never;
  if (deduped.length === 1) return deduped[0];
  if (deduped.some((m) => m.kind === "unknown")) return T.unknown;
  return { kind: "union", members: deduped };
}

export function widenLiteral(tv: TypeValue): TypeValue {
  if (tv.kind !== "literal") return tv;
  const v = tv.value;
  if (typeof v === "number") return T.number;
  if (typeof v === "string") return T.string;
  if (typeof v === "boolean") return T.boolean;
  if (v === null) return T.null;
  if (v === undefined) return T.undefined;
  return T.unknown;
}

export function isSubtypeOf(a: TypeValue, b: TypeValue): boolean {
  if (b.kind === "unknown") return true;
  if (a.kind === "never") return true;
  if (typeValueEquals(a, b)) return true;

  if (a.kind === "literal" && b.kind === "primitive") {
    const v = a.value;
    if (b.type === "number" && typeof v === "number") return true;
    if (b.type === "string" && typeof v === "string") return true;
    if (b.type === "boolean" && typeof v === "boolean") return true;
    return false;
  }

  if (a.kind === "literal" && b.kind === "refined") {
    if (!isSubtypeOf(a, b.base)) return false;
    return b.refinement.check ? b.refinement.check(a.value) : false;
  }

  if (a.kind === "refined") {
    if (b.kind === "refined" && a.refinement.name === b.refinement.name) {
      return isSubtypeOf(a.base, b.base);
    }
    return isSubtypeOf(a.base, b);
  }

  if (a.kind === "object" && b.kind === "object") {
    return Object.entries(b.properties).every(
      ([k, bv]) => k in a.properties && isSubtypeOf(a.properties[k], bv),
    );
  }

  if (a.kind === "array" && b.kind === "array") {
    return isSubtypeOf(a.element, b.element);
  }

  if (a.kind === "tuple" && b.kind === "tuple") {
    return (
      a.elements.length === b.elements.length &&
      a.elements.every((el, i) => isSubtypeOf(el, b.elements[i]))
    );
  }

  if (a.kind === "tuple" && b.kind === "array") {
    return a.elements.every((el) => isSubtypeOf(el, b.element));
  }

  if (a.kind === "promise" && b.kind === "promise") {
    return isSubtypeOf(a.value, b.value);
  }

  if (a.kind === "instance" && b.kind === "instance") {
    return a.className === b.className || isErrorSubclass(a.className, b.className);
  }

  if (a.kind === "union") {
    return a.members.every((m) => isSubtypeOf(m, b));
  }

  if (b.kind === "union") {
    return b.members.some((m) => isSubtypeOf(a, m));
  }

  return false;
}

const errorHierarchy: Record<string, string> = {
  TypeError: "Error",
  SyntaxError: "Error",
  RangeError: "Error",
  ReferenceError: "Error",
  URIError: "Error",
  EvalError: "Error",
};

function isErrorSubclass(child: string, parent: string): boolean {
  if (child === parent) return true;
  const sup = errorHierarchy[child];
  return sup ? isErrorSubclass(sup, parent) : false;
}

export function deepCloneTypeValue(tv: TypeValue, idMap?: Map<symbol, symbol>): TypeValue {
  const map = idMap ?? new Map<symbol, symbol>();
  if (tv.kind === "object") {
    let newId = map.get(tv.id);
    if (!newId) {
      newId = Symbol("object");
      map.set(tv.id, newId);
    }
    const newProps: Record<string, TypeValue> = {};
    for (const [k, v] of Object.entries(tv.properties)) {
      newProps[k] = deepCloneTypeValue(v, map);
    }
    return { kind: "object", properties: newProps, id: newId };
  }
  if (tv.kind === "array") {
    return { kind: "array", element: deepCloneTypeValue(tv.element, map) };
  }
  if (tv.kind === "tuple") {
    return { kind: "tuple", elements: tv.elements.map((e) => deepCloneTypeValue(e, map)) };
  }
  if (tv.kind === "promise") {
    return { kind: "promise", value: deepCloneTypeValue(tv.value, map) };
  }
  if (tv.kind === "instance") {
    const newProps: Record<string, TypeValue> = {};
    for (const [k, v] of Object.entries(tv.properties)) {
      newProps[k] = deepCloneTypeValue(v, map);
    }
    return { kind: "instance", className: tv.className, properties: newProps };
  }
  if (tv.kind === "refined") {
    return { kind: "refined", base: deepCloneTypeValue(tv.base, map), refinement: tv.refinement };
  }
  if (tv.kind === "union") {
    return simplifyUnion(tv.members.map((m) => deepCloneTypeValue(m, map)));
  }
  return tv;
}

export function mergeObjectProperties(
  a: TypeValue & { kind: "object" },
  b: TypeValue & { kind: "object" },
): TypeValue {
  const allKeys = new Set([...Object.keys(a.properties), ...Object.keys(b.properties)]);
  const merged: Record<string, TypeValue> = {};
  for (const k of allKeys) {
    const av = a.properties[k];
    const bv = b.properties[k];
    if (av && bv) {
      merged[k] = simplifyUnion([av, bv]);
    } else {
      merged[k] = av ?? bv;
    }
  }
  return { kind: "object", properties: merged, id: a.id };
}

export function typeValueToString(tv: TypeValue): string {
  switch (tv.kind) {
    case "literal": {
      const v = tv.value;
      if (v === null) return "null";
      if (v === undefined) return "undefined";
      if (typeof v === "string") return JSON.stringify(v);
      return String(v);
    }
    case "primitive":
      return tv.type;
    case "refined":
      return tv.refinement.name;
    case "object": {
      const entries = Object.entries(tv.properties);
      if (entries.length === 0) return "{}";
      const inner = entries
        .map(([k, v]) => `${k}: ${typeValueToString(v)}`)
        .join(", ");
      return `{ ${inner} }`;
    }
    case "array":
      return `${typeValueToString(tv.element)}[]`;
    case "tuple": {
      const inner = tv.elements.map(typeValueToString).join(", ");
      return `[${inner}]`;
    }
    case "function": {
      const params = tv.params.join(", ");
      return `(${params}) => ...`;
    }
    case "promise":
      return `Promise<${typeValueToString(tv.value)}>`;
    case "instance": {
      const entries = Object.entries(tv.properties);
      if (entries.length === 0) return tv.className;
      const inner = entries
        .map(([k, v]) => `${k}: ${typeValueToString(v)}`)
        .join(", ");
      return `${tv.className} { ${inner} }`;
    }
    case "union": {
      return tv.members.map(typeValueToString).join(" | ");
    }
    case "never":
      return "never";
    case "unknown":
      return "unknown";
  }
}

export function narrowType(
  tv: TypeValue,
  predicate: (member: TypeValue) => boolean,
): TypeValue {
  if (tv.kind === "union") {
    return simplifyUnion(tv.members.filter(predicate));
  }
  return predicate(tv) ? tv : T.never;
}

export function subtractType(
  tv: TypeValue,
  predicate: (member: TypeValue) => boolean,
): TypeValue {
  return narrowType(tv, (m) => !predicate(m));
}

export function getPrimitiveTypeOf(tv: TypeValue): string | undefined {
  if (tv.kind === "literal") {
    const v = tv.value;
    if (v === null) return "object";
    return typeof v;
  }
  if (tv.kind === "primitive") return tv.type;
  if (tv.kind === "refined") return getPrimitiveTypeOf(tv.base);
  if (tv.kind === "object") return "object";
  if (tv.kind === "array" || tv.kind === "tuple") return "object";
  if (tv.kind === "function") return "function";
  if (tv.kind === "promise") return "object";
  if (tv.kind === "instance") return "object";
  return undefined;
}

export function getRefinedBase(tv: TypeValue): TypeValue {
  return tv.kind === "refined" ? getRefinedBase(tv.base) : tv;
}
