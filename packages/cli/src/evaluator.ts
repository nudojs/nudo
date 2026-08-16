import type { Node } from "@babel/types";
import {
  type TypeValue,
  T,
  simplifyUnion,
  applyBinaryOp,
  dispatchBinaryOp,
  dispatchMethod,
  dispatchProperty,
  Ops,
  type Environment,
  createEnvironment,
  deepCloneTypeValue,
  mergeObjectProperties,
  typeValueEquals,
  typeValueToString,
  isSubtypeOf,
  widenLiteral,
  createTemplate,
  subtractType,
  getFnSig,
} from "@nudojs/core";
import { extractInlineDirectives, type InlineDirective } from "@nudojs/parser";
import { narrow } from "./narrowing.ts";
import { PROMISE_STATIC_METHODS, evaluatePromiseStaticMethod, evaluatePromiseInstanceMethod } from "./builtins/builtin-promise.ts";
import { MAP_INSTANCE_METHODS, createMapType } from "./builtins/builtin-map.ts";
import { SET_INSTANCE_METHODS, createSetType } from "./builtins/builtin-set.ts";
import { REGEXP_INSTANCE_METHODS, createRegExpType } from "./builtins/builtin-regexp.ts";
import { URL_INSTANCE_METHODS, URLSearchParams_INSTANCE_METHODS, createURLType, createURLSearchParamsType } from "./builtins/builtin-url.ts";
import {
  RESPONSE_INSTANCE_METHODS,
  HEADERS_INSTANCE_METHODS,
  FORMDATA_INSTANCE_METHODS,
  ABORTCONTROLLER_INSTANCE_METHODS,
  createResponseType,
  createHeadersType,
  createFormDataType,
  createAbortControllerType,
} from "./builtins/builtin-web.ts";
import { WEAKMAP_INSTANCE_METHODS, WEAKSET_INSTANCE_METHODS, createWeakMapType, createWeakSetType } from "./builtins/builtin-weak.ts";
import { SYMBOL_STATIC_METHODS, SYMBOL_STATIC_PROPS } from "./builtins/builtin-symbol.ts";
import { REFLECT_METHODS } from "./builtins/builtin-reflect.ts";
import { INTL_DATETIMEFORMAT_METHODS, INTL_NUMBERFORMAT_METHODS, createDateTimeFormatType, createNumberFormatType } from "./builtins/builtin-intl.ts";

// Built-in JavaScript API type mappings
// Namespace objects (e.g. Math.floor) and direct global values (e.g. parseInt)
const BUILTIN_STATIC_METHODS: Record<string, Record<string, TypeValue> | TypeValue> = {
  Date: {
    now: T.number,
    parse: T.number,
    UTC: T.number,
  },
  Math: {
    random: T.number,
    floor: T.fn(["x"], { type: "BlockStatement", body: [] } as any, undefined as any),
    ceil: T.fn(["x"], { type: "BlockStatement", body: [] } as any, undefined as any),
    round: T.fn(["x"], { type: "BlockStatement", body: [] } as any, undefined as any),
    abs: T.fn(["x"], { type: "BlockStatement", body: [] } as any, undefined as any),
    max: T.fn(["...args"], { type: "BlockStatement", body: [] } as any, undefined as any),
    min: T.fn(["...args"], { type: "BlockStatement", body: [] } as any, undefined as any),
    sqrt: T.fn(["x"], { type: "BlockStatement", body: [] } as any, undefined as any),
    pow: T.fn(["base", "exp"], { type: "BlockStatement", body: [] } as any, undefined as any),
  },
  JSON: {
    parse: T.unknown,
    stringify: T.string,
  },
  Object: {
    keys: T.array(T.string),
    values: T.array(T.unknown),
    entries: T.array(T.tuple([T.string, T.unknown])),
    assign: T.unknown,
  },
  Array: {
    isArray: T.boolean,
    from: T.array(T.unknown),
  },
  Number: {
    isNaN: T.boolean,
    isFinite: T.boolean,
    parseInt: T.number,
    parseFloat: T.number,
  },
  String: {
    fromCharCode: T.string,
  },
  Promise: PROMISE_STATIC_METHODS,
  Symbol: { ...SYMBOL_STATIC_METHODS, ...SYMBOL_STATIC_PROPS },
  Reflect: REFLECT_METHODS as unknown as Record<string, TypeValue>,
  Intl: {
    DateTimeFormat: T.fn(["...args"], { type: "BlockStatement", body: [] } as any, undefined as any),
    NumberFormat: T.fn(["...args"], { type: "BlockStatement", body: [] } as any, undefined as any),
  },
  parseInt: T.number,
  parseFloat: T.number,
  isNaN: T.boolean,
  isFinite: T.boolean,
};

const BUILTIN_INSTANCE_METHODS: Record<string, Record<string, (...args: TypeValue[]) => TypeValue>> = {
  Date: {
    getTime: () => T.number,
    getFullYear: () => T.number,
    getMonth: () => T.number,
    getDate: () => T.number,
    getHours: () => T.number,
    getMinutes: () => T.number,
    getSeconds: () => T.number,
    getMilliseconds: () => T.number,
    toISOString: () => T.string,
    toString: () => T.string,
    valueOf: () => T.number,
  },
  WeakMap: WEAKMAP_INSTANCE_METHODS,
  WeakSet: WEAKSET_INSTANCE_METHODS,
  DateTimeFormat: INTL_DATETIMEFORMAT_METHODS,
  NumberFormat: INTL_NUMBERFORMAT_METHODS,
};

const BUILTIN_ERROR_CLASSES = new Set([
  "Error", "TypeError", "SyntaxError", "RangeError", "ReferenceError", "URIError", "EvalError",
]);

// Constructible built-in classes. A bare reference to one of these names
// resolves to a namespace object (like the BUILTIN_STATIC_METHODS entries),
// and `X.prototype` evaluates to an instance of X instead of degrading to
// undefined/unknown.
const BUILTIN_PROTOTYPE_CLASSES = new Set([
  ...BUILTIN_ERROR_CLASSES,
  "Date", "Object", "Map", "Set", "Promise", "RegExp", "Array", "Function",
  "String", "Number", "Boolean", "Symbol", "WeakMap", "WeakSet",
]);

// Object.prototype members. Real property access reads through the
// prototype chain, so every object-typed receiver materializes these —
// destructuring `const { hasOwnProperty } = obj` yields a function (not
// undefined) and `Object.prototype.hasOwnProperty` types as boolean.
// Lookup must be own-property guarded: a plain `{}` record would otherwise
// leak native JS functions (e.g. for "constructor") into the type system.
const OBJECT_PROTOTYPE_METHODS: Record<string, TypeValue> = {
  hasOwnProperty: T.fnSig([T.unknown], T.boolean),
  isPrototypeOf: T.fnSig([T.unknown], T.boolean),
  propertyIsEnumerable: T.fnSig([T.unknown], T.boolean),
  toString: T.fnSig([], T.string),
  toLocaleString: T.fnSig([], T.string),
  valueOf: T.fnSig([], T.unknown),
};

type SourceRange = { start: { line: number; column: number }; end: { line: number; column: number } };

let _currentSource = "";

export function setCurrentSource(source: string): void {
  _currentSource = source;
}

type ActiveReplace = { targetSource: string; typeExpr: TypeValue };
let _activeReplacements: ActiveReplace[] = [];
let _activeAsOverride: TypeValue | null = null;

function nodeSourceText(node: Node): string | null {
  if (node.start == null || node.end == null || !_currentSource) return null;
  return _currentSource.slice(node.start, node.end);
}

function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, "");
}

function matchesReplacement(node: Node): TypeValue | null {
  if (_activeReplacements.length === 0) return null;
  const src = nodeSourceText(node);
  if (!src) return null;
  const normalized = normalizeWhitespace(src);
  for (const r of _activeReplacements) {
    if (normalizeWhitespace(r.targetSource) === normalized) return r.typeExpr;
  }
  return null;
}

const RETURN_SIGNAL = Symbol("ReturnSignal");
const BRANCH_SIGNAL = Symbol("BranchSignal");
const THROW_SIGNAL = Symbol("ThrowSignal");

type ReturnSignal = {
  readonly [RETURN_SIGNAL]: true;
  readonly value: TypeValue;
};

type BranchSignal = {
  readonly [BRANCH_SIGNAL]: true;
  readonly returnedValue: TypeValue;
  readonly fallthroughEnv: Environment;
};

type ThrowSignal = {
  readonly [THROW_SIGNAL]: true;
  readonly thrown: TypeValue;
  readonly loc?: SourceRange;
};

function makeReturn(value: TypeValue): ReturnSignal {
  return { [RETURN_SIGNAL]: true, value };
}

function makeBranch(returnedValue: TypeValue, fallthroughEnv: Environment): BranchSignal {
  return { [BRANCH_SIGNAL]: true, returnedValue, fallthroughEnv };
}

function makeThrow(thrown: TypeValue, loc?: SourceRange): ThrowSignal {
  return { [THROW_SIGNAL]: true, thrown, loc };
}

function isReturn(v: unknown): v is ReturnSignal {
  return typeof v === "object" && v !== null && RETURN_SIGNAL in v;
}

function isBranch(v: unknown): v is BranchSignal {
  return typeof v === "object" && v !== null && BRANCH_SIGNAL in v;
}

function isThrow(v: unknown): v is ThrowSignal {
  return typeof v === "object" && v !== null && THROW_SIGNAL in v;
}

type EvalResult = TypeValue | ReturnSignal | BranchSignal | ThrowSignal;

const MEMO_IN_PROGRESS = Symbol("MemoInProgress");
const callMemo = new Map<string, TypeValue | typeof MEMO_IN_PROGRESS>();

function buildMemoKey(
  fn: TypeValue & { kind: "function" },
  args: TypeValue[],
  thisVal?: TypeValue,
): string | null {
  const fnName = (fn as any)._memoize as string | undefined;
  if (!fnName) return null;
  const argsKey = args.map(typeValueToString).join(",");
  // `this` participates in the key: obj1.f() and obj2.f() must not share a
  // memo entry when f reads `this`.
  const thisKey = thisVal ? `this:${typeValueToString(thisVal)};` : "";
  return `${fnName}(${thisKey}${argsKey})`;
}

const moduleCache = new Map<string, Environment>();

export function resetMemo(): void {
  callMemo.clear();
  moduleCache.clear();
  _callDepth = 0;
  _totalCalls = 0;
  _activeCallKeys.length = 0;
}

export function setModuleResolver(resolver: ((source: string, fromDir: string) => { ast: Node; filePath: string; json?: unknown } | null) | null): void {
  currentModuleResolver = resolver;
}

let currentModuleResolver: ((source: string, fromDir: string) => { ast: Node; filePath: string; json?: unknown } | null) | null = null;
let currentFileDir = "";

let envModules: Record<string, Record<string, TypeValue>> = {};
let mockModules: Map<string, { fromPath: string; names?: string[] }> = new Map();

export function setEnvModules(modules: Record<string, Record<string, TypeValue>>): void {
  envModules = modules;
}

export function resetEnvModules(): void {
  envModules = {};
}

export function setMockModules(mocks: Map<string, { fromPath: string; names?: string[] }>): void {
  mockModules = mocks;
}

export function resetMockModules(): void {
  mockModules = new Map();
}

let _nodeTypeCollector: ((node: Node, tv: TypeValue) => void) | null = null;
let _sampleCount = 3;
let _maxConcreteIter = 1000;

let _onUnknownBuiltin: ((name: string, loc?: { start: { line: number; column: number }; end: { line: number; column: number } }) => void) | null = null;

export function setUnknownBuiltinHandler(handler: ((name: string, loc?: { start: { line: number; column: number }; end: { line: number; column: number } }) => void) | null) {
  _onUnknownBuiltin = handler;
}

export function setSampleCount(count: number): void {
  _sampleCount = count;
}

export function setMaxConcreteIter(count: number): void {
  _maxConcreteIter = count;
}

export function setNodeTypeCollector(collector: ((node: Node, tv: TypeValue) => void) | null): void {
  _nodeTypeCollector = collector;
}

function recordNodeType(node: Node, tv: TypeValue): void {
  if (_nodeTypeCollector && node.loc) {
    _nodeTypeCollector(node, tv);
  }
}

export type CallRecord = {
  fnName: string;
  argTypes: TypeValue[];
  resultType: TypeValue;
  throws: TypeValue;
  callLoc?: { line: number; column: number };
  targetModule?: string;
  targetExport?: string;
  /** export names the same function value was re-exported under after its
   * defining module (barrel `index.js`, CJS forwarding shims); usage-site
   * records stay name-matchable against them */
  targetAliases?: string[];
};

// --- Cross-module call attribution ---
// Module-exported function values get tagged with their (module, export)
// origin when the module environment is first built (moduleCache fill). The
// same object reference flows through import bindings to call sites, so
// recordCall can look the tag up from the evaluated callee value and mark the
// record as targeting another module. Non-function exports are not tagged.

const _exportTags = new WeakMap<object, { module: string; export: string; aliases?: string[] }>();

/** Tag a function value with its exporting (module, export). A re-export
 * chain — a barrel `index.js` doing `parseChunked: require('./parse-chunked')`,
 * a CJS shim doing `module.exports = require('../../src/index.js')` — flows
 * ONE function value through several module scopes, and each scope's tagging
 * pass used to overwrite the tag with its own (module, export), so usage-site
 * records ended up pointing at the last intermediary instead of the defining
 * file. Now the first (definition-site) tag sticks; later export names
 * accumulate as aliases. */
function tagExport(v: TypeValue & { kind: "function" }, filePath: string, name: string): void {
  const existing = _exportTags.get(v);
  if (existing) {
    if (existing.module === filePath && existing.export === name) return;
    if (!existing.aliases) existing.aliases = [];
    if (!existing.aliases.includes(name)) existing.aliases.push(name);
    return;
  }
  _exportTags.set(v, { module: filePath, export: name });
}

function tagModuleExports(env: Environment, filePath: string): void {
  const bindings = env.getOwnBindings();
  for (const [k, v] of Object.entries(bindings)) {
    if (!k.startsWith("__export_")) continue;
    if (v.kind !== "function") continue;
    const name = k === "__export_default" ? "default" : k.slice("__export_".length);
    tagExport(v, filePath, name);
  }
}

// --- CommonJS module scope ---
// v1 does not distinguish module systems: every evaluated program (top-level
// or module load) gets the implicit CJS bindings, so `require` /
// `module.exports` / `exports.x` patterns analyze even inside ESM files.

const _cjsRequireValue = T.fn(["specifier"], { type: "BlockStatement", body: [] } as any, undefined as any);

function bindCommonJsGlobals(env: Environment): void {
  if (env.has("module")) return; // already set up as a module scope
  const exportsObj = T.object({});
  // Marker so require() can tell "target never wrote CJS exports" apart from
  // an explicit `module.exports = {...}` replacement.
  (exportsObj as any).__cjsExportsRoot = true;
  const moduleObj = T.object({ exports: exportsObj });
  env.bind("exports", exportsObj);
  env.bind("module", moduleObj);
  env.bind("require", _cjsRequireValue);
  env.bind("__dirname", T.string);
  env.bind("__filename", T.string);
}

// CJS exports are plain values (`module.exports` itself, or its properties),
// not `__export_` bindings; tag the function values the same way so
// cross-module call attribution also works for require()d modules.
function tagCommonJsExports(env: Environment, filePath: string): void {
  if (!env.has("module")) return;
  const moduleVal = env.lookup("module");
  if (moduleVal.kind !== "object") return;
  const exp = moduleVal.properties["exports"];
  if (!exp) return;
  if (exp.kind === "function") {
    tagExport(exp, filePath, "default");
    return;
  }
  if (exp.kind === "object") {
    for (const [k, v] of Object.entries(exp.properties)) {
      if (v.kind === "function") tagExport(v, filePath, k);
    }
  }
}

let _callCollector: ((record: CallRecord) => void) | null = null;

export function setCallCollector(collector: ((record: CallRecord) => void) | null): void {
  _callCollector = collector;
}

function recordCall(
  fnName: string,
  args: TypeValue[],
  result: { value: TypeValue; throws: TypeValue },
  loc: Node["loc"],
  calleeVal?: TypeValue,
): void {
  if (!_callCollector) return;
  const record: CallRecord = {
    fnName,
    argTypes: args,
    resultType: result.value,
    throws: result.throws,
    callLoc: loc ? { line: loc.start.line, column: loc.start.column } : undefined,
  };
  const tag = calleeVal ? _exportTags.get(calleeVal) : undefined;
  if (tag) {
    record.targetModule = tag.module;
    record.targetExport = tag.export;
    if (tag.aliases && tag.aliases.length > 0) record.targetAliases = [...tag.aliases];
  }
  _callCollector(record);
}

export type UnknownRecord = {
  kind: "method" | "property" | "global";
  name: string;
  receiverType?: TypeValue;
  loc?: { line: number; column: number };
  reason?: string;
  origin?: { line: number; column: number };
};

let _unknownCollector: ((record: UnknownRecord) => void) | null = null;

export function setUnknownCollector(collector: ((record: UnknownRecord) => void) | null): void {
  _unknownCollector = collector;
}

// --- Provenance side table ---
// Maps an argument TypeValue (annotated at its call-site expression in
// evaluateArgs) back to the source location of the expression that produced it.
// The same object references flow into parameter bindings, so recordUnknown can
// reverse-lookup where a receiver value originated from. Disabled by default;
// zero overhead when off.

const _originMap = new WeakMap<TypeValue, { line: number; column: number }>();
let _provenanceEnabled = false;

export function setProvenanceTracking(enabled: boolean): void {
  _provenanceEnabled = enabled;
}

function extractOrigin(
  tv: TypeValue | undefined,
): { line: number; column: number } | undefined {
  if (!_provenanceEnabled || !tv) return undefined;
  const direct = _originMap.get(tv);
  if (direct) return direct;
  if (tv.kind === "union") {
    for (const member of tv.members) {
      const found = _originMap.get(member);
      if (found) return found;
    }
  } else if (tv.kind === "object") {
    for (const propVal of Object.values(tv.properties)) {
      const found = _originMap.get(propVal);
      if (found) return found;
    }
  }
  return undefined;
}

/** Own-property check for plain record tables. Plain `{}` records inherit
 * Object.prototype, so `in` / bracket access would leak native members
 * (e.g. the real JS `hasOwnProperty`, `toString`) into the type system as
 * bogus values. */
function hasOwnProp(props: Record<string, unknown>, name: string): boolean {
  return Object.prototype.hasOwnProperty.call(props, name);
}

function recordUnknown(r: Omit<UnknownRecord, "loc"> & { loc?: Node["loc"] }): void {
  if (!_unknownCollector) return;
  const origin = r.kind === "method" || r.kind === "property"
    ? extractOrigin(r.receiverType)
    : undefined;
  _unknownCollector({
    ...r,
    origin,
    loc: r.loc ? { line: r.loc.start.line, column: r.loc.start.column } : undefined,
  });
}

function distributeOverUnion(
  tv: TypeValue,
  fn: (member: TypeValue) => TypeValue,
): TypeValue {
  if (tv.kind === "union") {
    return simplifyUnion(tv.members.map(fn));
  }
  return fn(tv);
}

const MAX_UNION_PRODUCT = 50;

function distributeBinaryOverUnion(
  left: TypeValue,
  right: TypeValue,
  fn: (l: TypeValue, r: TypeValue) => TypeValue,
): TypeValue {
  if (left.kind === "union" && right.kind === "union") {
    // Cap combinatorial blowup
    if (left.members.length * right.members.length > MAX_UNION_PRODUCT) {
      return T.unknown;
    }
    return simplifyUnion(
      left.members.flatMap((l) => right.members.map((r) => fn(l, r))),
    );
  }
  if (left.kind === "union") {
    return simplifyUnion(left.members.map((l) => fn(l, right)));
  }
  if (right.kind === "union") {
    return simplifyUnion(right.members.map((r) => fn(left, r)));
  }
  return fn(left, right);
}

let _unreachableRanges: SourceRange[] = [];

function collectUnreachable(stmts: readonly Node[], fromIndex: number): void {
  for (let j = fromIndex; j < stmts.length; j++) {
    const s = stmts[j];
    if (s.loc) {
      _unreachableRanges.push({
        start: { line: s.loc.start.line, column: s.loc.start.column },
        end: { line: s.loc.end.line, column: s.loc.end.column },
      });
    }
  }
}

function evaluateStatements(
  stmts: readonly Node[],
  env: Environment,
): EvalResult {
  const returnValues: TypeValue[] = [];
  let currentEnv = env;
  let lastValue: TypeValue = T.undefined;

  for (let i = 0; i < stmts.length; i++) {
    const stmt = stmts[i];

    const inlineDirectives = extractInlineDirectives(stmt);
    const savedAs = _activeAsOverride;
    const savedReplacements = _activeReplacements;

    const asDir = inlineDirectives.find((d): d is InlineDirective & { kind: "as" } => d.kind === "as");
    const replaceDirs = inlineDirectives.filter((d): d is InlineDirective & { kind: "replace" } => d.kind === "replace");

    _activeAsOverride = asDir?.typeExpr ?? null;
    _activeReplacements = replaceDirs.length > 0
      ? replaceDirs.map((d) => ({ targetSource: d.targetSource, typeExpr: d.typeExpr }))
      : [];

    const result = evaluate(stmt, currentEnv);

    _activeAsOverride = savedAs;
    _activeReplacements = savedReplacements;

    if (isThrow(result)) {
      collectUnreachable(stmts, i + 1);
      return result;
    }

    if (isReturn(result)) {
      returnValues.push(result.value);
      collectUnreachable(stmts, i + 1);
      return makeReturn(simplifyUnion(returnValues));
    }

    if (isBranch(result)) {
      returnValues.push(result.returnedValue);
      currentEnv = result.fallthroughEnv;
      continue;
    }

    lastValue = result;
  }

  if (returnValues.length > 0) {
    return makeBranch(simplifyUnion(returnValues), currentEnv);
  }

  return lastValue;
}

function describeParam(p: Node): string {
  if (p.type === "Identifier") return p.name;
  if (p.type === "AssignmentPattern" && p.left.type === "Identifier") return p.left.name;
  if (p.type === "AssignmentPattern") return describeParam(p.left);
  if (p.type === "RestElement") return `...${describeParam(p.argument)}`;
  if (p.type === "ObjectPattern") {
    const keys = p.properties.map((prop: any) => {
      if (prop.type === "RestElement") return `...${describeParam(prop.argument)}`;
      const key = prop.key?.type === "Identifier" ? prop.key.name : "?";
      return key;
    });
    return `{ ${keys.join(", ")} }`;
  }
  if (p.type === "ArrayPattern") {
    const elems = p.elements.map((e: any) => (e ? describeParam(e) : ""));
    return `[${elems.join(", ")}]`;
  }
  return "_";
}

export function evaluate(node: Node, env: Environment): EvalResult {
  const replacement = matchesReplacement(node);
  if (replacement) return replacement;

  const result = evaluateNode(node, env);
  if (_nodeTypeCollector && node.loc && !isReturn(result) && !isBranch(result) && !isThrow(result)) {
    recordNodeType(node, result);
  }
  return result;
}

function evaluateNode(node: Node, env: Environment): EvalResult {
  switch (node.type) {
    case "File":
      return evaluate(node.program, env);

    case "Program":
      return evaluateStatements(node.body, env);

    case "ExpressionStatement":
      if (_activeAsOverride) return _activeAsOverride;
      return evaluate(node.expression, env);

    case "NumericLiteral":
      return T.literal(node.value);

    case "StringLiteral":
      return T.literal(node.value);

    case "BooleanLiteral":
      return T.literal(node.value);

    case "NullLiteral":
      return T.null;

    case "RegExpLiteral":
      return createRegExpType();

    case "Identifier": {
      if (node.name === "undefined") return T.undefined;
      // Check for built-in global objects (env-injected values take priority,
      // e.g. @nudo:env es binds fnSig-backed globals with precise impls).
      // hasOwnProp guard: `in` would hit the JS prototype chain and leak
      // native functions for names like `hasOwnProperty`.
      if (hasOwnProp(BUILTIN_STATIC_METHODS, node.name) && !env.has(node.name)) {
        const builtin = BUILTIN_STATIC_METHODS[node.name];
        if (typeof builtin === "object" && builtin !== null && !("kind" in builtin)) {
          // It's a namespace object (like Date, Math, JSON)
          const obj = T.object({});
          (obj as any)._builtinName = node.name;
          return obj;
        }
        // It's a direct value (like parseInt, isNaN)
        return builtin as TypeValue;
      }
      // Constructible built-in classes without static-method coverage (Error,
      // Map, Set, ...) still resolve to a namespace object so `X.prototype`
      // can be typed as an instance.
      if (BUILTIN_PROTOTYPE_CLASSES.has(node.name) && !env.has(node.name)) {
        const obj = T.object({});
        (obj as any)._builtinName = node.name;
        return obj;
      }
      // Check if it looks like a built-in but isn't covered
      if (node.name[0] === node.name[0].toUpperCase() && !env.has(node.name)) {
        if (_onUnknownBuiltin) {
          _onUnknownBuiltin(node.name, node.loc as any);
        }
        recordUnknown({
          kind: "global",
          name: node.name,
          loc: node.loc,
          reason: `unknown global identifier '${node.name}'`,
        });
        // Unresolved builtins propagate unknown (not undefined) so property
        // access on them degrades to unknown instead of a false
        // "property does not exist on undefined" error.
        return T.unknown;
      }
      // Bare `hasOwnProperty(...)`-style references resolve through the
      // global object's prototype chain in real JS — Object.prototype
      // members act as implicit globals (own-guarded against proto leak).
      if (!env.has(node.name) && hasOwnProp(OBJECT_PROTOTYPE_METHODS, node.name)) {
        return OBJECT_PROTOTYPE_METHODS[node.name];
      }
      return env.lookup(node.name);
    }

    case "ThisExpression": {
      // Un-bound `this` (plain function called without a receiver, e.g. a
      // callsite-synthesized case): the receiver is unknowable statically, so
      // degrade to unknown — `this.x` then warns (unknown-recv) instead of
      // erroring with "on type 'undefined'". Explicit bindings (constructors,
      // obj.f() receivers, .call(thisArg)) take precedence unchanged.
      const thisVal = env.lookup("this");
      // T.undefined is `{ kind: "literal", value: undefined }`.
      if (thisVal === undefined || (thisVal.kind === "literal" && thisVal.value === undefined)) {
        return T.unknown;
      }
      return thisVal;
    }

    case "TemplateLiteral": {
      if (node.expressions.length === 0 && node.quasis.length === 1) {
        return T.literal(node.quasis[0].value.cooked ?? node.quasis[0].value.raw);
      }
      const parts: TypeValue[] = [];
      for (let i = 0; i < node.quasis.length; i++) {
        const quasi = node.quasis[i];
        const raw = quasi.value.cooked ?? quasi.value.raw;
        if (raw) parts.push(T.literal(raw));
        if (i < node.expressions.length) {
          const exprVal = evaluate(node.expressions[i], env);
          if (isReturn(exprVal) || isBranch(exprVal) || isThrow(exprVal)) return exprVal;
          parts.push(exprVal);
        }
      }
      const allLiteral = parts.every(
        (p) => p.kind === "literal" && (typeof p.value === "string" || typeof p.value === "number"),
      );
      if (allLiteral) {
        return T.literal(
          parts.map((p) => (p.kind === "literal" ? String(p.value) : "")).join(""),
        );
      }
      return createTemplate(parts);
    }

    case "BinaryExpression": {
      const leftVal = evaluate(node.left, env);
      if (isReturn(leftVal) || isBranch(leftVal) || isThrow(leftVal)) return leftVal;
      const rightVal = evaluate(node.right, env);
      if (isReturn(rightVal) || isBranch(rightVal) || isThrow(rightVal)) return rightVal;

      if (node.operator === "instanceof") {
        return evaluateInstanceof(leftVal, rightVal, node.right, env);
      }
      return distributeBinaryOverUnion(leftVal, rightVal, (l, r) =>
        dispatchBinaryOp(node.operator, l, r),
      );
    }

    case "UnaryExpression": {
      const argVal = evaluate(node.argument, env);
      if (isReturn(argVal) || isBranch(argVal) || isThrow(argVal)) return argVal;
      if (node.operator === "typeof") {
        return distributeOverUnion(argVal, (v) => Ops.typeof_(v));
      }
      if (node.operator === "!") {
        return distributeOverUnion(argVal, (v) => Ops.not(v));
      }
      if (node.operator === "-") {
        return distributeOverUnion(argVal, (v) => Ops.neg(v));
      }
      return T.unknown;
    }

    case "LogicalExpression": {
      const leftVal = evaluate(node.left, env);
      if (isReturn(leftVal) || isBranch(leftVal) || isThrow(leftVal)) return leftVal;

      if (node.operator === "&&") {
        if (leftVal.kind === "literal" && !leftVal.value) return leftVal;
        if (leftVal.kind === "literal" && leftVal.value) {
          const rv = evaluate(node.right, env);
          return isReturn(rv) || isBranch(rv) || isThrow(rv) ? rv : rv;
        }
        const rv = evaluate(node.right, env);
        const rightTV = isReturn(rv) || isBranch(rv) || isThrow(rv) ? T.unknown : rv;
        return simplifyUnion([leftVal, rightTV]);
      }

      if (node.operator === "||") {
        if (leftVal.kind === "literal" && leftVal.value) return leftVal;
        if (leftVal.kind === "literal" && !leftVal.value) {
          const rv = evaluate(node.right, env);
          return isReturn(rv) || isBranch(rv) || isThrow(rv) ? rv : rv;
        }
        const rv = evaluate(node.right, env);
        const rightTV = isReturn(rv) || isBranch(rv) || isThrow(rv) ? T.unknown : rv;
        return simplifyUnion([leftVal, rightTV]);
      }

      if (node.operator === "??") {
        if (leftVal.kind === "literal" && leftVal.value !== null && leftVal.value !== undefined) {
          return leftVal;
        }
        if (leftVal.kind === "literal" && (leftVal.value === null || leftVal.value === undefined)) {
          const rv = evaluate(node.right, env);
          return isReturn(rv) || isBranch(rv) || isThrow(rv) ? rv : rv;
        }
        // For non-literal types, narrow by removing null/undefined from the left side
        const narrowedLeft = subtractType(leftVal, (m) =>
          (m.kind === "literal" && (m.value === null || m.value === undefined))
        );
        if (narrowedLeft.kind !== "never") {
          return narrowedLeft;
        }
        // If all members were null/undefined, use the right side
        const rv = evaluate(node.right, env);
        const rightTV = isReturn(rv) || isBranch(rv) || isThrow(rv) ? T.unknown : rv;
        return rightTV;
      }

      return T.unknown;
    }

    case "ConditionalExpression": {
      const test = node.test;
      const [trueEnv, falseEnv] = narrow(test, env);
      const testVal = evaluate(test, env);
      if (isReturn(testVal) || isBranch(testVal) || isThrow(testVal)) return testVal;

      if (testVal.kind === "literal") {
        return testVal.value
          ? evaluate(node.consequent, trueEnv)
          : evaluate(node.alternate, falseEnv);
      }

      const cResult = evaluate(node.consequent, trueEnv);
      const aResult = evaluate(node.alternate, falseEnv);
      const cVal = isReturn(cResult) ? cResult.value : isBranch(cResult) ? cResult.returnedValue : isThrow(cResult) ? T.never : cResult;
      const aVal = isReturn(aResult) ? aResult.value : isBranch(aResult) ? aResult.returnedValue : isThrow(aResult) ? T.never : aResult;
      return simplifyUnion([cVal, aVal]);
    }

    case "IfStatement": {
      const test = node.test;
      const [trueEnv, falseEnv] = narrow(test, env);
      const testVal = evaluate(test, env);
      if (isReturn(testVal) || isBranch(testVal) || isThrow(testVal)) return testVal;

      if (testVal.kind === "literal") {
        if (testVal.value) {
          if (node.alternate?.loc) {
            _unreachableRanges.push({
              start: { line: node.alternate.loc.start.line, column: node.alternate.loc.start.column },
              end: { line: node.alternate.loc.end.line, column: node.alternate.loc.end.column },
            });
          }
          return evaluate(node.consequent, trueEnv);
        }
        if (node.consequent.loc) {
          _unreachableRanges.push({
            start: { line: node.consequent.loc.start.line, column: node.consequent.loc.start.column },
            end: { line: node.consequent.loc.end.line, column: node.consequent.loc.end.column },
          });
        }
        return node.alternate
          ? evaluate(node.alternate, falseEnv)
          : T.undefined;
      }

      const consequentResult = evaluate(node.consequent, trueEnv);
      const alternateResult = node.alternate
        ? evaluate(node.alternate, falseEnv)
        : null;

      const cReturns = isReturn(consequentResult);
      const cBranches = isBranch(consequentResult);
      const cThrows = isThrow(consequentResult);
      const aReturns = alternateResult !== null && isReturn(alternateResult);
      const aBranches = alternateResult !== null && isBranch(alternateResult);
      const aThrows = alternateResult !== null && isThrow(alternateResult);

      if (cThrows && aThrows) {
        return consequentResult;
      }

      if (cThrows && !node.alternate) {
        return makeBranch(T.never, falseEnv);
      }

      if (cThrows) {
        const aVal = aReturns ? (alternateResult as ReturnSignal).value
          : aBranches ? (alternateResult as BranchSignal).returnedValue
          : alternateResult as TypeValue;
        return makeBranch(aVal, falseEnv);
      }

      if (aThrows) {
        const cVal = cReturns ? consequentResult.value
          : cBranches ? consequentResult.returnedValue
          : consequentResult as TypeValue;
        return makeBranch(cVal, trueEnv);
      }

      const cVal = cReturns ? consequentResult.value
        : cBranches ? consequentResult.returnedValue
        : consequentResult as TypeValue;
      const aVal = aReturns ? (alternateResult as ReturnSignal).value
        : aBranches ? (alternateResult as BranchSignal).returnedValue
        : alternateResult as TypeValue | null;

      if (cReturns && aReturns) {
        return makeReturn(simplifyUnion([cVal, aVal!]));
      }

      if (cReturns && !node.alternate) {
        return makeBranch(cVal, falseEnv);
      }

      if (cReturns && node.alternate) {
        if (aReturns) {
          return makeReturn(simplifyUnion([cVal, aVal!]));
        }
        return makeBranch(cVal, falseEnv);
      }

      if (aReturns) {
        return makeBranch(aVal!, trueEnv);
      }

      const allVals = [cVal];
      if (aVal !== null) allVals.push(aVal);
      else allVals.push(T.undefined);
      return simplifyUnion(allVals);
    }

    case "BlockStatement": {
      const blockEnv = env.fork();
      const result = evaluateStatements(node.body, blockEnv);
      return result;
    }

    case "ReturnStatement": {
      if (_activeAsOverride) return makeReturn(_activeAsOverride);
      const arg = node.argument;
      if (!arg) return makeReturn(T.undefined);
      const val = evaluate(arg, env);
      if (isReturn(val) || isBranch(val) || isThrow(val)) return val;
      return makeReturn(val);
    }

    case "VariableDeclaration": {
      for (const decl of node.declarations) {
        const init = _activeAsOverride ?? (decl.init ? evaluate(decl.init, env) : T.undefined);
        if (isReturn(init) || isBranch(init) || isThrow(init)) return init;
        // Name anonymous function values after their binding so recursion
        // truncation records can cite e.g. `recursion:fn`.
        if (init.kind === "function" && decl.id.type === "Identifier" && !(init as any)._name) {
          (init as any)._name = decl.id.name;
        }
        bindPattern(decl.id, init, env);
        if (decl.id.type === "Identifier") {
          recordNodeType(decl.id, init);
        }
      }
      return T.undefined;
    }

    case "AssignmentExpression": {
      if (node.left.type === "Identifier") {
        const rightVal = evaluate(node.right, env);
        if (isReturn(rightVal) || isBranch(rightVal) || isThrow(rightVal)) return rightVal;

        // Handle compound assignment operators
        let val = rightVal;
        if (node.operator !== "=") {
          const leftVal = env.lookup(node.left.name);
          if (leftVal && leftVal.kind !== "unknown") {
            // Extract the binary operator (e.g., "+=" -> "+")
            const binaryOp = node.operator.slice(0, -1);
            val = dispatchBinaryOp(binaryOp, leftVal, rightVal);
          }
        }

        if (!env.update(node.left.name, val)) {
          env.bind(node.left.name, val);
        }
        if (val.kind === "function" && !(val as any)._name) {
          (val as any)._name = node.left.name;
        }
        return val;
      }
      if (node.left.type === "MemberExpression") {
        const val = evaluate(node.right, env);
        if (isReturn(val) || isBranch(val) || isThrow(val)) return val;
        // `obj.method = function () {...}` — name the function after the
        // assigned property (e.g. `recursion:internals.clone`).
        if (val.kind === "function" && !(val as any)._name) {
          const memberKey = getMemberKey(node.left, env);
          if (memberKey !== null) {
            const objKey = node.left.object.type === "Identifier" ? `${node.left.object.name}.` : "";
            (val as any)._name = `${objKey}${memberKey}`;
          }
        }
        const objVal = evaluate(node.left.object, env);
        if (isReturn(objVal) || isBranch(objVal) || isThrow(objVal)) return val;
        if (objVal.kind === "object") {
          const propName = getMemberKey(node.left, env);
          if (propName !== null) {
            objVal.properties[propName] = val;
          }
        }
        if (objVal.kind === "tuple" || objVal.kind === "array") {
          const propVal = node.left.computed
            ? evaluate(node.left.property, env)
            : null;
          if (
            objVal.kind === "tuple" &&
            propVal &&
            !isReturn(propVal) &&
            !isBranch(propVal) &&
            !isThrow(propVal) &&
            propVal.kind === "literal" &&
            typeof propVal.value === "number"
          ) {
            objVal.elements[propVal.value] = val;
          }
        }
        return val;
      }
      if (
        node.left.type === "ObjectPattern" ||
        node.left.type === "ArrayPattern"
      ) {
        const val = evaluate(node.right, env);
        if (isReturn(val) || isBranch(val) || isThrow(val)) return val;
        bindPattern(node.left, val, env);
        return val;
      }
      return T.unknown;
    }

    case "ForOfStatement": {
      const rightVal = evaluate(node.right, env);
      if (isReturn(rightVal) || isBranch(rightVal) || isThrow(rightVal)) return rightVal;
      return evaluateForOf(node, rightVal, env);
    }

    case "ForInStatement": {
      const rightVal = evaluate(node.right, env);
      if (isReturn(rightVal) || isBranch(rightVal) || isThrow(rightVal)) return rightVal;
      return evaluateForIn(node, rightVal, env);
    }

    case "ForStatement": {
      return evaluateForStatement(node, env);
    }

    case "WhileStatement": {
      return evaluateWhileStatement(node, env);
    }

    case "DoWhileStatement": {
      return evaluateDoWhileStatement(node, env);
    }

    case "FunctionDeclaration": {
      if (!node.id) return T.undefined;
      const paramNames = node.params.map(describeParam);
      const fnType = T.fn(paramNames, node.body, env);
      (fnType as any)._paramPatterns = node.params;
      if (node.id) (fnType as any)._name = node.id.name;
      if (node.async) (fnType as any)._async = true;
      env.bind(node.id.name, fnType);
      return T.undefined;
    }

    case "FunctionExpression":
    case "ArrowFunctionExpression": {
      const paramNames = node.params.map(describeParam);
      const body = node.body;
      const fnType = T.fn(paramNames, body, env);
      (fnType as any)._paramPatterns = node.params;
      if ((node as any).id) (fnType as any)._name = (node as any).id.name;
      if (node.async) (fnType as any)._async = true;
      return fnType;
    }

    case "AwaitExpression": {
      const argVal = evaluate(node.argument, env);
      if (isReturn(argVal) || isBranch(argVal) || isThrow(argVal)) return argVal;
      return distributeOverUnion(argVal, (v) =>
        v.kind === "promise" ? v.value : v,
      );
    }

    case "ClassDeclaration": {
      return evaluateClassDeclaration(node, env);
    }

    case "ImportDeclaration": {
      return evaluateImportDeclaration(node, env);
    }

    case "ExportNamedDeclaration": {
      if (node.declaration) {
        const result = evaluate(node.declaration, env);
        if (isReturn(result) || isBranch(result) || isThrow(result)) return result;
        if (node.declaration.type === "VariableDeclaration") {
          for (const decl of node.declaration.declarations) {
            if (decl.id.type === "Identifier") {
              const val = env.lookup(decl.id.name);
              env.bind(`__export_${decl.id.name}`, val);
            }
          }
        } else if (node.declaration.type === "FunctionDeclaration" && node.declaration.id) {
          const val = env.lookup(node.declaration.id.name);
          env.bind(`__export_${node.declaration.id.name}`, val);
        } else if (node.declaration.type === "ClassDeclaration" && node.declaration.id) {
          const val = env.lookup(node.declaration.id.name);
          env.bind(`__export_${node.declaration.id.name}`, val);
        }
      }
      if (node.specifiers) {
        for (const spec of node.specifiers) {
          if (spec.type === "ExportSpecifier") {
            const localName = spec.local.type === "Identifier" ? spec.local.name : null;
            const exportedName = spec.exported.type === "Identifier" ? spec.exported.name : null;
            if (localName && exportedName) {
              env.bind(`__export_${exportedName}`, env.lookup(localName));
            }
          }
        }
      }
      return T.undefined;
    }

    case "ExportDefaultDeclaration": {
      const decl = node.declaration;
      const result = evaluate(decl, env);
      if (isReturn(result) || isBranch(result) || isThrow(result)) return result;
      if (decl.type === "FunctionDeclaration" && decl.id) {
        env.bind(`__export_default`, env.lookup(decl.id.name));
      } else if (decl.type === "ClassDeclaration" && decl.id) {
        env.bind(`__export_default`, env.lookup(decl.id.name));
      } else {
        env.bind(`__export_default`, result);
      }
      return T.undefined;
    }

    case "CallExpression": {
      const callee = node.callee as Node;

      if (callee.type === "MemberExpression") {
        const methodResult = evaluateMethodCall(callee, node.arguments as Node[], env);
        if (methodResult !== null) return methodResult;
      }

      // CommonJS require(specifier) — resolved through the same module
      // resolver/cache as ESM import. The identity check keeps user-defined
      // `require` bindings on the normal call path.
      if (
        callee.type === "Identifier" &&
        callee.name === "require" &&
        env.lookup("require") === _cjsRequireValue
      ) {
        return evaluateRequireCall(node, env);
      }

      // Handle built-in global functions (only if not overridden in environment, e.g., by mocks)
      if (callee.type === "Identifier" && !env.has(callee.name)) {
        const builtinResult = evaluateBuiltinCall(callee.name, node.arguments as Node[], env);
        if (builtinResult !== null) return builtinResult;
      }

      const calleeVal = evaluate(callee, env);
      if (isReturn(calleeVal) || isBranch(calleeVal) || isThrow(calleeVal)) return calleeVal;

      const argVals = evaluateArgs(node.arguments as Node[], env);
      if (isReturn(argVals) || isBranch(argVals) || isThrow(argVals)) return argVals;

      const thisVal = (callee.type === "MemberExpression" || callee.type === "OptionalMemberExpression")
        ? ((callee as any)._receiverVal as TypeValue | undefined)
        : undefined;
      if (calleeVal.kind === "function") {
        const full = callFunctionFull(calleeVal, argVals as TypeValue[], thisVal);
        if (_callCollector && callee.type === "Identifier") {
          recordCall(callee.name, argVals as TypeValue[], full, node.loc, calleeVal);
        } else if (_callCollector && (callee.type === "MemberExpression" || callee.type === "OptionalMemberExpression") && callee.property.type === "Identifier") {
          // 成员调用（ns.fn()/obj.fn()）：跨文件调用点发现的来源——
          // 配合 _exportTags 还原 (module, export) 归属
          recordCall(callee.property.name, argVals as TypeValue[], full, node.loc, calleeVal);
        }
        if (full.value.kind === "never" && full.throws.kind !== "never") {
          const callLoc = node.loc ? {
            start: { line: node.loc.start.line, column: node.loc.start.column },
            end: { line: node.loc.end.line, column: node.loc.end.column },
          } : full.throwLoc;
          return makeThrow(full.throws, callLoc);
        }
        return full.value;
      }

      return distributeOverUnion(calleeVal, (fn) => {
        if (fn.kind !== "function") return T.unknown;
        return callFunction(fn, argVals as TypeValue[], thisVal);
      });
    }

    case "OptionalCallExpression": {
      const callee = node.callee as Node;

      if (callee.type === "OptionalMemberExpression" || callee.type === "MemberExpression") {
        const objVal = evaluate(callee.object, env);
        if (isReturn(objVal) || isBranch(objVal) || isThrow(objVal)) return objVal;
        if (objVal.kind === "literal" && (objVal.value === null || objVal.value === undefined)) {
          return T.undefined;
        }
        const methodResult = evaluateMethodCall(callee as Node & { type: "MemberExpression" }, node.arguments as Node[], env);
        if (methodResult !== null) return methodResult;
      }

      const calleeVal = evaluate(callee, env);
      if (isReturn(calleeVal) || isBranch(calleeVal) || isThrow(calleeVal)) return calleeVal;

      if (calleeVal.kind === "literal" && (calleeVal.value === null || calleeVal.value === undefined)) {
        return T.undefined;
      }

      const argVals = evaluateArgs(node.arguments as Node[], env);
      if (isReturn(argVals) || isBranch(argVals) || isThrow(argVals)) return argVals;

      const thisVal = (callee.type === "MemberExpression" || callee.type === "OptionalMemberExpression")
        ? ((callee as any)._receiverVal as TypeValue | undefined)
        : undefined;
      if (calleeVal.kind === "function") {
        const full = callFunctionFull(calleeVal, argVals as TypeValue[], thisVal);
        if (_callCollector && callee.type === "Identifier") {
          recordCall(callee.name, argVals as TypeValue[], full, node.loc, calleeVal);
        } else if (_callCollector && (callee.type === "MemberExpression" || callee.type === "OptionalMemberExpression") && callee.property.type === "Identifier") {
          // 成员调用（ns.fn()/obj.fn()）：跨文件调用点发现的来源——
          // 配合 _exportTags 还原 (module, export) 归属
          recordCall(callee.property.name, argVals as TypeValue[], full, node.loc, calleeVal);
        }
        if (full.value.kind === "never" && full.throws.kind !== "never") {
          const callLoc = node.loc ? {
            start: { line: node.loc.start.line, column: node.loc.start.column },
            end: { line: node.loc.end.line, column: node.loc.end.column },
          } : full.throwLoc;
          return makeThrow(full.throws, callLoc);
        }
        return full.value;
      }

      return distributeOverUnion(calleeVal, (fn) => {
        if (fn.kind !== "function") return T.unknown;
        return callFunction(fn, argVals as TypeValue[], thisVal);
      });
    }

    case "MemberExpression": {
      const objVal = evaluate(node.object, env);
      if (isReturn(objVal) || isBranch(objVal) || isThrow(objVal)) return objVal;
      // Stash the receiver so an enclosing CallExpression (`obj.f()`) can
      // bind it as the callee's `this` without re-evaluating the object.
      (node as any)._receiverVal = objVal;

      if (node.computed) {
        const propVal = evaluate(node.property, env);
        if (isReturn(propVal) || isBranch(propVal) || isThrow(propVal)) return propVal;
        let propMissed = false;
        const result = distributeOverUnion(objVal, (obj) => {
          if (obj.kind === "object" && propVal.kind === "literal" && typeof propVal.value === "string") {
            return (hasOwnProp(obj.properties, propVal.value) ? obj.properties[propVal.value] : undefined) ?? T.undefined;
          }
          if ((obj.kind === "array" || obj.kind === "tuple") && propVal.kind === "literal" && typeof propVal.value === "number") {
            if (obj.kind === "tuple") return obj.elements[propVal.value] ?? T.undefined;
            return obj.element;
          }
          if (propVal.kind === "literal" && typeof propVal.value === "string") {
            propMissed = true;
          }
          return T.unknown;
        });
        if (propMissed && propVal.kind === "literal" && typeof propVal.value === "string") {
          recordUnknown({
            kind: "property",
            name: propVal.value,
            receiverType: objVal,
            loc: node.loc,
            reason: `no property '${propVal.value}' on ${objVal.kind}`,
          });
        }
        return result;
      }

      if (node.property.type === "Identifier") {
        const propName = node.property.name;
        let propMissed = false;
        const result = distributeOverUnion(objVal, (obj) => {
          // Check for built-in static methods (e.g., Date.now, Math.floor)
          const builtinName = (obj as any)._builtinName as string | undefined;
          if (builtinName && hasOwnProp(BUILTIN_STATIC_METHODS, builtinName)) {
            const builtin = BUILTIN_STATIC_METHODS[builtinName];
            // hasOwnProp guard: `in` would leak native Object.prototype
            // members (e.g. `JSON.toString` → the real JS function).
            if (typeof builtin === "object" && hasOwnProp(builtin, propName)) {
              return (builtin as Record<string, TypeValue>)[propName];
            }
          }
          // `X.prototype` on a constructible built-in resolves to instances of X
          if (propName === "prototype" && builtinName && BUILTIN_PROTOTYPE_CLASSES.has(builtinName)) {
            return T.instanceOf(builtinName);
          }
          // Check for Map.size property
          if (obj.kind === "instance" && obj.className === "Map" && propName === "size") {
            return T.number;
          }
          // Check for Set.size property
          if (obj.kind === "instance" && obj.className === "Set" && propName === "size") {
            return T.number;
          }
          if (obj.kind === "object") {
            const ownVal = hasOwnProp(obj.properties, propName) ? obj.properties[propName] : undefined;
            if (ownVal) return ownVal;
            // Every object inherits Object.prototype members (see table note).
            const protoFn = hasOwnProp(OBJECT_PROTOTYPE_METHODS, propName)
              ? OBJECT_PROTOTYPE_METHODS[propName]
              : undefined;
            if (protoFn) return protoFn;
            return T.undefined;
          }
          if (obj.kind === "instance") {
            // Own-property lookup only: a plain `{}` properties record would
            // otherwise leak native Object.prototype members (e.g. the real
            // JS `toString` function) into the type system.
            const own = hasOwnProp(obj.properties, propName) ? obj.properties[propName] : undefined;
            if (own) return own;
            // Instances inherit Object.prototype members too: keeps
            // `Object.prototype.hasOwnProperty` (and the toString brand-check
            // idiom) typeable instead of degrading to undefined.
            const protoFn = hasOwnProp(OBJECT_PROTOTYPE_METHODS, propName)
              ? OBJECT_PROTOTYPE_METHODS[propName]
              : undefined;
            if (protoFn) return protoFn;
            // instance 的方法集是声明的近似：未列出的方法返回 unknown-result
            // 函数值，让 `X.prototype.m.call(...)` 反射惯用法继续求值。
            const knownInstanceMethods: Record<string, TypeValue> = {
              values: T.fnSig([], T.array(T.unknown)),
              keys: T.fnSig([], T.array(T.unknown)),
              entries: T.fnSig([], T.array(T.tuple([T.unknown, T.unknown]))),
              get: T.fnSig([T.unknown], T.unknown),
              has: T.fnSig([T.unknown], T.boolean),
              add: T.fnSig([T.unknown], T.unknown),
              set: T.fnSig([T.unknown, T.unknown], T.unknown),
              delete: T.fnSig([T.unknown], T.boolean),
              forEach: T.fnSig([T.unknown], T.undefined),
              call: T.fnSig([T.unknown], T.unknown),
              apply: T.fnSig([T.unknown], T.unknown),
              bind: T.fnSig([T.unknown], T.unknown),
            };
            // hasOwnProp：普通 [] 访问会命中 JS 原型链（valueOf/hasOwnProperty
            // 等），把原生函数当 TypeValue 泄漏进类型系统
            const knownFn = hasOwnProp(knownInstanceMethods, propName)
              ? knownInstanceMethods[propName]
              : undefined;
            if (knownFn) return knownFn;
            return T.fnSig([T.unknown], T.unknown);
          }
          if (propName === "length" && (obj.kind === "array" || obj.kind === "tuple")) {
            return obj.kind === "tuple" ? T.literal(obj.elements.length) : T.number;
          }
          if (propName === "length" && obj.kind === "literal" && typeof obj.value === "string") {
            return T.literal(obj.value.length);
          }
          if (propName === "length" && obj.kind === "primitive" && obj.type === "string") {
            return T.number;
          }
          if (obj.kind === "refined") {
            const result = dispatchProperty(obj, propName);
            if (result !== undefined) return result;
          }
          propMissed = true;
          return T.unknown;
        });
        if (propMissed) {
          recordUnknown({
            kind: "property",
            name: propName,
            receiverType: objVal,
            loc: node.loc,
            reason: `no property '${propName}' on ${objVal.kind}`,
          });
        }
        return result;
      }

      return T.unknown;
    }

    case "OptionalMemberExpression": {
      const objVal = evaluate(node.object, env);
      if (isReturn(objVal) || isBranch(objVal) || isThrow(objVal)) return objVal;

      // If object is null or undefined, short-circuit to undefined
      if (objVal.kind === "literal" && (objVal.value === null || objVal.value === undefined)) {
        return T.undefined;
      }
      (node as any)._receiverVal = objVal;

      // Otherwise, evaluate like a normal member expression
      if (node.computed) {
        const propVal = evaluate(node.property, env);
        if (isReturn(propVal) || isBranch(propVal) || isThrow(propVal)) return propVal;
        let propMissed = false;
        const result = distributeOverUnion(objVal, (obj) => {
          if (obj.kind === "object" && propVal.kind === "literal" && typeof propVal.value === "string") {
            return (hasOwnProp(obj.properties, propVal.value) ? obj.properties[propVal.value] : undefined) ?? T.undefined;
          }
          if ((obj.kind === "array" || obj.kind === "tuple") && propVal.kind === "literal" && typeof propVal.value === "number") {
            if (obj.kind === "tuple") return obj.elements[propVal.value] ?? T.undefined;
            return obj.element;
          }
          if (propVal.kind === "literal" && typeof propVal.value === "string") {
            propMissed = true;
          }
          return T.unknown;
        });
        if (propMissed && propVal.kind === "literal" && typeof propVal.value === "string") {
          recordUnknown({
            kind: "property",
            name: propVal.value,
            receiverType: objVal,
            loc: node.loc,
            reason: `no property '${propVal.value}' on ${objVal.kind}`,
          });
        }
        return result;
      }

      if (node.property.type === "Identifier") {
        const propName = node.property.name;
        let propMissed = false;
        const result = distributeOverUnion(objVal, (obj) => {
          // `X.prototype` on a constructible built-in resolves to instances of X
          const optBuiltinName = (obj as any)._builtinName as string | undefined;
          if (propName === "prototype" && optBuiltinName && BUILTIN_PROTOTYPE_CLASSES.has(optBuiltinName)) {
            return T.instanceOf(optBuiltinName);
          }
          if (obj.kind === "object") {
            const ownVal = hasOwnProp(obj.properties, propName) ? obj.properties[propName] : undefined;
            if (ownVal) return ownVal;
            // Every object inherits Object.prototype members (see table note).
            const protoFn = hasOwnProp(OBJECT_PROTOTYPE_METHODS, propName)
              ? OBJECT_PROTOTYPE_METHODS[propName]
              : undefined;
            if (protoFn) return protoFn;
            return T.undefined;
          }
          if (obj.kind === "instance") {
            // Own-property lookup only (see MemberExpression note): a plain
            // `{}` properties record would otherwise leak native
            // Object.prototype members into the type system.
            const own = hasOwnProp(obj.properties, propName) ? obj.properties[propName] : undefined;
            if (own) return own;
            // Instances inherit Object.prototype members too: keeps
            // `Object.prototype.hasOwnProperty` (and the toString brand-check
            // idiom) typeable instead of degrading to undefined.
            const protoFn = hasOwnProp(OBJECT_PROTOTYPE_METHODS, propName)
              ? OBJECT_PROTOTYPE_METHODS[propName]
              : undefined;
            if (protoFn) return protoFn;
            // instance 的方法集是声明的近似：未列出的方法返回 unknown-result
            // 函数值，让 `X.prototype.m.call(...)` 反射惯用法继续求值。
            const knownInstanceMethods: Record<string, TypeValue> = {
              values: T.fnSig([], T.array(T.unknown)),
              keys: T.fnSig([], T.array(T.unknown)),
              entries: T.fnSig([], T.array(T.tuple([T.unknown, T.unknown]))),
              get: T.fnSig([T.unknown], T.unknown),
              has: T.fnSig([T.unknown], T.boolean),
              add: T.fnSig([T.unknown], T.unknown),
              set: T.fnSig([T.unknown, T.unknown], T.unknown),
              delete: T.fnSig([T.unknown], T.boolean),
              forEach: T.fnSig([T.unknown], T.undefined),
              call: T.fnSig([T.unknown], T.unknown),
              apply: T.fnSig([T.unknown], T.unknown),
              bind: T.fnSig([T.unknown], T.unknown),
            };
            // hasOwnProp：普通 [] 访问会命中 JS 原型链（valueOf/hasOwnProperty
            // 等），把原生函数当 TypeValue 泄漏进类型系统
            const knownFn = hasOwnProp(knownInstanceMethods, propName)
              ? knownInstanceMethods[propName]
              : undefined;
            if (knownFn) return knownFn;
            return T.fnSig([T.unknown], T.unknown);
          }
          if (propName === "length" && (obj.kind === "array" || obj.kind === "tuple")) {
            return obj.kind === "tuple" ? T.literal(obj.elements.length) : T.number;
          }
          if (propName === "length" && obj.kind === "literal" && typeof obj.value === "string") {
            return T.literal(obj.value.length);
          }
          if (propName === "length" && obj.kind === "primitive" && obj.type === "string") {
            return T.number;
          }
          if (obj.kind === "refined") {
            const result = dispatchProperty(obj, propName);
            if (result !== undefined) return result;
          }
          propMissed = true;
          return T.unknown;
        });
        if (propMissed) {
          recordUnknown({
            kind: "property",
            name: propName,
            receiverType: objVal,
            loc: node.loc,
            reason: `no property '${propName}' on ${objVal.kind}`,
          });
        }
        return result;
      }

      return T.unknown;
    }

    case "ObjectExpression": {
      const props: Record<string, TypeValue> = {};
      for (const prop of node.properties) {
        if (prop.type === "ObjectProperty") {
          const key = prop.computed
            ? (() => {
                const kv = evaluate(prop.key, env);
                return !isReturn(kv) && !isBranch(kv) && !isThrow(kv) && kv.kind === "literal" && typeof kv.value === "string"
                  ? kv.value
                  : null;
              })()
            : prop.key.type === "Identifier"
              ? prop.key.name
              : prop.key.type === "StringLiteral"
                ? prop.key.value
                : null;
          if (key) {
            const val = evaluate(prop.value as Node, env);
            if (isReturn(val) || isBranch(val) || isThrow(val)) return val;
            props[key] = val;
          }
        } else if (prop.type === "ObjectMethod") {
          // Handle shorthand method syntax: { method() { ... } }
          const key = prop.key.type === "Identifier"
            ? prop.key.name
            : prop.key.type === "StringLiteral"
              ? prop.key.value
              : null;
          if (key) {
            const params = prop.params.map((p: Node) => {
              if (p.type === "Identifier") return p.name;
              if (p.type === "RestElement" && p.argument.type === "Identifier") return `...${p.argument.name}`;
              return `__param`;
            });
            props[key] = T.fn(params, prop.body, env);
          }
        } else if (prop.type === "SpreadElement") {
          const spreadVal = evaluate(prop.argument, env);
          if (isReturn(spreadVal) || isBranch(spreadVal) || isThrow(spreadVal)) return spreadVal;
          if (spreadVal.kind === "object") {
            Object.assign(props, spreadVal.properties);
          } else if (spreadVal.kind === "union") {
            const objectMembers = spreadVal.members.filter((m: TypeValue) => m.kind === "object");
            if (objectMembers.length > 0) {
              const allKeys = new Set<string>();
              for (const m of objectMembers) {
                if (m.kind === "object") {
                  for (const k of Object.keys(m.properties)) allKeys.add(k);
                }
              }
              for (const key of allKeys) {
                const values = objectMembers
                  .filter((m: TypeValue) => m.kind === "object" && key in (m as any).properties)
                  .map((m: TypeValue) => (m as any).properties[key]);
                if (values.length > 0) {
                  props[key] = simplifyUnion(values);
                }
              }
            }
          }
        }
      }
      return T.object(props);
    }

    case "ArrayExpression": {
      const elements: TypeValue[] = [];
      for (const elem of node.elements) {
        if (!elem) {
          elements.push(T.undefined);
          continue;
        }
        if (elem.type === "SpreadElement") {
          const spreadVal = evaluate(elem.argument, env);
          if (isReturn(spreadVal) || isBranch(spreadVal) || isThrow(spreadVal)) return spreadVal;
          if (spreadVal.kind === "tuple") {
            elements.push(...spreadVal.elements);
          } else if (spreadVal.kind === "array") {
            return T.array(simplifyUnion([...elements, spreadVal.element]));
          } else {
            elements.push(T.unknown);
          }
          continue;
        }
        const val = evaluate(elem as Node, env);
        if (isReturn(val) || isBranch(val) || isThrow(val)) return val;
        elements.push(val);
      }
      return T.tuple(elements);
    }

    case "ThrowStatement": {
      const argVal = node.argument ? evaluate(node.argument, env) : T.undefined;
      if (isReturn(argVal) || isBranch(argVal) || isThrow(argVal)) return argVal;
      const throwLoc = node.loc ? {
        start: { line: node.loc.start.line, column: node.loc.start.column },
        end: { line: node.loc.end.line, column: node.loc.end.column },
      } : undefined;
      return makeThrow(argVal, throwLoc);
    }

    case "TryStatement": {
      return evaluateTryStatement(node, env);
    }

    case "NewExpression": {
      return evaluateNewExpression(node, env);
    }

    case "SwitchStatement": {
      return evaluateSwitchStatement(node, env);
    }

    case "UpdateExpression": {
      if (node.argument.type === "Identifier") {
        const current = env.lookup(node.argument.name);
        if (current.kind === "literal" && typeof current.value === "number") {
          const newVal = node.operator === "++"
            ? T.literal(current.value + 1)
            : T.literal(current.value - 1);
          if (!env.update(node.argument.name, newVal)) {
            env.bind(node.argument.name, newVal);
          }
          return node.prefix ? newVal : current;
        }
        if (!env.update(node.argument.name, T.number)) {
          env.bind(node.argument.name, T.number);
        }
        return T.number;
      }
      return T.number;
    }

    default:
      return T.unknown;
  }
}

function getMemberKey(node: Node & { type: "MemberExpression" }, env: Environment): string | null {
  if (!node.computed && node.property.type === "Identifier") {
    return node.property.name;
  }
  if (node.computed) {
    const propVal = evaluate(node.property, env);
    if (!isReturn(propVal) && !isBranch(propVal) && !isThrow(propVal) && propVal.kind === "literal") {
      return String(propVal.value);
    }
  }
  return null;
}

function bindPattern(pattern: Node, value: TypeValue, env: Environment): void {
  if (pattern.type === "Identifier") {
    env.bind(pattern.name, value);
    return;
  }

  if (pattern.type === "RestElement") {
    // Handle rest parameters: (...args) => ...
    // The value should be a tuple of all remaining arguments
    if (pattern.argument.type === "Identifier") {
      env.bind(pattern.argument.name, value);
    }
    return;
  }

  if (pattern.type === "AssignmentPattern") {
    const defaultVal = evaluate(pattern.right, env);
    const resolved = (value.kind === "literal" && value.value === undefined)
      ? (!isReturn(defaultVal) && !isBranch(defaultVal) && !isThrow(defaultVal) ? defaultVal : T.unknown)
      : value;
    bindPattern(pattern.left, resolved, env);
    return;
  }

  if (pattern.type === "ObjectPattern") {
    const restKeys: string[] = [];
    for (const prop of pattern.properties) {
      if (prop.type === "RestElement") {
        if (value.kind === "object") {
          const remaining: Record<string, TypeValue> = {};
          for (const [k, v] of Object.entries(value.properties)) {
            if (!restKeys.includes(k)) remaining[k] = v;
          }
          bindPattern(prop.argument, T.object(remaining), env);
        } else {
          bindPattern(prop.argument, T.object({}), env);
        }
        continue;
      }
      if (prop.type !== "ObjectProperty") continue;
      const key = prop.key.type === "Identifier"
        ? prop.key.name
        : prop.key.type === "StringLiteral"
          ? prop.key.value
          : null;
      if (!key) continue;
      restKeys.push(key);
      // Own-property guard first (a plain record would leak native JS
      // functions for names like "hasOwnProperty"), then Object.prototype
      // fallback — real destructuring reads through the prototype chain.
      const propVal = value.kind === "object"
        ? (hasOwnProp(value.properties, key)
          ? value.properties[key]
          : (hasOwnProp(OBJECT_PROTOTYPE_METHODS, key) ? OBJECT_PROTOTYPE_METHODS[key] : T.undefined))
        : T.unknown;
      bindPattern(prop.value as Node, propVal, env);
    }
    return;
  }

  if (pattern.type === "ArrayPattern") {
    for (let i = 0; i < pattern.elements.length; i++) {
      const elem = pattern.elements[i];
      if (!elem) continue;
      if (elem.type === "RestElement") {
        if (value.kind === "tuple") {
          bindPattern(elem.argument, T.tuple(value.elements.slice(i)), env);
        } else if (value.kind === "array") {
          bindPattern(elem.argument, value, env);
        } else {
          bindPattern(elem.argument, T.tuple([]), env);
        }
        continue;
      }
      const elemVal = value.kind === "tuple"
        ? (value.elements[i] ?? T.undefined)
        : value.kind === "array"
          ? value.element
          : T.unknown;
      bindPattern(elem, elemVal, env);
    }
    return;
  }
}

function evaluateArgs(args: Node[], env: Environment): TypeValue[] | ReturnSignal | BranchSignal | ThrowSignal {
  const result: TypeValue[] = [];
  for (const arg of args) {
    if (arg.type === "SpreadElement") {
      const spreadVal = evaluate(arg.argument, env);
      if (isReturn(spreadVal) || isBranch(spreadVal) || isThrow(spreadVal)) return spreadVal;
      if (spreadVal.kind === "tuple") {
        result.push(...spreadVal.elements);
      } else if (spreadVal.kind === "array") {
        result.push(spreadVal.element);
      } else {
        result.push(T.unknown);
      }
      continue;
    }
    const v = evaluate(arg, env);
    if (isReturn(v) || isBranch(v) || isThrow(v)) return v;
    if (_provenanceEnabled && arg.loc) {
      _originMap.set(v, { line: arg.loc.start.line, column: arg.loc.start.column });
    }
    result.push(v);
  }
  return result;
}

function evaluateBuiltinCall(
  name: string,
  args: Node[],
  env: Environment,
): EvalResult | null {
  // Type conversion functions
  if (name === "String" || name === "Number" || name === "Boolean") {
    const argVals = evaluateArgs(args, env);
    if (isReturn(argVals) || isBranch(argVals) || isThrow(argVals)) return argVals;
    if (argVals.length === 0) {
      if (name === "String") return T.literal("");
      if (name === "Number") return T.literal(0);
      if (name === "Boolean") return T.literal(false);
    }
    // For literals, try to convert
    if (argVals.length === 1) {
      const arg = argVals[0];
      if (name === "String") {
        if (arg.kind === "literal") return T.literal(String(arg.value));
        return T.string;
      }
      if (name === "Number") {
        if (arg.kind === "literal") {
          // Number() converts literals to their numeric value
          if (arg.value === null) return T.literal(0);
          if (arg.value === undefined) return T.literal(NaN);
          if (typeof arg.value === "boolean") return T.literal(arg.value ? 1 : 0);
          if (typeof arg.value === "number") return arg;
          if (typeof arg.value === "string") {
            const num = Number(arg.value);
            if (!isNaN(num)) return T.literal(num);
            return T.literal(NaN);
          }
        }
        return T.number;
      }
      if (name === "Boolean") {
        if (arg.kind === "literal") return T.literal(Boolean(arg.value));
        return T.boolean;
      }
    }
    if (name === "String") return T.string;
    if (name === "Number") return T.number;
    if (name === "Boolean") return T.boolean;
  }

  // parseInt and parseFloat
  if (name === "parseInt" || name === "parseFloat") {
    const argVals = evaluateArgs(args, env);
    if (isReturn(argVals) || isBranch(argVals) || isThrow(argVals)) return argVals;
    return T.number;
  }

  // isNaN and isFinite
  if (name === "isNaN" || name === "isFinite") {
    const argVals = evaluateArgs(args, env);
    if (isReturn(argVals) || isBranch(argVals) || isThrow(argVals)) return argVals;
    return T.boolean;
  }

  // encodeURIComponent, decodeURIComponent, encodeURI, decodeURI
  if (name === "encodeURIComponent" || name === "decodeURIComponent" ||
      name === "encodeURI" || name === "decodeURI") {
    const argVals = evaluateArgs(args, env);
    if (isReturn(argVals) || isBranch(argVals) || isThrow(argVals)) return argVals;
    return T.string;
  }

  // Math functions (accessed via member expression, not here)
  if (name === "Math") {
    return null;
  }

  // console functions (accessed via member expression, not here)
  if (name === "console") {
    return null;
  }

  // fetch global function
  if (name === "fetch") {
    return T.promise(createResponseType());
  }

  return null;
}

// --- Function.prototype.call / apply / bind ---
// When the receiver of a method call is itself a function value,
// `f.call(thisArg, ...args)` / `f.apply(thisArg, argsArray)` re-invoke that
// function with the args following the leading thisArg; `f.bind(...)`
// approximates to the original function value. Non-function receivers keep
// the existing fallback.
function evaluateFunctionPrototypeMethod(
  fnVal: TypeValue & { kind: "function" },
  methodName: string,
  argVals: TypeValue[],
): TypeValue | null {
  if (methodName === "bind") return fnVal;
  if (methodName === "call") {
    return callFunctionFull(fnVal, argVals.slice(1), argVals[0]).value;
  }
  if (methodName === "apply") {
    const listArg = argVals[1];
    let spreadArgs: TypeValue[];
    if (listArg?.kind === "tuple") {
      spreadArgs = listArg.elements;
    } else {
      // Unknown-length array (or non-array): approximate with the element
      // type (or unknown) repeated to the callee's arity.
      const el = listArg?.kind === "array" ? listArg.element : T.unknown;
      spreadArgs = fnVal.params.map(() => el);
    }
    return callFunctionFull(fnVal, spreadArgs, argVals[0]).value;
  }
  return null;
}

function evaluateMethodForMember(
  objVal: TypeValue,
  methodName: string,
  argVals: TypeValue[],
  callee: Node & { type: "MemberExpression" },
  env: Environment,
): TypeValue | null {
  // Function.prototype.call/apply/bind on function-valued union members
  if (objVal.kind === "function") {
    const fnProto = evaluateFunctionPrototypeMethod(objVal, methodName, argVals);
    if (fnProto !== null) return fnProto;
  }

  // Promise instance methods
  if (objVal.kind === "promise") {
    const result = evaluatePromiseInstanceMethod(objVal, methodName, argVals);
    if (result !== null) return result;
  }

  // Instance methods (Map, Set, RegExp, etc.)
  if (objVal.kind === "instance") {
    const classMethods: Record<string, Record<string, (...args: TypeValue[]) => TypeValue>> = {
      Map: MAP_INSTANCE_METHODS,
      Set: SET_INSTANCE_METHODS,
      RegExp: REGEXP_INSTANCE_METHODS,
    };
    const methods = classMethods[objVal.className];
    if (methods) {
      const method = methods[methodName];
      if (method) return method(...argVals, objVal);
    }
  }

  // Array/tuple methods（union 分布路径——主路径 evaluateArrayMethod 需要
  // AST 节点，这里只补不需要回调 AST 的顺序方法；回调类 map/filter 等
  // 返回 unknown 以示保守）
  if (objVal.kind === "array" || objVal.kind === "tuple") {
    if (methodName === "push") {
      if (objVal.kind === "tuple") {
        objVal.elements.push(...argVals);
        return T.literal(objVal.elements.length);
      }
      return T.number;
    }
    if (methodName === "pop" || methodName === "shift") {
      if (objVal.kind === "tuple") {
        if (objVal.elements.length === 0) return T.undefined;
        return T.union(...objVal.elements);
      }
      return T.unknown;
    }
    if (methodName === "unshift") {
      if (objVal.kind === "tuple") return T.literal(objVal.elements.length + argVals.length);
      return T.number;
    }
    if (methodName === "length") {
      return objVal.kind === "tuple" ? T.literal(objVal.elements.length) : T.number;
    }
    if (methodName === "indexOf" || methodName === "lastIndexOf") return T.number;
    if (methodName === "includes") return T.boolean;
    // join/concat/slice/map/filter 等返回 unknown（回调形态在主路径处理）
    return T.unknown;
  }

  // String methods
  if (isStringLike(objVal)) {
    return evaluateStringMethod(objVal, methodName, argVals);
  }

  return null;
}

function evaluateMethodCall(
  callee: Node & { type: "MemberExpression" },
  args: Node[],
  env: Environment,
): EvalResult | null {
  const objVal = evaluate(callee.object, env);
  if (isReturn(objVal) || isBranch(objVal) || isThrow(objVal)) return objVal;
  const methodName = !callee.computed && callee.property.type === "Identifier"
    ? callee.property.name
    : null;
  if (!methodName) return null;

  // Distribute method calls over union types
  if (objVal.kind === "union") {
    const argVals = evaluateArgs(args, env);
    if (isReturn(argVals) || isBranch(argVals) || isThrow(argVals)) return argVals;
    let methodMissed = false;
    const result = distributeOverUnion(objVal, (member) => {
      // Create a temporary env with the member bound, then re-evaluate the method call
      const memberResult = evaluateMethodForMember(member, methodName, argVals as TypeValue[], callee, env);
      if (
        memberResult === null &&
        member.kind !== "object" && member.kind !== "instance" &&
        member.kind !== "refined" && member.kind !== "promise"
      ) {
        methodMissed = true;
      }
      return memberResult ?? T.unknown;
    });
    if (methodMissed) {
      recordUnknown({
        kind: "method",
        name: methodName,
        receiverType: objVal,
        loc: callee.loc,
        reason: `no method '${methodName}' on ${objVal.kind}`,
      });
    }
    return result;
  }

  // Function.prototype.call/apply/bind re-invoking a function value
  if (objVal.kind === "function") {
    const argVals = evaluateArgs(args, env);
    if (isReturn(argVals) || isBranch(argVals) || isThrow(argVals)) return argVals;
    const fnProto = evaluateFunctionPrototypeMethod(objVal, methodName, argVals as TypeValue[]);
    if (fnProto !== null) return fnProto;
  }

  // Handle console methods (no return value)
  if (callee.object.type === "Identifier" && callee.object.name === "console" && !env.has("console")) {
    const argVals = evaluateArgs(args, env);
    if (isReturn(argVals) || isBranch(argVals) || isThrow(argVals)) return argVals;
    return T.undefined;
  }

  // Handle Math methods
  if (callee.object.type === "Identifier" && callee.object.name === "Math" && !env.has("Math")) {
    const argVals = evaluateArgs(args, env);
    if (isReturn(argVals) || isBranch(argVals) || isThrow(argVals)) return argVals;
    // Math methods return numbers
    if (["abs", "ceil", "floor", "round", "sqrt", "pow", "min", "max",
         "random", "log", "log2", "log10", "exp", "sin", "cos", "tan",
         "asin", "acos", "atan", "atan2"].includes(methodName)) {
      return T.number;
    }
    // Math constants
    if (["PI", "E", "LN2", "LN10", "LOG2E", "LOG10E", "SQRT1_2", "SQRT2"].includes(methodName)) {
      return T.number;
    }
    return T.number;
  }

  // Handle Date methods
  if (callee.object.type === "Identifier" && callee.object.name === "Date" && !env.has("Date")) {
    const argVals = evaluateArgs(args, env);
    if (isReturn(argVals) || isBranch(argVals) || isThrow(argVals)) return argVals;
    // Date static methods
    if (["now", "parse", "UTC"].includes(methodName)) {
      return T.number;
    }
    // Date constructor
    if (methodName === "constructor") {
      return T.instanceOf("Date", {
        getTime: T.fn(["...args"], { type: "BlockStatement", body: [] } as any, undefined as any),
        getFullYear: T.fn(["...args"], { type: "BlockStatement", body: [] } as any, undefined as any),
        toISOString: T.fn(["...args"], { type: "BlockStatement", body: [] } as any, undefined as any),
      });
    }
    return T.unknown;
  }

  // Handle JSON methods
  if (callee.object.type === "Identifier" && callee.object.name === "JSON" && !env.has("JSON")) {
    const argVals = evaluateArgs(args, env);
    if (isReturn(argVals) || isBranch(argVals) || isThrow(argVals)) return argVals;
    // JSON.parse returns any
    if (methodName === "parse") {
      return T.unknown;
    }
    // JSON.stringify returns string
    if (methodName === "stringify") {
      return T.string;
    }
    return T.unknown;
  }

  // Handle Array methods (Array.from, Array.isArray, etc.)
  if (callee.object.type === "Identifier" && callee.object.name === "Array" && !env.has("Array")) {
    const argVals = evaluateArgs(args, env);
    if (isReturn(argVals) || isBranch(argVals) || isThrow(argVals)) return argVals;
    if (methodName === "from") {
      if (argVals.length > 0) {
        const iterable = argVals[0];
        // Array.from(Set) -> array of Set's element type
        if (iterable.kind === "instance" && iterable.className === "Set") {
          const typeArgs = (iterable as any)._typeArgs;
          if (typeArgs?.T) return T.array(typeArgs.T);
        }
        // Array.from(tuple) -> tuple (preserve types)
        if (iterable.kind === "tuple") {
          return iterable;
        }
        // Array.from(array) -> array
        if (iterable.kind === "array") {
          return iterable;
        }
      }
      return T.array(T.unknown);
    }
    if (methodName === "isArray") {
      return T.boolean;
    }
    return T.unknown;
  }

  // Handle Promise methods
  if (callee.object.type === "Identifier" && callee.object.name === "Promise" && !env.has("Promise")) {
    const argVals = evaluateArgs(args, env);
    if (isReturn(argVals) || isBranch(argVals) || isThrow(argVals)) return argVals;
    const result = evaluatePromiseStaticMethod(methodName, argVals as TypeValue[]);
    if (result !== null) return result;
    return T.unknown;
  }

  // Handle Symbol methods
  if (callee.object.type === "Identifier" && callee.object.name === "Symbol" && !env.has("Symbol")) {
    const argVals = evaluateArgs(args, env);
    if (isReturn(argVals) || isBranch(argVals) || isThrow(argVals)) return argVals;
    if (methodName === "for") return T.symbol;
    if (methodName === "keyFor") return T.union(T.string, T.undefined);
    return T.unknown;
  }

  // Handle Reflect methods
  if (callee.object.type === "Identifier" && callee.object.name === "Reflect" && !env.has("Reflect")) {
    const argVals = evaluateArgs(args, env);
    if (isReturn(argVals) || isBranch(argVals) || isThrow(argVals)) return argVals;
    const method = (REFLECT_METHODS as Record<string, (...args: TypeValue[]) => TypeValue>)[methodName];
    if (method) return method(...(argVals as TypeValue[]));
    return T.unknown;
  }

  // Handle Promise instance methods (.then, .catch, .finally)
  if (objVal.kind === "promise") {
    const argVals = evaluateArgs(args, env);
    if (isReturn(argVals) || isBranch(argVals) || isThrow(argVals)) return argVals;
    const result = evaluatePromiseInstanceMethod(objVal, methodName, argVals as TypeValue[]);
    if (result !== null) return result;
  }

  // Handle Map instance methods
  if (objVal.kind === "instance" && objVal.className === "Map") {
    const argVals = evaluateArgs(args, env);
    if (isReturn(argVals) || isBranch(argVals) || isThrow(argVals)) return argVals;
    const method = MAP_INSTANCE_METHODS[methodName];
    if (method) {
      return method(...(argVals as TypeValue[]), objVal);
    }
  }

  // Handle Set instance methods
  if (objVal.kind === "instance" && objVal.className === "Set") {
    const argVals = evaluateArgs(args, env);
    if (isReturn(argVals) || isBranch(argVals) || isThrow(argVals)) return argVals;
    const method = SET_INSTANCE_METHODS[methodName];
    if (method) {
      return method(...(argVals as TypeValue[]), objVal);
    }
  }

  // Handle RegExp instance methods
  if (objVal.kind === "instance" && objVal.className === "RegExp") {
    const argVals = evaluateArgs(args, env);
    if (isReturn(argVals) || isBranch(argVals) || isThrow(argVals)) return argVals;
    const method = REGEXP_INSTANCE_METHODS[methodName];
    if (method) {
      return method(...(argVals as TypeValue[]), objVal);
    }
  }

  // Handle URL instance methods
  if (objVal.kind === "instance" && objVal.className === "URL") {
    const argVals = evaluateArgs(args, env);
    if (isReturn(argVals) || isBranch(argVals) || isThrow(argVals)) return argVals;
    const method = URL_INSTANCE_METHODS[methodName];
    if (method) {
      return method(...(argVals as TypeValue[]), objVal);
    }
  }

  // Handle URLSearchParams instance methods
  if (objVal.kind === "instance" && objVal.className === "URLSearchParams") {
    const argVals = evaluateArgs(args, env);
    if (isReturn(argVals) || isBranch(argVals) || isThrow(argVals)) return argVals;
    const method = URLSearchParams_INSTANCE_METHODS[methodName];
    if (method) {
      return method(...(argVals as TypeValue[]), objVal);
    }
  }

  // Handle Response instance methods
  if (objVal.kind === "instance" && objVal.className === "Response") {
    const argVals = evaluateArgs(args, env);
    if (isReturn(argVals) || isBranch(argVals) || isThrow(argVals)) return argVals;
    const method = RESPONSE_INSTANCE_METHODS[methodName];
    if (method) {
      return method(...(argVals as TypeValue[]), objVal);
    }
  }

  // Handle Headers instance methods
  if (objVal.kind === "instance" && objVal.className === "Headers") {
    const argVals = evaluateArgs(args, env);
    if (isReturn(argVals) || isBranch(argVals) || isThrow(argVals)) return argVals;
    const method = HEADERS_INSTANCE_METHODS[methodName];
    if (method) {
      return method(...(argVals as TypeValue[]), objVal);
    }
  }

  // Handle FormData instance methods
  if (objVal.kind === "instance" && objVal.className === "FormData") {
    const argVals = evaluateArgs(args, env);
    if (isReturn(argVals) || isBranch(argVals) || isThrow(argVals)) return argVals;
    const method = FORMDATA_INSTANCE_METHODS[methodName];
    if (method) {
      return method(...(argVals as TypeValue[]), objVal);
    }
  }

  // Handle AbortController instance methods
  if (objVal.kind === "instance" && objVal.className === "AbortController") {
    const argVals = evaluateArgs(args, env);
    if (isReturn(argVals) || isBranch(argVals) || isThrow(argVals)) return argVals;
    const method = ABORTCONTROLLER_INSTANCE_METHODS[methodName];
    if (method) {
      return method(...(argVals as TypeValue[]), objVal);
    }
  }

  // Handle WeakMap instance methods
  if (objVal.kind === "instance" && objVal.className === "WeakMap") {
    const argVals = evaluateArgs(args, env);
    if (isReturn(argVals) || isBranch(argVals) || isThrow(argVals)) return argVals;
    const method = WEAKMAP_INSTANCE_METHODS[methodName];
    if (method) {
      return method(...(argVals as TypeValue[]), objVal);
    }
  }

  // Handle WeakSet instance methods
  if (objVal.kind === "instance" && objVal.className === "WeakSet") {
    const argVals = evaluateArgs(args, env);
    if (isReturn(argVals) || isBranch(argVals) || isThrow(argVals)) return argVals;
    const method = WEAKSET_INSTANCE_METHODS[methodName];
    if (method) {
      return method(...(argVals as TypeValue[]), objVal);
    }
  }

  // Handle DateTimeFormat instance methods
  if (objVal.kind === "instance" && objVal.className === "DateTimeFormat") {
    const argVals = evaluateArgs(args, env);
    if (isReturn(argVals) || isBranch(argVals) || isThrow(argVals)) return argVals;
    const method = INTL_DATETIMEFORMAT_METHODS[methodName];
    if (method) {
      return method(...(argVals as TypeValue[]), objVal);
    }
  }

  // Handle NumberFormat instance methods
  if (objVal.kind === "instance" && objVal.className === "NumberFormat") {
    const argVals = evaluateArgs(args, env);
    if (isReturn(argVals) || isBranch(argVals) || isThrow(argVals)) return argVals;
    const method = INTL_NUMBERFORMAT_METHODS[methodName];
    if (method) {
      return method(...(argVals as TypeValue[]), objVal);
    }
  }

  if (
    callee.object.type === "Identifier" &&
    callee.object.name === "Object" &&
    !env.has("Object") &&
    args.length >= 1
  ) {
    const argVal = evaluate(args[0], env);
    if (isReturn(argVal) || isBranch(argVal) || isThrow(argVal)) return argVal;
    return evaluateObjectStaticMethod(methodName, argVal);
  }

  if (objVal.kind === "array" || objVal.kind === "tuple") {
    const arrResult = evaluateArrayMethod(objVal, methodName, args, env);
    if (arrResult === null) {
      recordUnknown({
        kind: "method",
        name: methodName,
        receiverType: objVal,
        loc: callee.loc,
        reason: `no method '${methodName}' on ${objVal.kind}`,
      });
    }
    return arrResult;
  }

  if (isStringLike(objVal)) {
    const argVals = evaluateArgs(args, env);
    if (isReturn(argVals) || isBranch(argVals) || isThrow(argVals)) return argVals;

    if (objVal.kind === "refined") {
      const refined = dispatchMethod(objVal, methodName, argVals as TypeValue[]);
      if (refined !== undefined) return refined;
    }

    const strResult = evaluateStringMethod(objVal, methodName, argVals as TypeValue[]);
    if (strResult === null) {
      recordUnknown({
        kind: "method",
        name: methodName,
        receiverType: objVal,
        loc: callee.loc,
        reason: `no method '${methodName}' on ${objVal.kind}`,
      });
    }
    return strResult;
  }

  if (objVal.kind === "refined") {
    const argVals = evaluateArgs(args, env);
    if (isReturn(argVals) || isBranch(argVals) || isThrow(argVals)) return argVals;
    const result = dispatchMethod(objVal, methodName, argVals as TypeValue[]);
    if (result !== undefined) return result;
  }

  // Method dispatch fallback: no handler matched. For receivers whose property
  // lookup may still succeed (object/instance/refined/promise — resolved by the
  // MemberExpression evaluation downstream), stay silent; for everything else
  // this call will degrade to T.unknown, so record it.
  if (
    objVal.kind !== "object" && objVal.kind !== "instance" &&
    objVal.kind !== "refined" && objVal.kind !== "promise"
  ) {
    recordUnknown({
      kind: "method",
      name: methodName,
      receiverType: objVal,
      loc: callee.loc,
      reason: `no method '${methodName}' on ${objVal.kind}`,
    });
  }

  return null;
}

function isStringLike(tv: TypeValue): boolean {
  if (tv.kind === "literal" && typeof tv.value === "string") return true;
  if (tv.kind === "primitive" && tv.type === "string") return true;
  if (tv.kind === "refined") return isStringLike(tv.base);
  return false;
}

function evaluateStringMethod(
  receiver: TypeValue,
  method: string,
  args: TypeValue[],
): TypeValue | null {
  if (receiver.kind === "literal" && typeof receiver.value === "string") {
    return evaluateStringMethodLiteral(receiver.value, method, args);
  }
  return evaluateStringMethodAbstract(method, args);
}

function evaluateStringMethodLiteral(
  str: string,
  method: string,
  args: TypeValue[],
): TypeValue | null {
  const litArg = (i: number): string | number | undefined => {
    const a = args[i];
    if (a?.kind === "literal" && (typeof a.value === "string" || typeof a.value === "number")) return a.value;
    return undefined;
  };

  switch (method) {
    case "toUpperCase": return T.literal(str.toUpperCase());
    case "toLowerCase": return T.literal(str.toLowerCase());
    case "trim": return T.literal(str.trim());
    case "trimStart": return T.literal(str.trimStart());
    case "trimEnd": return T.literal(str.trimEnd());
    case "charAt": {
      const idx = litArg(0);
      return typeof idx === "number" ? T.literal(str.charAt(idx)) : T.string;
    }
    case "charCodeAt": {
      const idx = litArg(0);
      return typeof idx === "number" ? T.literal(str.charCodeAt(idx)) : T.number;
    }
    case "at": {
      const idx = litArg(0);
      if (typeof idx === "number") {
        const ch = str.at(idx);
        return ch !== undefined ? T.literal(ch) : T.undefined;
      }
      return T.union(T.string, T.undefined);
    }
    case "startsWith": {
      const search = litArg(0);
      return typeof search === "string" ? T.literal(str.startsWith(search as string)) : T.boolean;
    }
    case "endsWith": {
      const search = litArg(0);
      return typeof search === "string" ? T.literal(str.endsWith(search as string)) : T.boolean;
    }
    case "includes": {
      const search = litArg(0);
      return typeof search === "string" ? T.literal(str.includes(search as string)) : T.boolean;
    }
    case "indexOf": {
      const search = litArg(0);
      return typeof search === "string" ? T.literal(str.indexOf(search as string)) : T.number;
    }
    case "lastIndexOf": {
      const search = litArg(0);
      return typeof search === "string" ? T.literal(str.lastIndexOf(search as string)) : T.number;
    }
    case "slice": {
      const start = litArg(0);
      const end = litArg(1);
      if (typeof start === "number") {
        return T.literal(str.slice(start, typeof end === "number" ? end : undefined));
      }
      return T.string;
    }
    case "substring": {
      const start = litArg(0);
      const end = litArg(1);
      if (typeof start === "number") {
        return T.literal(str.substring(start, typeof end === "number" ? end : undefined));
      }
      return T.string;
    }
    case "split": {
      const sep = litArg(0);
      if (typeof sep === "string") {
        const parts = str.split(sep);
        return T.tuple(parts.map((p) => T.literal(p)));
      }
      return T.array(T.string);
    }
    case "replace": {
      const search = litArg(0);
      const replacement = litArg(1);
      if (typeof search === "string" && typeof replacement === "string") {
        return T.literal(str.replace(search, replacement));
      }
      return T.string;
    }
    case "replaceAll": {
      const search = litArg(0);
      const replacement = litArg(1);
      if (typeof search === "string" && typeof replacement === "string") {
        return T.literal(str.replaceAll(search, replacement));
      }
      return T.string;
    }
    case "repeat": {
      const count = litArg(0);
      return typeof count === "number" ? T.literal(str.repeat(count)) : T.string;
    }
    case "padStart": {
      const len = litArg(0);
      const fill = litArg(1);
      if (typeof len === "number") {
        return T.literal(str.padStart(len, typeof fill === "string" ? fill : undefined));
      }
      return T.string;
    }
    case "padEnd": {
      const len = litArg(0);
      const fill = litArg(1);
      if (typeof len === "number") {
        return T.literal(str.padEnd(len, typeof fill === "string" ? fill : undefined));
      }
      return T.string;
    }
    default:
      return null;
  }
}

function evaluateStringMethodAbstract(
  method: string,
  _args: TypeValue[],
): TypeValue | null {
  switch (method) {
    case "toUpperCase":
    case "toLowerCase":
    case "trim":
    case "trimStart":
    case "trimEnd":
    case "charAt":
    case "slice":
    case "substring":
    case "replace":
    case "replaceAll":
    case "repeat":
    case "padStart":
    case "padEnd":
      return T.string;
    case "charCodeAt":
    case "indexOf":
    case "lastIndexOf":
      return T.number;
    case "at":
      return T.union(T.string, T.undefined);
    case "startsWith":
    case "endsWith":
    case "includes":
      return T.boolean;
    case "split":
      return T.array(T.string);
    default:
      return null;
  }
}

function evaluateObjectStaticMethod(
  method: string,
  obj: TypeValue,
): TypeValue | null {
  if (obj.kind !== "object") {
    if (method === "keys") return T.array(T.string);
    if (method === "values") return T.array(T.unknown);
    if (method === "entries") return T.array(T.tuple([T.string, T.unknown]));
    return null;
  }

  const keys = Object.keys(obj.properties);
  const values = Object.values(obj.properties);

  if (method === "keys") {
    return T.tuple(keys.map((k) => T.literal(k)));
  }
  if (method === "values") {
    return T.tuple(values);
  }
  if (method === "entries") {
    return T.tuple(
      keys.map((k) => T.tuple([T.literal(k), obj.properties[k]])),
    );
  }
  return null;
}

function evaluateArrayMethod(
  arr: TypeValue & { kind: "array" | "tuple" },
  method: string,
  args: Node[],
  env: Environment,
): EvalResult | null {
  const argVals = evaluateArgs(args, env);
  if (isReturn(argVals) || isBranch(argVals) || isThrow(argVals)) return argVals;

  const callbackFn = (argVals as TypeValue[])[0];

  if (method === "push") {
    if (arr.kind === "tuple") {
      arr.elements.push(...(argVals as TypeValue[]));
      return T.literal(arr.elements.length);
    }
    return T.number;
  }

  if (method === "length") {
    return arr.kind === "tuple" ? T.literal(arr.elements.length) : T.number;
  }

  if (method === "pop" || method === "shift") {
    if (arr.kind === "tuple") {
      // 抽象数组不模拟顺序语义：返回元素 union（空 tuple 理论返回 undefined，union 进去保持 sound）
      if (arr.elements.length === 0) return T.undefined;
      return T.union(...arr.elements);
    }
    return T.unknown;
  }

  if (method === "unshift") {
    if (arr.kind === "tuple") {
      return T.literal(arr.elements.length + (argVals as TypeValue[]).length);
    }
    return T.number;
  }

  if (method === "indexOf" || method === "lastIndexOf") {
    return T.number;
  }

  if (method === "includes") {
    if (arr.kind === "tuple" && (argVals as TypeValue[])[0]?.kind === "literal") {
      const searchVal = (argVals as TypeValue[])[0];
      const found = arr.elements.some((e) => typeValueEquals(e, searchVal));
      return T.literal(found);
    }
    return T.boolean;
  }

  if (method === "join") {
    return T.string;
  }

  if (method === "concat") {
    if (arr.kind === "tuple") {
      const otherElements: TypeValue[] = [];
      for (const a of argVals as TypeValue[]) {
        if (a.kind === "tuple") otherElements.push(...a.elements);
        else if (a.kind === "array") return T.array(simplifyUnion([...arr.elements, a.element]));
        else otherElements.push(a);
      }
      return T.tuple([...arr.elements, ...otherElements]);
    }
    return T.array(arr.element);
  }

  if (method === "slice") {
    if (arr.kind === "tuple") {
      const start = (argVals as TypeValue[])[0];
      const end = (argVals as TypeValue[])[1];
      const startIdx = start?.kind === "literal" && typeof start.value === "number" ? start.value : 0;
      const endIdx = end?.kind === "literal" && typeof end.value === "number" ? end.value : arr.elements.length;
      return T.tuple(arr.elements.slice(startIdx, endIdx));
    }
    return T.array(arr.element);
  }

  if (!callbackFn || callbackFn.kind !== "function") {
    if (method === "map") return arr.kind === "tuple" ? T.tuple(arr.elements.map(() => T.unknown)) : T.array(T.unknown);
    if (method === "filter") return arr.kind === "tuple" ? T.array(simplifyUnion(arr.elements)) : arr;
    if (method === "find") return arr.kind === "tuple" ? simplifyUnion([...arr.elements, T.undefined]) : simplifyUnion([arr.element, T.undefined]);
    if (method === "some" || method === "every") return T.boolean;
    if (method === "reduce") return (argVals as TypeValue[])[1] ?? T.unknown;
    if (method === "forEach") return T.undefined;
    if (method === "flatMap") return T.array(T.unknown);
    return null;
  }

  const fn = callbackFn as TypeValue & { kind: "function" };

  if (method === "map") {
    if (arr.kind === "tuple") {
      const mapped = arr.elements.map((el, i) =>
        callFunction(fn, [el, T.literal(i), arr]),
      );
      return T.tuple(mapped);
    }
    return T.array(callFunction(fn, [arr.element, T.number, arr]));
  }

  if (method === "filter") {
    if (arr.kind === "tuple") {
      const kept: TypeValue[] = [];
      for (let i = 0; i < arr.elements.length; i++) {
        const result = callFunction(fn, [arr.elements[i], T.literal(i), arr]);
        if (result.kind === "literal" && !result.value) continue;
        kept.push(arr.elements[i]);
      }
      if (kept.length === 0) return T.tuple([]);
      return T.array(simplifyUnion(kept));
    }
    return T.array(arr.element);
  }

  if (method === "reduce") {
    const init = (argVals as TypeValue[])[1];
    if (arr.kind === "tuple") {
      let acc = init ?? arr.elements[0] ?? T.unknown;
      const startIdx = init ? 0 : 1;
      for (let i = startIdx; i < arr.elements.length; i++) {
        acc = callFunction(fn, [acc, arr.elements[i], T.literal(i), arr]);
      }
      return acc;
    }
    // For arrays, we can't iterate all elements, but we can call the function
    // with the accumulator and element type to infer the result type
    const acc = init ?? arr.element;
    const result = callFunction(fn, [acc, arr.element, T.number, arr]);
    // If the result is the same type as the accumulator, it's likely correct
    // (e.g., number + number = number)
    return result;
  }

  if (method === "find") {
    const elementType = arr.kind === "tuple"
      ? simplifyUnion(arr.elements)
      : arr.element;
    return simplifyUnion([elementType, T.undefined]);
  }

  if (method === "some" || method === "every") {
    if (arr.kind === "tuple") {
      const results = arr.elements.map((el, i) =>
        callFunction(fn, [el, T.literal(i), arr]),
      );
      const allLiteral = results.every((r) => r.kind === "literal");
      if (allLiteral) {
        const boolVals = results.map((r) => !!(r as TypeValue & { kind: "literal" }).value);
        return T.literal(method === "some" ? boolVals.some(Boolean) : boolVals.every(Boolean));
      }
    }
    return T.boolean;
  }

  if (method === "forEach") {
    if (arr.kind === "tuple") {
      arr.elements.forEach((el, i) => callFunction(fn, [el, T.literal(i), arr]));
    } else {
      callFunction(fn, [arr.element, T.number, arr]);
    }
    return T.undefined;
  }

  if (method === "flatMap") {
    if (arr.kind === "tuple") {
      const results: TypeValue[] = [];
      for (let i = 0; i < arr.elements.length; i++) {
        const r = callFunction(fn, [arr.elements[i], T.literal(i), arr]);
        if (r.kind === "tuple") results.push(...r.elements);
        else if (r.kind === "array") return T.array(r.element);
        else results.push(r);
      }
      return T.tuple(results);
    }
    const r = callFunction(fn, [arr.element, T.number, arr]);
    if (r.kind === "tuple") return T.array(simplifyUnion(r.elements));
    if (r.kind === "array") return T.array(r.element);
    return T.array(r);
  }

  return null;
}

function evaluateForOf(
  node: Node & { type: "ForOfStatement" },
  iterable: TypeValue,
  env: Environment,
): EvalResult {
  if (iterable.kind === "tuple") {
    const returnValues: TypeValue[] = [];
    let currentEnv = env;
    for (const element of iterable.elements) {
      const loopEnv = currentEnv.extend({});
      bindForLoopVar(node.left, element, loopEnv);
      const result = evaluate(node.body, loopEnv);
      if (isReturn(result)) {
        returnValues.push(result.value);
        return makeReturn(simplifyUnion(returnValues));
      }
      if (isBranch(result)) {
        returnValues.push(result.returnedValue);
        currentEnv = result.fallthroughEnv;
      }
    }
    if (returnValues.length > 0) {
      return makeBranch(simplifyUnion(returnValues), currentEnv);
    }
    return T.undefined;
  }

  if (iterable.kind === "array") {
    const loopEnv = env.fork();
    bindForLoopVar(node.left, iterable.element, loopEnv);
    const result = evaluate(node.body, loopEnv);
    if (isReturn(result)) return makeBranch(result.value, env);
    return T.undefined;
  }

  return T.undefined;
}

function evaluateForIn(
  node: Node & { type: "ForInStatement" },
  obj: TypeValue,
  env: Environment,
): EvalResult {
  if (obj.kind === "object") {
    const keys = Object.keys(obj.properties);
    if (keys.length > 0) {
      const returnValues: TypeValue[] = [];
      let currentEnv = env;
      for (const key of keys) {
        const loopEnv = currentEnv.extend({});
        bindForLoopVar(node.left, T.literal(key), loopEnv);
        const result = evaluate(node.body, loopEnv);
        if (isReturn(result)) {
          returnValues.push(result.value);
          return makeReturn(simplifyUnion(returnValues));
        }
        if (isBranch(result)) {
          returnValues.push(result.returnedValue);
          currentEnv = result.fallthroughEnv;
        }
      }
      if (returnValues.length > 0) {
        return makeBranch(simplifyUnion(returnValues), currentEnv);
      }
      return T.undefined;
    }
  }

  const loopEnv = env.fork();
  bindForLoopVar(node.left, T.string, loopEnv);
  evaluate(node.body, loopEnv);
  return T.undefined;
}

function bindForLoopVar(left: Node, value: TypeValue, env: Environment): void {
  if (left.type === "VariableDeclaration") {
    const decl = left.declarations[0];
    if (decl) bindPattern(decl.id, value, env);
  } else if (left.type === "Identifier") {
    env.bind(left.name, value);
  }
}

function getLoopVarNames(node: Node): string[] {
  if (node.type === "VariableDeclaration") {
    return node.declarations
      .map((d: any) => d.id?.type === "Identifier" ? d.id.name : null)
      .filter((n: string | null): n is string => n !== null);
  }
  return [];
}

function snapshotVars(names: string[], env: Environment): Map<string, TypeValue> {
  const snap = new Map<string, TypeValue>();
  for (const name of names) {
    snap.set(name, env.lookup(name));
  }
  return snap;
}

function varsStabilized(prev: Map<string, TypeValue>, curr: Map<string, TypeValue>): boolean {
  for (const [name, prevVal] of prev) {
    const currVal = curr.get(name);
    if (!currVal || !typeValueEquals(prevVal, currVal)) return false;
  }
  return true;
}

function widenVars(names: string[], env: Environment): void {
  for (const name of names) {
    const val = env.lookup(name);
    const widened = widenLiteral(val);
    if (!typeValueEquals(val, widened)) {
      if (!env.update(name, widened)) env.bind(name, widened);
    }
  }
}

function evaluateForStatement(
  node: Node & { type: "ForStatement" },
  env: Environment,
): EvalResult {
  const loopEnv = env.fork();

  if (node.init) {
    const initResult = evaluate(node.init, loopEnv);
    if (isReturn(initResult) || isBranch(initResult) || isThrow(initResult)) return initResult;
  }

  const varNames = node.init ? getLoopVarNames(node.init) : [];
  const returnValues: TypeValue[] = [];
  let concreteCompleted = false;

  for (let i = 0; i < _maxConcreteIter; i++) {
    if (node.test) {
      const testVal = evaluate(node.test, loopEnv);
      if (isReturn(testVal) || isBranch(testVal) || isThrow(testVal)) return testVal;
      if (testVal.kind === "literal" && testVal.value === false) { concreteCompleted = true; break; }
      if (testVal.kind !== "literal") break;
    }

    const bodyResult = evaluate(node.body, loopEnv);
    if (isReturn(bodyResult)) {
      returnValues.push(bodyResult.value);
      concreteCompleted = true;
      break;
    }
    if (isBranch(bodyResult)) {
      returnValues.push(bodyResult.returnedValue);
    }

    if (node.update) {
      const updateResult = evaluate(node.update, loopEnv);
      if (isReturn(updateResult) || isBranch(updateResult) || isThrow(updateResult)) return updateResult;
    }
  }

  if (!concreteCompleted) {
    widenVars(varNames, loopEnv);
    const prevSnap = snapshotVars(varNames, loopEnv);

    for (let i = 0; i < 10; i++) {
      evaluate(node.body, loopEnv);
      if (node.update) evaluate(node.update, loopEnv);
      widenVars(varNames, loopEnv);
      const currSnap = snapshotVars(varNames, loopEnv);
      if (varsStabilized(prevSnap, currSnap)) break;
    }
  }

  for (const name of varNames) {
    const val = loopEnv.lookup(name);
    if (!env.update(name, val)) env.bind(name, val);
  }

  if (returnValues.length > 0) {
    return makeBranch(simplifyUnion(returnValues), env);
  }
  return T.undefined;
}

function evaluateWhileStatement(
  node: Node & { type: "WhileStatement" },
  env: Environment,
): EvalResult {
  const returnValues: TypeValue[] = [];

  for (let i = 0; i < _maxConcreteIter; i++) {
    const tv = evaluate(node.test, env);
    if (isReturn(tv) || isBranch(tv) || isThrow(tv)) return tv;
    if (tv.kind === "literal" && tv.value === false) break;
    if (tv.kind !== "literal") break;

    const bodyResult = evaluate(node.body, env);
    if (isReturn(bodyResult)) {
      returnValues.push(bodyResult.value);
      break;
    }
    if (isBranch(bodyResult)) {
      returnValues.push(bodyResult.returnedValue);
    }
  }

  if (returnValues.length > 0) {
    return makeBranch(simplifyUnion(returnValues), env);
  }
  return T.undefined;
}

function evaluateDoWhileStatement(
  node: Node & { type: "DoWhileStatement" },
  env: Environment,
): EvalResult {
  const returnValues: TypeValue[] = [];

  for (let i = 0; i < _maxConcreteIter; i++) {
    const bodyResult = evaluate(node.body, env);
    if (isReturn(bodyResult)) {
      returnValues.push(bodyResult.value);
      break;
    }
    if (isBranch(bodyResult)) {
      returnValues.push(bodyResult.returnedValue);
    }

    const tv = evaluate(node.test, env);
    if (isReturn(tv) || isBranch(tv) || isThrow(tv)) return tv;
    if (tv.kind === "literal" && tv.value === false) break;
    if (tv.kind !== "literal") break;
  }

  if (returnValues.length > 0) {
    return makeBranch(simplifyUnion(returnValues), env);
  }
  return T.undefined;
}

/** Load (or fetch from cache) the environment for a resolved module file.
 * Shared by ESM import and CJS require — one loading path, one cache. */
function loadModuleEnv(resolved: { ast: Node; filePath: string }): Environment {
  let moduleEnv = moduleCache.get(resolved.filePath);
  if (!moduleEnv) {
    moduleEnv = createEnvironment();
    moduleCache.set(resolved.filePath, moduleEnv);
    const savedDir = currentFileDir;
    currentFileDir = resolved.filePath.replace(/\/[^/]+$/, "");
    evaluateProgram(resolved.ast, moduleEnv);
    currentFileDir = savedDir;
    tagModuleExports(moduleEnv, resolved.filePath);
    tagCommonJsExports(moduleEnv, resolved.filePath);
  }
  return moduleEnv;
}

/** Build an exports namespace object from a module's `__export_` bindings
 * (ESM exports required from CJS). Null when the module exports nothing. */
function namespaceFromExportBindings(env: Environment): TypeValue | null {
  const exports: Record<string, TypeValue> = {};
  const bindings = env.getOwnBindings();
  for (const [k, v] of Object.entries(bindings)) {
    if (!k.startsWith("__export_")) continue;
    exports[k === "__export_default" ? "default" : k.slice("__export_".length)] = v;
  }
  if (Object.keys(exports).length === 0) return null;
  return T.object(exports);
}

/** The value of require() for an evaluated module: `module.exports` when the
 * target assigned it, the (possibly `exports.x`-mutated) exports object
 * otherwise, and the ESM namespace when the target is an ES module. */
function commonJsExportsValue(moduleEnv: Environment): TypeValue {
  if (moduleEnv.has("module")) {
    const moduleVal = moduleEnv.lookup("module");
    if (moduleVal.kind === "object") {
      const exp = moduleVal.properties["exports"];
      if (exp) {
        if (
          exp.kind === "object" &&
          (exp as any).__cjsExportsRoot === true &&
          Object.keys(exp.properties).length === 0
        ) {
          // Target never wrote CJS exports — surface ESM exports instead.
          return namespaceFromExportBindings(moduleEnv) ?? exp;
        }
        return exp;
      }
    }
  }
  return T.unknown;
}

/** JSON 值 → TypeValue（字面量级精确：package.json 版本号等成为 string 字面量） */
function jsonToTypeValue(v: unknown): TypeValue {
  if (v === null) return T.literal(null);
  if (typeof v === "string") return T.literal(v);
  if (typeof v === "number") return T.literal(v);
  if (typeof v === "boolean") return T.literal(v);
  if (Array.isArray(v)) return T.tuple(v.map(jsonToTypeValue));
  if (typeof v === "object") {
    const props: Record<string, TypeValue> = {};
    for (const [k, val] of Object.entries(v)) props[k] = jsonToTypeValue(val);
    return T.object(props);
  }
  return T.unknown;
}

function evaluateRequireCall(node: Node & { type: "CallExpression" }, _env: Environment): EvalResult {  const arg = (node.arguments as Node[])[0];
  if (!arg || arg.type !== "StringLiteral") {
    recordUnknown({
      kind: "global",
      name: "require",
      loc: node.loc,
      reason: "require() with non-literal specifier",
    });
    return T.unknown;
  }
  const specifier = arg.value as string;
  // Bare specifiers (npm packages) are not resolved in v1.
  if (!specifier.startsWith(".") && !specifier.startsWith("/")) {
    recordUnknown({
      kind: "global",
      name: `require('${specifier}')`,
      loc: node.loc,
      reason: `bare module specifier '${specifier}' is not resolved (npm packages unsupported)`,
    });
    return T.unknown;
  }
  if (!currentModuleResolver) return T.unknown;
  const resolved = currentModuleResolver(specifier, currentFileDir);
  if (!resolved) {
    recordUnknown({
      kind: "global",
      name: `require('${specifier}')`,
      loc: node.loc,
      reason: `cannot resolve module '${specifier}'`,
    });
    return T.unknown;
  }
  // .json 模块（如 require('../package.json')）：JSON 值直接映射为字面量类型
  if ("json" in resolved && resolved.json !== undefined) {
    return jsonToTypeValue(resolved.json);
  }
  return commonJsExportsValue(loadModuleEnv(resolved));
}

function evaluateImportDeclaration(node: Node & { type: "ImportDeclaration" }, env: Environment): EvalResult {
  const source = node.source.value;

  const mockModule = mockModules.get(source);
  if (mockModule && currentModuleResolver) {
    const mockResolved = currentModuleResolver(mockModule.fromPath, currentFileDir);
    if (mockResolved) {
      const mockEnv = loadModuleEnv(mockResolved);

      if (mockModule.names) {
        const originalResolved = currentModuleResolver(source, currentFileDir);
        let originalEnv: Environment | undefined;
        if (originalResolved) {
          originalEnv = loadModuleEnv(originalResolved);
        }

        for (const spec of node.specifiers) {
          if (spec.type === "ImportSpecifier") {
            const importedName = spec.imported.type === "Identifier" ? spec.imported.name : null;
            if (importedName && mockModule.names.includes(importedName)) {
              const val = mockEnv.has(`__export_${importedName}`) ? mockEnv.lookup(`__export_${importedName}`) : T.unknown;
              env.bind(spec.local.name, val);
            } else if (importedName && originalEnv) {
              const val = originalEnv.has(`__export_${importedName}`) ? originalEnv.lookup(`__export_${importedName}`) : T.unknown;
              env.bind(spec.local.name, val);
            }
          } else if (spec.type === "ImportDefaultSpecifier") {
            const sourceEnv = originalEnv ?? mockEnv;
            const val = sourceEnv.has(`__export_default`) ? sourceEnv.lookup(`__export_default`) : T.unknown;
            env.bind(spec.local.name, val);
          } else if (spec.type === "ImportNamespaceSpecifier") {
            const exports: Record<string, TypeValue> = {};
            const sourceEnv = originalEnv ?? mockEnv;
            const bindings = sourceEnv.getOwnBindings();
            for (const [k, v] of Object.entries(bindings)) {
              if (k.startsWith("__export_") && k !== "__export_default") {
                const name = k.slice("__export_".length);
                exports[name] = mockModule.names.includes(name)
                  ? (mockEnv.has(k) ? mockEnv.lookup(k) : v)
                  : v;
              }
            }
            const mockBindings = mockEnv.getOwnBindings();
            for (const [k, v] of Object.entries(mockBindings)) {
              if (k.startsWith("__export_") && k !== "__export_default") {
                const name = k.slice("__export_".length);
                if (mockModule.names.includes(name)) {
                  exports[name] = v;
                }
              }
            }
            env.bind(spec.local.name, T.object(exports));
          }
        }
        return T.undefined;
      }

      for (const spec of node.specifiers) {
        if (spec.type === "ImportDefaultSpecifier") {
          const val = mockEnv.has(`__export_default`) ? mockEnv.lookup(`__export_default`) : T.unknown;
          env.bind(spec.local.name, val);
        } else if (spec.type === "ImportSpecifier") {
          const importedName = spec.imported.type === "Identifier" ? spec.imported.name : null;
          if (importedName) {
            const val = mockEnv.has(`__export_${importedName}`) ? mockEnv.lookup(`__export_${importedName}`) : T.unknown;
            env.bind(spec.local.name, val);
          }
        } else if (spec.type === "ImportNamespaceSpecifier") {
          const exports: Record<string, TypeValue> = {};
          const bindings = mockEnv.getOwnBindings();
          for (const [k, v] of Object.entries(bindings)) {
            if (k.startsWith("__export_") && k !== "__export_default") {
              exports[k.slice("__export_".length)] = v;
            }
          }
          env.bind(spec.local.name, T.object(exports));
        }
      }
      return T.undefined;
    }
  }

  const envModule = envModules[source];
  if (envModule) {
    for (const spec of node.specifiers) {
      if (spec.type === "ImportDefaultSpecifier") {
        const defaultExport = envModule["default"];
        env.bind(spec.local.name, defaultExport ?? T.unknown);
      } else if (spec.type === "ImportSpecifier") {
        const importedName = spec.imported.type === "Identifier" ? spec.imported.name : null;
        if (importedName) {
          env.bind(spec.local.name, envModule[importedName] ?? T.unknown);
        }
      } else if (spec.type === "ImportNamespaceSpecifier") {
        const { default: _default, ...rest } = envModule;
        env.bind(spec.local.name, T.object(rest));
      }
    }
    return T.undefined;
  }

  if (!currentModuleResolver) return T.undefined;

  const resolved = currentModuleResolver(source, currentFileDir);
  if (!resolved) return T.undefined;

  const moduleEnv = loadModuleEnv(resolved);

  for (const spec of node.specifiers) {
    if (spec.type === "ImportDefaultSpecifier") {
      const val = moduleEnv.has(`__export_default`) ? moduleEnv.lookup(`__export_default`) : T.unknown;
      env.bind(spec.local.name, val);
    } else if (spec.type === "ImportSpecifier") {
      const importedName = spec.imported.type === "Identifier" ? spec.imported.name : null;
      if (importedName) {
        const val = moduleEnv.has(`__export_${importedName}`) ? moduleEnv.lookup(`__export_${importedName}`) : T.unknown;
        env.bind(spec.local.name, val);
      }
    } else if (spec.type === "ImportNamespaceSpecifier") {
      const exports: Record<string, TypeValue> = {};
      const bindings = moduleEnv.getOwnBindings();
      for (const [k, v] of Object.entries(bindings)) {
        if (k.startsWith("__export_") && k !== "__export_default") {
          exports[k.slice("__export_".length)] = v;
        }
      }
      env.bind(spec.local.name, T.object(exports));
    }
  }

  return T.undefined;
}

function evaluateClassDeclaration(node: Node & { type: "ClassDeclaration" }, env: Environment): EvalResult {
  const className = node.id?.name ?? "<anonymous>";
  const methods: Record<string, TypeValue> = {};
  let constructorFn: (TypeValue & { kind: "function" }) | null = null;

  for (const member of node.body.body) {
    if (member.type !== "ClassMethod") continue;
    const methodName = member.key.type === "Identifier" ? member.key.name : null;
    if (!methodName) continue;

    const paramNames = member.params.map((p: Node) =>
      p.type === "Identifier" ? p.name : `_p${Math.random().toString(36).slice(2, 6)}`,
    );
    const fnType = T.fn(paramNames, member.body, env) as TypeValue & { kind: "function" };
    (fnType as any)._paramPatterns = member.params;
    (fnType as any)._name = `${className}.${methodName}`;
    if (member.async) (fnType as any)._async = true;

    if (member.kind === "constructor") {
      constructorFn = fnType;
    } else {
      methods[methodName] = fnType;
    }
  }

  const ctorFn = constructorFn ?? T.fn([], { type: "BlockStatement", body: [], directives: [] } as any, env) as TypeValue & { kind: "function" };
  (ctorFn as any)._classInfo = { className, methods };

  if (node.id) {
    env.bind(className, ctorFn);
  }
  return T.undefined;
}

function evaluateInstanceof(left: TypeValue, _right: TypeValue, rightNode: Node, _env: Environment): TypeValue {
  const className = rightNode.type === "Identifier" ? rightNode.name : null;
  if (!className) return T.boolean;

  return distributeOverUnion(left, (lv) => {
    if (lv.kind === "instance") {
      const matches = lv.className === className ||
        isSubtypeOf(lv, T.instanceOf(className));
      return T.literal(matches);
    }
    return T.boolean;
  });
}

function evaluateNewExpression(node: Node & { type: "NewExpression" }, env: Environment): EvalResult {
  const callee = node.callee as Node;
  if (callee.type === "Identifier" && BUILTIN_ERROR_CLASSES.has(callee.name) && !env.has(callee.name)) {
    const argVals = evaluateArgs(node.arguments as Node[], env);
    if (isReturn(argVals) || isBranch(argVals) || isThrow(argVals)) return argVals;
    const msgVal = (argVals as TypeValue[])[0] ?? T.undefined;
    return T.instanceOf(callee.name, { message: msgVal });
  }

  // Handle new Map()
  if (callee.type === "Identifier" && callee.name === "Map" && !env.has("Map")) {
    const argVals = evaluateArgs(node.arguments as Node[], env);
    if (isReturn(argVals) || isBranch(argVals) || isThrow(argVals)) return argVals;
    return createMapType(argVals as TypeValue[]);
  }

  // Handle new Set()
  if (callee.type === "Identifier" && callee.name === "Set" && !env.has("Set")) {
    const argVals = evaluateArgs(node.arguments as Node[], env);
    if (isReturn(argVals) || isBranch(argVals) || isThrow(argVals)) return argVals;
    return createSetType(argVals as TypeValue[]);
  }

  // Handle new RegExp()
  if (callee.type === "Identifier" && callee.name === "RegExp" && !env.has("RegExp")) {
    return createRegExpType();
  }

  // Handle new URL()
  if (callee.type === "Identifier" && callee.name === "URL" && !env.has("URL")) {
    return createURLType();
  }

  // Handle new URLSearchParams()
  if (callee.type === "Identifier" && callee.name === "URLSearchParams" && !env.has("URLSearchParams")) {
    return createURLSearchParamsType();
  }

  // Handle new Response()
  if (callee.type === "Identifier" && callee.name === "Response" && !env.has("Response")) {
    return createResponseType();
  }

  // Handle new Headers()
  if (callee.type === "Identifier" && callee.name === "Headers" && !env.has("Headers")) {
    return createHeadersType();
  }

  // Handle new FormData()
  if (callee.type === "Identifier" && callee.name === "FormData" && !env.has("FormData")) {
    return createFormDataType();
  }

  // Handle new AbortController()
  if (callee.type === "Identifier" && callee.name === "AbortController" && !env.has("AbortController")) {
    return createAbortControllerType();
  }

  // Handle new WeakMap()
  if (callee.type === "Identifier" && callee.name === "WeakMap" && !env.has("WeakMap")) {
    return createWeakMapType();
  }

  // Handle new WeakSet()
  if (callee.type === "Identifier" && callee.name === "WeakSet" && !env.has("WeakSet")) {
    return createWeakSetType();
  }

  // Handle new Intl.DateTimeFormat() and new Intl.NumberFormat()
  if (callee.type === "MemberExpression" && !callee.computed) {
    const obj = callee.object as Node;
    const prop = callee.property as Node;
    if (obj.type === "Identifier" && obj.name === "Intl" && !env.has("Intl") && prop.type === "Identifier") {
      if (prop.name === "DateTimeFormat") {
        return createDateTimeFormatType();
      }
      if (prop.name === "NumberFormat") {
        return createNumberFormatType();
      }
    }
  }

  const calleeVal = evaluate(callee, env);
  if (isReturn(calleeVal) || isBranch(calleeVal) || isThrow(calleeVal)) return calleeVal;

  if (calleeVal.kind === "function") {
    const argVals = evaluateArgs(node.arguments as Node[], env);
    if (isReturn(argVals) || isBranch(argVals) || isThrow(argVals)) return argVals;

    const classInfo = (calleeVal as any)._classInfo as { className: string; methods: Record<string, TypeValue> } | undefined;
    if (classInfo) {
      const instanceProps: Record<string, TypeValue> = {};
      const constructEnv = calleeVal.closure.extend({});
      const thisObj = T.object(instanceProps);
      constructEnv.bind("this", thisObj);
      const paramPatterns = (calleeVal as any)._paramPatterns as Node[] | undefined;
      for (let i = 0; i < calleeVal.params.length; i++) {
        const argVal = (argVals as TypeValue[])[i] ?? T.undefined;
        if (paramPatterns?.[i]) {
          bindPattern(paramPatterns[i], argVal, constructEnv);
        } else {
          constructEnv.bind(calleeVal.params[i], argVal);
        }
      }
      const result = evaluate(calleeVal.body, constructEnv);
      if (isThrow(result)) return result;
      const finalThis = constructEnv.lookup("this");
      const props = finalThis.kind === "object" ? { ...finalThis.properties } : instanceProps;
      for (const [k, v] of Object.entries(classInfo.methods)) {
        props[k] = v;
      }
      return T.instanceOf(classInfo.className, props);
    }

    return callFunction(calleeVal, argVals as TypeValue[]);
  }

  return T.unknown;
}

function evaluateTryStatement(node: Node & { type: "TryStatement" }, env: Environment): EvalResult {
  const tryResult = evaluateStatements(node.block.body, env.fork());

  const thrownType = isThrow(tryResult) ? tryResult.thrown : null;

  const tryValue = isThrow(tryResult)
    ? null
    : isReturn(tryResult)
      ? tryResult
      : isBranch(tryResult)
        ? tryResult
        : tryResult;

  let catchResult: EvalResult | null = null;
  if (node.handler) {
    const catchEnv = env.fork();
    if (node.handler.param) {
      bindPattern(node.handler.param, thrownType ?? T.unknown, catchEnv);
    }
    catchResult = evaluateStatements(node.handler.body.body, catchEnv);
  }

  if (node.finalizer) {
    const finallyResult = evaluateStatements(node.finalizer.body, env.fork());
    if (isThrow(finallyResult)) return finallyResult;
    if (isReturn(finallyResult)) return finallyResult;
  }

  if (catchResult !== null) {
    if (isThrow(catchResult)) return catchResult;
    if (isReturn(catchResult)) {
      if (tryValue !== null && isReturn(tryValue)) {
        return makeReturn(simplifyUnion([tryValue.value, catchResult.value]));
      }
      return catchResult;
    }
    if (tryValue !== null && isReturn(tryValue)) {
      return tryValue;
    }
    if (tryValue !== null && isBranch(tryValue)) {
      return tryValue;
    }
    return catchResult;
  }

  if (thrownType && !node.handler) {
    return makeThrow(thrownType);
  }

  if (tryValue !== null) return tryValue;
  return T.undefined;
}

function evaluateSwitchStatement(node: Node & { type: "SwitchStatement" }, env: Environment): EvalResult {
  const discriminant = evaluate(node.discriminant, env);
  if (isReturn(discriminant) || isBranch(discriminant) || isThrow(discriminant)) return discriminant;

  const isConcreteDiscriminant = discriminant.kind === "literal";

  if (isConcreteDiscriminant) {
    let matched = false;
    const returnValues: TypeValue[] = [];
    for (const caseNode of node.cases) {
      if (caseNode.test) {
        const testVal = evaluate(caseNode.test, env);
        if (isReturn(testVal) || isBranch(testVal) || isThrow(testVal)) return testVal;
        if (testVal.kind === "literal" && discriminant.value === testVal.value) matched = true;
      } else {
        matched = true;
      }
      if (matched) {
        const result = evaluateStatements(caseNode.consequent, env);
        if (isThrow(result)) return result;
        if (isReturn(result)) {
          returnValues.push(result.value);
          break;
        }
        if (isBranch(result)) {
          returnValues.push(result.returnedValue);
          continue;
        }
      }
    }
    if (returnValues.length > 0) {
      return makeBranch(simplifyUnion(returnValues), env);
    }
    return T.undefined;
  }

  const returnValues: TypeValue[] = [];
  for (const caseNode of node.cases) {
    let caseEnv = env;
    if (caseNode.test) {
      const testVal = evaluate(caseNode.test, env);
      if (isReturn(testVal) || isBranch(testVal) || isThrow(testVal)) return testVal;

      // Try to narrow discriminant for this case using existing narrow()
      // Construct a synthetic BinaryExpression: discriminant === caseTest
      const syntheticTest = {
        type: "BinaryExpression",
        operator: "===",
        left: node.discriminant,
        right: caseNode.test,
        start: 0,
        end: 0,
        loc: null,
      } as unknown as Node;
      const [narrowedEnv] = narrow(syntheticTest, env);
      caseEnv = narrowedEnv;
    }

    const result = evaluateStatements(caseNode.consequent, caseEnv);
    if (isThrow(result)) continue;
    if (isReturn(result)) {
      returnValues.push(result.value);
      continue;
    }
    if (isBranch(result)) {
      returnValues.push(result.returnedValue);
      continue;
    }
  }
  if (returnValues.length > 0) {
    return makeBranch(simplifyUnion(returnValues), env);
  }
  return T.undefined;
}

type CallResult = {
  value: TypeValue;
  throws: TypeValue;
  throwLoc?: SourceRange;
};

// --- Recursion termination: cycle detection + depth/work budgets ---
// Abstract interpretation unrolls calls instead of iterating to a fixpoint,
// so recursive functions invoked under unconstrained arguments (e.g. an
// entry@ case where `seen.has(obj)` cannot concretely short-circuit) expand
// forever. Three guards cut the expansion, all returning T.unknown — the
// call-side dual of loop widening: the result simply drops the deeper
// iterations' effects instead of guessing them, a sound over-approximation.
//
// 1. Cycle detection: a call whose (function value, abstract args) pair is
//    already being evaluated higher on the stack makes no abstract progress
//    (clone(obj, seen) re-invoking itself with identical types). Unrolling it
//    anyway fans out exponentially, so the re-entrant edge is cut at its
//    first recurrence — the same treatment the call memo applies on
//    MEMO_IN_PROGRESS. Accumulator-growing recursion (deepEqual's `seen`
//    tuple getting one entry longer per level) never repeats a key verbatim,
//    so cycle keys are *widened*: tuples longer than CYCLE_TUPLE_CAP and
//    objects with more than CYCLE_PROP_CAP properties all normalize to the
//    same key, making accumulator growth collapse after a few levels.
//    Args-changing recursion (factorial(5) -> factorial(4)) is unaffected
//    because each level still has a distinct widened key.
// 2. Depth budget: backstop for recursion whose argument types keep morphing
//    without structurally repeating (f(n) -> f([n]) -> f([[n]]) ...) beyond
//    what the widening recognizes.
// 3. Total call budget: absolute bound on the unrolled call tree so no
//    pathological branching shape can exhaust memory; analysis of any file
//    stays linear in this budget.
const MAX_CALL_DEPTH = 64;
const MAX_TOTAL_CALLS = 200_000;
const CYCLE_TUPLE_CAP = 4;
const CYCLE_PROP_CAP = 8;
let _callDepth = 0;
let _totalCalls = 0;
const _activeCallKeys: string[] = [];
const _fnCallIds = new WeakMap<object, string>();
let _fnCallIdSeq = 0;

function cycleArgKey(tv: TypeValue): string {
  if (tv.kind === "tuple") {
    if (tv.elements.length > CYCLE_TUPLE_CAP) {
      return `[${tv.elements.slice(0, CYCLE_TUPLE_CAP).map(cycleArgKey).join(",")},…widened]`;
    }
    return `[${tv.elements.map(cycleArgKey).join(",")}]`;
  }
  if (tv.kind === "object") {
    const entries = Object.entries(tv.properties);
    if (entries.length > CYCLE_PROP_CAP) {
      return `{${entries.slice(0, CYCLE_PROP_CAP).map(([k, v]) => `${k}:${cycleArgKey(v)}`).join(",")},…widened}`;
    }
    return `{${entries.map(([k, v]) => `${k}:${cycleArgKey(v)}`).join(",")}}`;
  }
  if (tv.kind === "union") {
    return tv.members.map(cycleArgKey).join("|");
  }
  return typeValueToString(tv);
}

function fnCallKey(fn: TypeValue & { kind: "function" }, args: TypeValue[], thisVal?: TypeValue): string {
  let id = _fnCallIds.get(fn);
  if (!id) {
    id = `fn#${++_fnCallIdSeq}`;
    _fnCallIds.set(fn, id);
  }
  const thisKey = thisVal ? `@${cycleArgKey(thisVal)}` : "";
  return `${id}${thisKey}(${args.map(cycleArgKey).join(",")})`;
}

function callBudgetExhausted(fnName: string, loc: Node["loc"]): CallResult {
  // kind "global" reuses the existing UnknownRecord union (the analyzer
  // renders it as a warning-level record; no analyzer change needed).
  recordUnknown({
    kind: "global",
    name: `recursion:${fnName}`,
    loc,
    reason: `recursive call truncated to unknown (cycle, depth > ${MAX_CALL_DEPTH}, or work budget)`,
  });
  return { value: T.unknown, throws: T.never };
}

function callFunctionFull(
  fn: TypeValue & { kind: "function" },
  args: TypeValue[],
  thisVal?: TypeValue,
): CallResult {
  const callKey = fnCallKey(fn, args, thisVal);
  const fnName = (fn as any)._name ?? "<anonymous>";
  if (_activeCallKeys.includes(callKey) || _callDepth >= MAX_CALL_DEPTH || _totalCalls >= MAX_TOTAL_CALLS) {
    return callBudgetExhausted(fnName, fn.body?.loc);
  }
  _totalCalls++;
  _callDepth++;
  _activeCallKeys.push(callKey);
  try {
    return callFunctionUnchecked(fn, args, thisVal);
  } finally {
    _activeCallKeys.pop();
    _callDepth--;
  }
}

function callFunctionUnchecked(
  fn: TypeValue & { kind: "function" },
  args: TypeValue[],
  thisVal?: TypeValue,
): CallResult {
  // Check for direct return value (used by sinon mocks)
  const directReturn = (fn as any)._directReturn as TypeValue | undefined;
  if (directReturn) {
    return { value: directReturn, throws: T.never };
  }

  // Check for function signature impl (used by @nudo:env / @nudo:mock-module)
  const sig = getFnSig(fn);
  if (sig) {
    const implResult = sig.impl?.(args);
    return { value: implResult ?? sig.returnType, throws: sig.throwsType };
  }

  const callEnv = fn.closure.extend({});
  // `obj.f()` binds the receiver as the callee's `this` before parameters.
  // Arrow callees ignore it in real JS; their bodies still resolve `this`
  // through the closure chain here — accepted approximation.
  if (thisVal) callEnv.bind("this", thisVal);
  const paramPatterns = (fn as any)._paramPatterns as Node[] | undefined;
  const isAsync = !!(fn as any)._async;
  for (let i = 0; i < fn.params.length; i++) {
    const paramName = fn.params[i];
    // Check if this is a rest parameter (starts with ...)
    if (paramName.startsWith("...")) {
      // Collect all remaining arguments into a tuple
      const restArgs = args.slice(i);
      const restValue = T.tuple(restArgs);
      if (paramPatterns && paramPatterns[i]) {
        bindPattern(paramPatterns[i], restValue, callEnv);
      } else {
        callEnv.bind(paramName.slice(3), restValue); // Remove "..." prefix
      }
    } else {
      const argVal = args[i] ?? T.undefined;
      if (paramPatterns && paramPatterns[i]) {
        bindPattern(paramPatterns[i], argVal, callEnv);
      } else {
        callEnv.bind(paramName, argVal);
      }
    }
  }

  const savedUnreachable = _unreachableRanges;
  _unreachableRanges = [];

  const memoKey = buildMemoKey(fn, args);
  if (memoKey !== null) {
    const cached = callMemo.get(memoKey);
    if (cached !== undefined) {
      _unreachableRanges = savedUnreachable;
      if (cached === MEMO_IN_PROGRESS) {
        return { value: T.unknown, throws: T.never };
      }
      return { value: cached, throws: T.never };
    }
    callMemo.set(memoKey, MEMO_IN_PROGRESS);
    const result = evaluate(fn.body, callEnv);
    _unreachableRanges = savedUnreachable;
    const value = isReturn(result) ? result.value
      : isBranch(result) ? result.returnedValue
      : isThrow(result) ? T.never
      : result;
    const throws = isThrow(result) ? result.thrown : T.never;
    const throwLoc = isThrow(result) ? result.loc : undefined;
    const wrapped = isAsync ? T.promise(value) : value;
    callMemo.set(memoKey, wrapped);
    return { value: wrapped, throws, throwLoc };
  }

  const result = evaluate(fn.body, callEnv);
  _unreachableRanges = savedUnreachable;
  if (isThrow(result)) {
    return { value: T.never, throws: result.thrown, throwLoc: result.loc };
  }
  const value = isReturn(result) ? result.value
    : isBranch(result) ? result.returnedValue
    : result;
  const wrapped = isAsync ? T.promise(value) : value;
  return { value: wrapped, throws: T.never };
}

function callFunction(
  fn: TypeValue & { kind: "function" },
  args: TypeValue[],
  thisVal?: TypeValue,
): TypeValue {
  return callFunctionFull(fn, args, thisVal).value;
}

export function evaluateFunction(
  fnNode: Node,
  args: TypeValue[],
  env: Environment,
): TypeValue {
  return evaluateFunctionFull(fnNode, args, env).value;
}

export function evaluateFunctionFull(
  fnNode: Node,
  args: TypeValue[],
  env: Environment,
): CallResult {
  // Unwrap export declarations to get the actual function
  let actualNode = fnNode;
  if (fnNode.type === "ExportNamedDeclaration" && fnNode.declaration) {
    actualNode = fnNode.declaration;
  } else if (fnNode.type === "ExportDefaultDeclaration") {
    actualNode = fnNode.declaration;
  }

  if (actualNode.type === "FunctionDeclaration" || actualNode.type === "FunctionExpression" || actualNode.type === "ArrowFunctionExpression") {
    if (_callDepth >= MAX_CALL_DEPTH) {
      return callBudgetExhausted((actualNode as any).id?.name ?? "<anonymous>", actualNode.loc);
    }
    _callDepth++;
    try {
      const callEnv = env.fork();
      const isAsync = !!(actualNode as any).async;
      for (let i = 0; i < actualNode.params.length; i++) {
        bindPattern(actualNode.params[i], args[i] ?? T.undefined, callEnv);
      }
      const result = evaluate(actualNode.body, callEnv);
      if (isThrow(result)) return { value: T.never, throws: result.thrown, throwLoc: result.loc };
      const value = isReturn(result) ? result.value
        : isBranch(result) ? result.returnedValue
        : result;
      // For async functions, unwrap Promise values to avoid double wrapping
      const wrapped = isAsync
        ? (value.kind === "promise" ? value : T.promise(value))
        : value;
      return { value: wrapped, throws: T.never };
    } finally {
      _callDepth--;
    }
  }
  return { value: T.unknown, throws: T.never };
}

export function evaluateProgram(node: Node, env: Environment): TypeValue {
  bindCommonJsGlobals(env);
  const result = evaluate(node, env);
  if (isReturn(result)) return result.value;
  if (isBranch(result)) return result.returnedValue;
  if (isThrow(result)) return T.never;
  return result;
}

export function getUnreachableRanges(): SourceRange[] {
  return _unreachableRanges;
}

export function resetUnreachableRanges(): void {
  _unreachableRanges = [];
}

export function setCurrentFileDir(dir: string): void {
  currentFileDir = dir;
}
