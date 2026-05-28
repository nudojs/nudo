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
} from "@nudojs/core";
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
const BUILTIN_STATIC_METHODS: Record<string, Record<string, TypeValue>> = {
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

type SourceRange = { start: { line: number; column: number }; end: { line: number; column: number } };

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

function buildMemoKey(fn: TypeValue & { kind: "function" }, args: TypeValue[]): string | null {
  const fnName = (fn as any)._memoize as string | undefined;
  if (!fnName) return null;
  const argsKey = args.map(typeValueToString).join(",");
  return `${fnName}(${argsKey})`;
}

const moduleCache = new Map<string, Environment>();

export function resetMemo(): void {
  callMemo.clear();
  moduleCache.clear();
}

export function setModuleResolver(resolver: ((source: string, fromDir: string) => { ast: Node; filePath: string } | null) | null): void {
  currentModuleResolver = resolver;
}

let currentModuleResolver: ((source: string, fromDir: string) => { ast: Node; filePath: string } | null) | null = null;
let currentFileDir = "";

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
    const result = evaluate(stmt, currentEnv);

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
      // Check for built-in global objects
      if (node.name in BUILTIN_STATIC_METHODS) {
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
      // Check if it looks like a built-in but isn't covered
      if (node.name[0] === node.name[0].toUpperCase() && !env.has(node.name)) {
        if (_onUnknownBuiltin) {
          _onUnknownBuiltin(node.name, node.loc as any);
        }
      }
      return env.lookup(node.name);
    }

    case "ThisExpression":
      return env.lookup("this");

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
      const arg = node.argument;
      if (!arg) return makeReturn(T.undefined);
      const val = evaluate(arg, env);
      if (isReturn(val) || isBranch(val) || isThrow(val)) return val;
      return makeReturn(val);
    }

    case "VariableDeclaration": {
      for (const decl of node.declarations) {
        const init = decl.init ? evaluate(decl.init, env) : T.undefined;
        if (isReturn(init) || isBranch(init) || isThrow(init)) return init;
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
        return val;
      }
      if (node.left.type === "MemberExpression") {
        const val = evaluate(node.right, env);
        if (isReturn(val) || isBranch(val) || isThrow(val)) return val;
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

      // Handle built-in global functions (only if not overridden in environment, e.g., by mocks)
      if (callee.type === "Identifier" && !env.has(callee.name)) {
        const builtinResult = evaluateBuiltinCall(callee.name, node.arguments as Node[], env);
        if (builtinResult !== null) return builtinResult;
      }

      const calleeVal = evaluate(callee, env);
      if (isReturn(calleeVal) || isBranch(calleeVal) || isThrow(calleeVal)) return calleeVal;

      const argVals = evaluateArgs(node.arguments as Node[], env);
      if (isReturn(argVals) || isBranch(argVals) || isThrow(argVals)) return argVals;

      if (calleeVal.kind === "function") {
        const full = callFunctionFull(calleeVal, argVals as TypeValue[]);
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
        return callFunction(fn, argVals as TypeValue[]);
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

      if (calleeVal.kind === "function") {
        const full = callFunctionFull(calleeVal, argVals as TypeValue[]);
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
        return callFunction(fn, argVals as TypeValue[]);
      });
    }

    case "MemberExpression": {
      const objVal = evaluate(node.object, env);
      if (isReturn(objVal) || isBranch(objVal) || isThrow(objVal)) return objVal;

      if (node.computed) {
        const propVal = evaluate(node.property, env);
        if (isReturn(propVal) || isBranch(propVal) || isThrow(propVal)) return propVal;
        return distributeOverUnion(objVal, (obj) => {
          if (obj.kind === "object" && propVal.kind === "literal" && typeof propVal.value === "string") {
            return obj.properties[propVal.value] ?? T.undefined;
          }
          if ((obj.kind === "array" || obj.kind === "tuple") && propVal.kind === "literal" && typeof propVal.value === "number") {
            if (obj.kind === "tuple") return obj.elements[propVal.value] ?? T.undefined;
            return obj.element;
          }
          return T.unknown;
        });
      }

      if (node.property.type === "Identifier") {
        const propName = node.property.name;
        return distributeOverUnion(objVal, (obj) => {
          // Check for built-in static methods (e.g., Date.now, Math.floor)
          const builtinName = (obj as any)._builtinName as string | undefined;
          if (builtinName && BUILTIN_STATIC_METHODS[builtinName]) {
            const builtin = BUILTIN_STATIC_METHODS[builtinName];
            if (typeof builtin === "object" && propName in builtin) {
              return (builtin as Record<string, TypeValue>)[propName];
            }
          }
          // Check for Map.size property
          if (obj.kind === "instance" && obj.className === "Map" && propName === "size") {
            return T.number;
          }
          // Check for Set.size property
          if (obj.kind === "instance" && obj.className === "Set" && propName === "size") {
            return T.number;
          }
          if (obj.kind === "object") return obj.properties[propName] ?? T.undefined;
          if (obj.kind === "instance") return obj.properties[propName] ?? T.undefined;
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
          return T.unknown;
        });
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

      // Otherwise, evaluate like a normal member expression
      if (node.computed) {
        const propVal = evaluate(node.property, env);
        if (isReturn(propVal) || isBranch(propVal) || isThrow(propVal)) return propVal;
        return distributeOverUnion(objVal, (obj) => {
          if (obj.kind === "object" && propVal.kind === "literal" && typeof propVal.value === "string") {
            return obj.properties[propVal.value] ?? T.undefined;
          }
          if ((obj.kind === "array" || obj.kind === "tuple") && propVal.kind === "literal" && typeof propVal.value === "number") {
            if (obj.kind === "tuple") return obj.elements[propVal.value] ?? T.undefined;
            return obj.element;
          }
          return T.unknown;
        });
      }

      if (node.property.type === "Identifier") {
        const propName = node.property.name;
        return distributeOverUnion(objVal, (obj) => {
          if (obj.kind === "object") return obj.properties[propName] ?? T.undefined;
          if (obj.kind === "instance") return obj.properties[propName] ?? T.undefined;
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
          return T.unknown;
        });
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
      const propVal = value.kind === "object"
        ? (value.properties[key] ?? T.undefined)
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

function evaluateMethodForMember(
  objVal: TypeValue,
  methodName: string,
  argVals: TypeValue[],
  callee: Node & { type: "MemberExpression" },
  env: Environment,
): TypeValue | null {
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

  // Array/tuple methods - need to pass original AST nodes
  // Not handled here; fall through to the main evaluateMethodCall which has access to AST nodes

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
    return distributeOverUnion(objVal, (member) => {
      // Create a temporary env with the member bound, then re-evaluate the method call
      const memberResult = evaluateMethodForMember(member, methodName, argVals as TypeValue[], callee, env);
      return memberResult ?? T.unknown;
    });
  }

  // Handle console methods (no return value)
  if (callee.object.type === "Identifier" && callee.object.name === "console") {
    const argVals = evaluateArgs(args, env);
    if (isReturn(argVals) || isBranch(argVals) || isThrow(argVals)) return argVals;
    return T.undefined;
  }

  // Handle Math methods
  if (callee.object.type === "Identifier" && callee.object.name === "Math") {
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
  if (callee.object.type === "Identifier" && callee.object.name === "Date") {
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
  if (callee.object.type === "Identifier" && callee.object.name === "JSON") {
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
  if (callee.object.type === "Identifier" && callee.object.name === "Array") {
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
  if (callee.object.type === "Identifier" && callee.object.name === "Promise") {
    const argVals = evaluateArgs(args, env);
    if (isReturn(argVals) || isBranch(argVals) || isThrow(argVals)) return argVals;
    const result = evaluatePromiseStaticMethod(methodName, argVals as TypeValue[]);
    if (result !== null) return result;
    return T.unknown;
  }

  // Handle Symbol methods
  if (callee.object.type === "Identifier" && callee.object.name === "Symbol") {
    const argVals = evaluateArgs(args, env);
    if (isReturn(argVals) || isBranch(argVals) || isThrow(argVals)) return argVals;
    if (methodName === "for") return T.symbol;
    if (methodName === "keyFor") return T.union(T.string, T.undefined);
    return T.unknown;
  }

  // Handle Reflect methods
  if (callee.object.type === "Identifier" && callee.object.name === "Reflect") {
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
    args.length >= 1
  ) {
    const argVal = evaluate(args[0], env);
    if (isReturn(argVal) || isBranch(argVal) || isThrow(argVal)) return argVal;
    return evaluateObjectStaticMethod(methodName, argVal);
  }

  if (objVal.kind === "array" || objVal.kind === "tuple") {
    return evaluateArrayMethod(objVal, methodName, args, env);
  }

  if (isStringLike(objVal)) {
    const argVals = evaluateArgs(args, env);
    if (isReturn(argVals) || isBranch(argVals) || isThrow(argVals)) return argVals;

    if (objVal.kind === "refined") {
      const refined = dispatchMethod(objVal, methodName, argVals as TypeValue[]);
      if (refined !== undefined) return refined;
    }

    return evaluateStringMethod(objVal, methodName, argVals as TypeValue[]);
  }

  if (objVal.kind === "refined") {
    const argVals = evaluateArgs(args, env);
    if (isReturn(argVals) || isBranch(argVals) || isThrow(argVals)) return argVals;
    const result = dispatchMethod(objVal, methodName, argVals as TypeValue[]);
    if (result !== undefined) return result;
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

function evaluateImportDeclaration(node: Node & { type: "ImportDeclaration" }, env: Environment): EvalResult {
  const source = node.source.value;
  if (!currentModuleResolver) return T.undefined;

  const resolved = currentModuleResolver(source, currentFileDir);
  if (!resolved) return T.undefined;

  let moduleEnv = moduleCache.get(resolved.filePath);
  if (!moduleEnv) {
    moduleEnv = createEnvironment();
    moduleCache.set(resolved.filePath, moduleEnv);
    const savedDir = currentFileDir;
    currentFileDir = resolved.filePath.replace(/\/[^/]+$/, "");
    evaluateProgram(resolved.ast, moduleEnv);
    currentFileDir = savedDir;
  }

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

const BUILTIN_ERROR_CLASSES = new Set([
  "Error", "TypeError", "SyntaxError", "RangeError", "ReferenceError", "URIError", "EvalError",
]);

function evaluateNewExpression(node: Node & { type: "NewExpression" }, env: Environment): EvalResult {
  const callee = node.callee as Node;
  if (callee.type === "Identifier" && BUILTIN_ERROR_CLASSES.has(callee.name)) {
    const argVals = evaluateArgs(node.arguments as Node[], env);
    if (isReturn(argVals) || isBranch(argVals) || isThrow(argVals)) return argVals;
    const msgVal = (argVals as TypeValue[])[0] ?? T.undefined;
    return T.instanceOf(callee.name, { message: msgVal });
  }

  // Handle new Map()
  if (callee.type === "Identifier" && callee.name === "Map") {
    const argVals = evaluateArgs(node.arguments as Node[], env);
    if (isReturn(argVals) || isBranch(argVals) || isThrow(argVals)) return argVals;
    return createMapType(argVals as TypeValue[]);
  }

  // Handle new Set()
  if (callee.type === "Identifier" && callee.name === "Set") {
    const argVals = evaluateArgs(node.arguments as Node[], env);
    if (isReturn(argVals) || isBranch(argVals) || isThrow(argVals)) return argVals;
    return createSetType(argVals as TypeValue[]);
  }

  // Handle new RegExp()
  if (callee.type === "Identifier" && callee.name === "RegExp") {
    return createRegExpType();
  }

  // Handle new URL()
  if (callee.type === "Identifier" && callee.name === "URL") {
    return createURLType();
  }

  // Handle new URLSearchParams()
  if (callee.type === "Identifier" && callee.name === "URLSearchParams") {
    return createURLSearchParamsType();
  }

  // Handle new Response()
  if (callee.type === "Identifier" && callee.name === "Response") {
    return createResponseType();
  }

  // Handle new Headers()
  if (callee.type === "Identifier" && callee.name === "Headers") {
    return createHeadersType();
  }

  // Handle new FormData()
  if (callee.type === "Identifier" && callee.name === "FormData") {
    return createFormDataType();
  }

  // Handle new AbortController()
  if (callee.type === "Identifier" && callee.name === "AbortController") {
    return createAbortControllerType();
  }

  // Handle new WeakMap()
  if (callee.type === "Identifier" && callee.name === "WeakMap") {
    return createWeakMapType();
  }

  // Handle new WeakSet()
  if (callee.type === "Identifier" && callee.name === "WeakSet") {
    return createWeakSetType();
  }

  // Handle new Intl.DateTimeFormat() and new Intl.NumberFormat()
  if (callee.type === "MemberExpression" && !callee.computed) {
    const obj = callee.object as Node;
    const prop = callee.property as Node;
    if (obj.type === "Identifier" && obj.name === "Intl" && prop.type === "Identifier") {
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

function callFunctionFull(fn: TypeValue & { kind: "function" }, args: TypeValue[]): CallResult {
  // Check for direct return value (used by sinon mocks)
  const directReturn = (fn as any)._directReturn as TypeValue | undefined;
  if (directReturn) {
    return { value: directReturn, throws: T.never };
  }

  const callEnv = fn.closure.extend({});
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

function callFunction(fn: TypeValue & { kind: "function" }, args: TypeValue[]): TypeValue {
  return callFunctionFull(fn, args).value;
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

  if (actualNode.type === "FunctionDeclaration" || actualNode.type === "FunctionExpression") {
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
  }
  return { value: T.unknown, throws: T.never };
}

export function evaluateProgram(node: Node, env: Environment): TypeValue {
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
