// Builtin call & method-call semantics for the TypeValue evaluator:
// global builtin invocations (String/Number/parseInt/fetch/...), method
// dispatch on member expressions (console/Math/Date/JSON/Array/Promise/
// Symbol/Reflect statics, per-class instance tables, Function.prototype
// call/apply/bind), string methods (literal folding + abstract fallback),
// Object statics (keys/values/entries), and array/tuple methods with
// callback propagation (map/filter/reduce/forEach via callFunction).
//
// 与 evaluator.ts 互递归：方法/内建分发会重入 "../evaluator.ts" 的
// evaluate/evaluateArgs/callFunction——两侧均为函数声明（ESM 链接期初始化），
// 环形 import 在运行时安全。
import type { Node } from "@babel/types";
import {
  type TypeValue,
  type Environment,
  T,
  simplifyUnion,
  dispatchMethod,
  typeValueEquals,
} from "@nudojs/core";
import { tagParamArg } from "../term-registry.ts";
import {
  evaluatePromiseStaticMethod,
  evaluatePromiseInstanceMethod,
} from "./builtin-promise.ts";
import { MAP_INSTANCE_METHODS } from "./builtin-map.ts";
import { SET_INSTANCE_METHODS } from "./builtin-set.ts";
import { REGEXP_INSTANCE_METHODS } from "./builtin-regexp.ts";
import { URL_INSTANCE_METHODS, URLSearchParams_INSTANCE_METHODS } from "./builtin-url.ts";
import {
  RESPONSE_INSTANCE_METHODS,
  HEADERS_INSTANCE_METHODS,
  FORMDATA_INSTANCE_METHODS,
  ABORTCONTROLLER_INSTANCE_METHODS,
  createResponseType,
} from "./builtin-web.ts";
import { WEAKMAP_INSTANCE_METHODS, WEAKSET_INSTANCE_METHODS } from "./builtin-weak.ts";
import { REFLECT_METHODS } from "./builtin-reflect.ts";
import { INTL_DATETIMEFORMAT_METHODS, INTL_NUMBERFORMAT_METHODS } from "./builtin-intl.ts";
import { BUILTIN_STATIC_METHODS } from "./builtin-static.ts";
import {
  type EvalResult,
  evaluate,
  evaluateArgs,
  isReturn,
  isBranch,
  isThrow,
  makeThrow,
  RETURN_SIGNAL,
  BRANCH_SIGNAL,
  THROW_SIGNAL,
  recordUnknown,
  distributeOverUnion,
  callFunction,
  callFunctionFull,
  arrayIsArrayLiteral,
  copyOrigin,
  applyPromiseThenCallback,
} from "../evaluator.ts";

export function evaluateBuiltinCall(
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
): EvalResult | null {
  if (methodName === "bind") return fnVal;
  if (methodName === "call") {
    const full = callFunctionFull(fnVal, argVals.slice(1), argVals[0]);
    // A definitely-throwing callee (e.g. `null.valueOf` binding) must raise
    // a ThrowSignal, not degrade to never — enclosing try/catch depends on it.
    if (full.value.kind === "never" && full.throws.kind !== "never") {
      return makeThrow(full.throws, full.throwLoc);
    }
    return full.value;
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
    const full = callFunctionFull(fnVal, spreadArgs, argVals[0]);
    if (full.value.kind === "never" && full.throws.kind !== "never") {
      return makeThrow(full.throws, full.throwLoc);
    }
    return full.value;
  }
  return null;
}

function evaluateMethodForMember(
  objVal: TypeValue,
  methodName: string,
  argVals: TypeValue[],
  callee: Node & { type: "MemberExpression" },
  env: Environment,
): EvalResult | null {
  // Function.prototype.call/apply/bind on function-valued union members
  if (objVal.kind === "function") {
    const fnProto = evaluateFunctionPrototypeMethod(objVal, methodName, argVals);
    if (fnProto !== null) return fnProto;
  }

  // Promise instance methods
  if (objVal.kind === "promise") {
    if (methodName === "then") {
      const chained = applyPromiseThenCallback(objVal, argVals);
      if (chained !== null) return chained;
    }
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

  // Array/tuple methods（union 分布路径）：与主路径共用 evaluateArrayMethodValues
  // ——实参在此已是 TypeValue，回调类 map/filter/reduce 等同样从函数值签名
  // 求值（mock 箭头 / 具名函数 / 内联箭头一致），不再保守降级 unknown。
  if (objVal.kind === "array" || objVal.kind === "tuple") {
    return evaluateArrayMethodValues(objVal, methodName, argVals);
  }

  // String methods
  if (isStringLike(objVal)) {
    return evaluateStringMethod(objVal, methodName, argVals);
  }

  return null;
}

export function evaluateMethodCall(
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
      // A throwing member contributes no value; return/branch signals
      // contribute their carried value (the potential throw is dropped
      // here; the single-callee path raises it properly).
      if (memberResult !== null && typeof memberResult === "object") {
        if (THROW_SIGNAL in memberResult) return T.never;
        if (RETURN_SIGNAL in memberResult) return memberResult.value;
        if (BRANCH_SIGNAL in memberResult) return memberResult.returnedValue;
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
    // JSON.parse: the table entry is a fnSig whose impl decodes literal
    // string arguments precisely (jsonToTypeValue); non-literal / invalid /
    // reviver-bearing calls fall back to its unknown return type.
    if (methodName === "parse") {
      return callFunction(
        (BUILTIN_STATIC_METHODS.JSON as Record<string, TypeValue>).parse as TypeValue & {
          kind: "function";
        },
        argVals as TypeValue[],
      );
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
      // Structurally-known receivers decide literally (arrays/tuples →
      // true, plain objects/instances-of-other-classes → false); unknown
      // receivers keep the symbolic boolean.
      return distributeOverUnion((argVals as TypeValue[])[0] ?? T.undefined, (v) => {
        const lit = arrayIsArrayLiteral(v);
        return lit === undefined ? T.boolean : T.literal(lit);
      });
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
    if (methodName === "then") {
      const chained = applyPromiseThenCallback(objVal, argVals as TypeValue[]);
      if (chained !== null) return chained;
    }
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

  // Number receivers: toString/valueOf exist on every JS number. Without
  // this, deepEqual-style `obj.toString()` comparators reaching a numeric
  // union member record a false no-method error.
  if (isNumberLike(objVal)) {
    const argVals = evaluateArgs(args, env);
    if (isReturn(argVals) || isBranch(argVals) || isThrow(argVals)) return argVals;
    if (methodName === "toString") {
      return objVal.kind === "literal" && typeof objVal.value === "number"
        ? T.literal(String(objVal.value))
        : T.string;
    }
    if (methodName === "valueOf") {
      return objVal.kind === "literal" && typeof objVal.value === "number"
        ? objVal
        : T.number;
    }
    if (methodName === "toFixed" || methodName === "toPrecision") return T.string;
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

function isNumberLike(tv: TypeValue): boolean {
  if (tv.kind === "literal" && typeof tv.value === "number") return true;
  if (tv.kind === "primitive" && tv.type === "number") return true;
  if (tv.kind === "refined") return isNumberLike(tv.base);
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
    // String.prototype.toString/valueOf return the receiver string itself
    case "toString":
    case "valueOf": return T.literal(str);
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
    case "toString":
    case "valueOf":
      return T.string;
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
  // Shape-aware receivers list their declared own-property names:
  // instances carry their properties record (usually empty for fresh
  // collections), tuples their indices. Key loops (`for (const key of
  // Object.keys(x))`) then iterate concrete keys instead of symbolic
  // strings.
  if (obj.kind === "instance") {
    if (method === "keys" || method === "getOwnPropertyNames") {
      return T.tuple(Object.keys(obj.properties).map((k) => T.literal(k)));
    }
    if (method === "values") return T.tuple(Object.values(obj.properties));
    if (method === "entries") {
      return T.tuple(
        Object.keys(obj.properties).map((k) => T.tuple([T.literal(k), obj.properties[k]])),
      );
    }
    return null;
  }
  if (obj.kind === "union") {
    // union 分发：逐成员 keys/values/entries。成员多时逐成员 tuple 的
    // union 会超预算——keys 恒为 string[]（sound 下界），values/entries
    // 同理回退宽类型而非 unknown（hoek utils.keys 的 30+ 成员 union 曾
    // 在无分支路径上退化）。
    const per = obj.members.map((m) => evaluateObjectStaticMethod(method, m));
    if (method === "keys" || method === "getOwnPropertyNames") {
      const literals: TypeValue[] = [];
      for (const r of per) {
        if (r?.kind === "tuple") literals.push(...r.elements);
        else return T.array(T.string);
      }
      if (literals.length > 64) return T.array(T.string);
      return T.tuple(literals);
    }
    if (method === "values") {
      const vals = per.filter((r) => r && r.kind !== "unknown").flatMap((r) => (r!.kind === "tuple" ? r.elements : [r!]));
      if (per.some((r) => !r || r.kind === "unknown") || vals.length > 64) return T.array(T.unknown);
      return T.tuple(vals);
    }
    if (method === "entries") {
      return T.array(T.tuple([T.string, T.unknown]));
    }
    return null;
  }
  if (obj.kind === "tuple") {
    if (method === "keys" || method === "getOwnPropertyNames") {
      return T.tuple(obj.elements.map((_, i) => T.literal(String(i))));
    }
    if (method === "values") return T.tuple([...obj.elements]);
    if (method === "entries") {
      return T.tuple(obj.elements.map((el, i) => T.tuple([T.literal(String(i)), el])));
    }
    return null;
  }
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
  if (method === "getOwnPropertyNames") {
    return T.tuple(keys.map((k) => T.literal(k)));
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
  return evaluateArrayMethodValues(arr, method, argVals as TypeValue[]);
}

/** Array/tuple 方法求值主体：实参已经是 TypeValue（AST 路径与 union 分布
 *  路径共用）。回调类方法（map/filter/reduce/...）拿到 kind "function" 的
 *  实参时经 callFunction 从其签名/闭包求值——mock 箭头、具名函数与内联
 *  箭头在此走同一机制。 */
function evaluateArrayMethodValues(
  arr: TypeValue & { kind: "array" | "tuple" },
  method: string,
  argVals: TypeValue[],
): EvalResult | null {
  const callbackFn = argVals[0];

  if (method === "push") {
    if (arr.kind === "tuple") {
      arr.elements.push(...argVals);
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
      return T.literal(arr.elements.length + argVals.length);
    }
    return T.number;
  }

  if (method === "indexOf" || method === "lastIndexOf") {
    return T.number;
  }

  if (method === "includes") {
    if (arr.kind === "tuple" && argVals[0]?.kind === "literal") {
      const searchVal = argVals[0];
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
      for (const a of argVals) {
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
      const start = argVals[0];
      const end = argVals[1];
      const startIdx = start?.kind === "literal" && typeof start.value === "number" ? start.value : 0;
      const endIdx = end?.kind === "literal" && typeof end.value === "number" ? end.value : arr.elements.length;
      return T.tuple(arr.elements.slice(startIdx, endIdx));
    }
    return T.array(arr.element);
  }

  // 回调实参是「函数 union」（cond ? f : g 透传给 HOF）：对每个成员签名
  // 分别求值再 union 结果——与非函数守卫（unknown 回调）不同，这里每个
  // 成员都有完整的 TypeValue 信息，不该整体降级。
  if (callbackFn && callbackFn.kind === "union" && callbackFn.members.length > 0 &&
      callbackFn.members.every((m) => m.kind === "function")) {
    return distributeOverUnion(callbackFn, (member) => {
      const r = evaluateArrayMethodValues(arr, method, [member, ...argVals.slice(1)]);
      return r === null ? T.unknown : (r as TypeValue);
    });
  }

  if (!callbackFn || callbackFn.kind !== "function") {
    if (method === "map") return arr.kind === "tuple" ? T.tuple(arr.elements.map(() => T.unknown)) : T.array(T.unknown);
    if (method === "filter") return arr.kind === "tuple" ? T.array(simplifyUnion(arr.elements)) : arr;
    if (method === "find") return arr.kind === "tuple" ? simplifyUnion([...arr.elements, T.undefined]) : simplifyUnion([arr.element, T.undefined]);
    if (method === "some" || method === "every") return T.boolean;
    if (method === "reduce") return argVals[1] ?? T.unknown;
    if (method === "forEach") return T.undefined;
    if (method === "flatMap") return T.array(T.unknown);
    return null;
  }

  const fn = callbackFn as TypeValue & { kind: "function" };

  // HOF：给回调元素挂 term 身份，使 Φ 中的约束可传播到 map/reduce 体
  const tagEl = (el: TypeValue, name: string): TypeValue => {
    const tagged = tagParamArg(el, name);
    copyOrigin(el, tagged);
    return tagged;
  };

  if (method === "map") {
    if (arr.kind === "tuple") {
      const mapped = arr.elements.map((el, i) =>
        callFunction(fn, [tagEl(el, fn.params[0] ?? "item"), T.literal(i), arr]),
      );
      return T.tuple(mapped);
    }
    return T.array(
      callFunction(fn, [tagEl(arr.element, fn.params[0] ?? "item"), T.number, arr]),
    );
  }

  if (method === "filter") {
    if (arr.kind === "tuple") {
      const kept: TypeValue[] = [];
      for (let i = 0; i < arr.elements.length; i++) {
        const result = callFunction(fn, [
          tagEl(arr.elements[i]!, fn.params[0] ?? "item"),
          T.literal(i),
          arr,
        ]);
        if (result.kind === "literal" && !result.value) continue;
        kept.push(arr.elements[i]!);
      }
      if (kept.length === 0) return T.tuple([]);
      return T.array(simplifyUnion(kept));
    }
    return T.array(arr.element);
  }

  if (method === "reduce") {
    const init = argVals[1];
    if (arr.kind === "tuple") {
      let acc = init ?? arr.elements[0] ?? T.unknown;
      const startIdx = init ? 0 : 1;
      for (let i = startIdx; i < arr.elements.length; i++) {
        acc = callFunction(fn, [
          acc,
          tagEl(arr.elements[i]!, fn.params[1] ?? "item"),
          T.literal(i),
          arr,
        ]);
      }
      return acc;
    }
    // 抽象数组：不动点迭代（代数纪律）。unknown 不 join 进 acc。
    const acc0 = init ?? arr.element;
    let acc = acc0;
    for (let i = 0; i < 6; i++) {
      const next = callFunction(fn, [
        acc,
        tagEl(arr.element, fn.params[1] ?? "item"),
        T.number,
        arr,
      ]);
      if (typeValueEquals(acc, next)) return next;
      if (next.kind === "unknown") return acc;
      acc = simplifyUnion([acc, next]);
    }
    return acc;
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
