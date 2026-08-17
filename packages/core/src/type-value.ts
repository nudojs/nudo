import type { Node } from "@babel/types";
import type { Environment } from "./environment.ts";

// --- TypeValue discriminated union ---

export type LiteralValue = string | number | boolean | null | undefined;

// `thisVal` is the bound receiver when the signature is invoked as a method
// or through Function.prototype.call/apply (e.g. Object.prototype.toString
// brand computation needs it); direct calls leave it undefined.
export type SigImpl = (args: TypeValue[], thisVal?: TypeValue) => TypeValue | undefined;

export type FunctionSignature = {
  paramTypes: TypeValue[];
  returnType: TypeValue;
  throwsType: TypeValue;
  impl?: SigImpl;
};

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
  fnSig: (
    paramTypes: TypeValue[],
    returnType: TypeValue,
    throwsType: TypeValue = { kind: "never" },
    impl?: SigImpl,
  ): TypeValue => {
    const dummy = {
      kind: "function" as const,
      params: paramTypes.map((_p, i) => `_arg${i}`),
      body: { type: "BlockStatement", body: [], directives: [] } as unknown as Node,
      closure: null as unknown as Environment,
    };
    (dummy as any)._signature = { paramTypes, returnType, throwsType, impl } satisfies FunctionSignature;
    return dummy;
  },
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
  // Fast path: empty or single element
  if (members.length === 0) return T.never;
  if (members.length === 1) return members[0].kind === "never" ? T.never : members[0];

  // Fast path: two non-union elements, check equality first
  if (members.length === 2) {
    const a = members[0];
    const b = members[1];
    // Only use fast path if neither is a union (need flattening)
    if (a.kind !== "union" && b.kind !== "union") {
      if (a.kind === "never") return b.kind === "never" ? T.never : b;
      if (b.kind === "never") return a;
      if (typeValueEquals(a, b)) return a;
      if (a.kind === "unknown" || b.kind === "unknown") return T.unknown;
      return { kind: "union", members: [a, b] };
    }
  }

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

/**
 * union 成员全部为同原语基底的字面量且数量 > maxLiterals 时塌缩为该基类型；
 * 非 union、混合类型（含非字面量成员）、或数量不超限的原样返回。
 */
export function collapseLiteralUnion(tv: TypeValue, maxLiterals: number): TypeValue {
  if (tv.kind !== "union") return tv;
  if (tv.members.length <= maxLiterals) return tv;
  // 保守：成员中含非字面量（如显式 T.number）时不塌缩
  if (!tv.members.every((m) => m.kind === "literal")) return tv;
  const first = widenLiteral(tv.members[0]);
  if (!tv.members.every((m) => typeValueEquals(widenLiteral(m), first))) return tv;
  return first;
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
  // Self-referential structures (x.y = x surviving a clone) would recurse
  // infinitely: a seen-set renders revisits as an ellipsis token.
  return typeValueToStringInner(tv, new Set());
}

function typeValueToStringInner(tv: TypeValue, seen: Set<object>, depth = 0): string {
  // Path-scoped seen-set: a node renders "…" only while its own expansion
  // is on the stack (a true cycle); shared singletons (T.number in two
  // slots) still render in full. A depth cap bounds fixture-scale DAGs
  // whose repeated shared substructure would otherwise explode the string.
  if (depth > 48) return "…";
  const recur = (inner: TypeValue): string => {
    if (inner && typeof inner === "object") {
      if (seen.has(inner)) return "…";
      seen.add(inner);
      const out = typeValueToStringInner(inner, seen, depth + 1);
      seen.delete(inner);
      return out;
    }
    return typeValueToStringInner(inner, seen, depth + 1);
  };
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
        .map(([k, v]) => `${k}: ${recur(v)}`)
        .join(", ");
      return `{ ${inner} }`;
    }
    case "array":
      return `${recur(tv.element)}[]`;
    case "tuple": {
      const inner = tv.elements.map(recur).join(", ");
      return `[${inner}]`;
    }
    case "function": {
      const sig = getFnSig(tv);
      if (sig) {
        const params = sig.paramTypes.map((p, i) => `${tv.params[i]}: ${recur(p)}`).join(", ");
        return `(${params}) => ${recur(sig.returnType)}`;
      }
      const params = tv.params.join(", ");
      return `(${params}) => ...`;
    }
    case "promise":
      return `Promise<${recur(tv.value)}>`;
    case "instance": {
      const entries = Object.entries(tv.properties);
      if (entries.length === 0) return tv.className;
      const inner = entries
        .map(([k, v]) => `${k}: ${recur(v)}`)
        .join(", ");
      return `${tv.className} { ${inner} }`;
    }
    case "union": {
      return tv.members.map(recur).join(" | ");
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

export function isFnSig(tv: TypeValue): boolean {
  return tv.kind === "function" && "_signature" in tv;
}

export function getFnSig(tv: TypeValue): FunctionSignature | undefined {
  if (tv.kind === "function" && "_signature" in tv) {
    return (tv as any)._signature as FunctionSignature;
  }
  return undefined;
}
