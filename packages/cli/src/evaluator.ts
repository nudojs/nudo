import type { Node } from "@babel/types";
import {
  type TypeValue,
  T,
  simplifyUnion,
  applyBinaryOp,
  Ops,
  type Environment,
  createEnvironment,
  deepCloneTypeValue,
  mergeObjectProperties,
  typeValueEquals,
} from "@justscript/core";
import { narrow } from "./narrowing.ts";

const RETURN_SIGNAL = Symbol("ReturnSignal");
const BRANCH_SIGNAL = Symbol("BranchSignal");

type ReturnSignal = {
  readonly [RETURN_SIGNAL]: true;
  readonly value: TypeValue;
};

type BranchSignal = {
  readonly [BRANCH_SIGNAL]: true;
  readonly returnedValue: TypeValue;
  readonly fallthroughEnv: Environment;
};

function makeReturn(value: TypeValue): ReturnSignal {
  return { [RETURN_SIGNAL]: true, value };
}

function makeBranch(returnedValue: TypeValue, fallthroughEnv: Environment): BranchSignal {
  return { [BRANCH_SIGNAL]: true, returnedValue, fallthroughEnv };
}

function isReturn(v: unknown): v is ReturnSignal {
  return typeof v === "object" && v !== null && RETURN_SIGNAL in v;
}

function isBranch(v: unknown): v is BranchSignal {
  return typeof v === "object" && v !== null && BRANCH_SIGNAL in v;
}

type EvalResult = TypeValue | ReturnSignal | BranchSignal;

function distributeOverUnion(
  tv: TypeValue,
  fn: (member: TypeValue) => TypeValue,
): TypeValue {
  if (tv.kind === "union") {
    return simplifyUnion(tv.members.map(fn));
  }
  return fn(tv);
}

function distributeBinaryOverUnion(
  left: TypeValue,
  right: TypeValue,
  fn: (l: TypeValue, r: TypeValue) => TypeValue,
): TypeValue {
  if (left.kind === "union" && right.kind === "union") {
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

function evaluateStatements(
  stmts: readonly Node[],
  env: Environment,
): EvalResult {
  const returnValues: TypeValue[] = [];
  let currentEnv = env;
  let lastValue: TypeValue = T.undefined;

  for (const stmt of stmts) {
    const result = evaluate(stmt, currentEnv);

    if (isReturn(result)) {
      returnValues.push(result.value);
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

export function evaluate(node: Node, env: Environment): EvalResult {
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

    case "Identifier": {
      if (node.name === "undefined") return T.undefined;
      return env.lookup(node.name);
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
          if (isReturn(exprVal) || isBranch(exprVal)) return exprVal;
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
      return T.string;
    }

    case "BinaryExpression": {
      const leftVal = evaluate(node.left, env);
      if (isReturn(leftVal) || isBranch(leftVal)) return leftVal;
      const rightVal = evaluate(node.right, env);
      if (isReturn(rightVal) || isBranch(rightVal)) return rightVal;
      return distributeBinaryOverUnion(leftVal, rightVal, (l, r) =>
        applyBinaryOp(node.operator, l, r),
      );
    }

    case "UnaryExpression": {
      const argVal = evaluate(node.argument, env);
      if (isReturn(argVal) || isBranch(argVal)) return argVal;
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
      if (isReturn(leftVal) || isBranch(leftVal)) return leftVal;

      if (node.operator === "&&") {
        if (leftVal.kind === "literal" && !leftVal.value) return leftVal;
        if (leftVal.kind === "literal" && leftVal.value) {
          const rv = evaluate(node.right, env);
          return isReturn(rv) || isBranch(rv) ? rv : rv;
        }
        const rv = evaluate(node.right, env);
        const rightTV = isReturn(rv) || isBranch(rv) ? T.unknown : rv;
        return simplifyUnion([leftVal, rightTV]);
      }

      if (node.operator === "||") {
        if (leftVal.kind === "literal" && leftVal.value) return leftVal;
        if (leftVal.kind === "literal" && !leftVal.value) {
          const rv = evaluate(node.right, env);
          return isReturn(rv) || isBranch(rv) ? rv : rv;
        }
        const rv = evaluate(node.right, env);
        const rightTV = isReturn(rv) || isBranch(rv) ? T.unknown : rv;
        return simplifyUnion([leftVal, rightTV]);
      }

      if (node.operator === "??") {
        if (leftVal.kind === "literal" && leftVal.value !== null && leftVal.value !== undefined) {
          return leftVal;
        }
        if (leftVal.kind === "literal" && (leftVal.value === null || leftVal.value === undefined)) {
          const rv = evaluate(node.right, env);
          return isReturn(rv) || isBranch(rv) ? rv : rv;
        }
        const rv = evaluate(node.right, env);
        const rightTV = isReturn(rv) || isBranch(rv) ? T.unknown : rv;
        return simplifyUnion([leftVal, rightTV]);
      }

      return T.unknown;
    }

    case "ConditionalExpression": {
      const test = node.test;
      const [trueEnv, falseEnv] = narrow(test, env);
      const testVal = evaluate(test, env);
      if (isReturn(testVal) || isBranch(testVal)) return testVal;

      if (testVal.kind === "literal") {
        return testVal.value
          ? evaluate(node.consequent, trueEnv)
          : evaluate(node.alternate, falseEnv);
      }

      const cResult = evaluate(node.consequent, trueEnv);
      const aResult = evaluate(node.alternate, falseEnv);
      const cVal = isReturn(cResult) ? cResult.value : isBranch(cResult) ? cResult.returnedValue : cResult;
      const aVal = isReturn(aResult) ? aResult.value : isBranch(aResult) ? aResult.returnedValue : aResult;
      return simplifyUnion([cVal, aVal]);
    }

    case "IfStatement": {
      const test = node.test;
      const [trueEnv, falseEnv] = narrow(test, env);
      const testVal = evaluate(test, env);
      if (isReturn(testVal) || isBranch(testVal)) return testVal;

      if (testVal.kind === "literal") {
        if (testVal.value) {
          return evaluate(node.consequent, trueEnv);
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
      const aReturns = alternateResult !== null && isReturn(alternateResult);
      const aBranches = alternateResult !== null && isBranch(alternateResult);

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
      const blockEnv = env.extend({});
      const result = evaluateStatements(node.body, blockEnv);
      return result;
    }

    case "ReturnStatement": {
      const arg = node.argument;
      if (!arg) return makeReturn(T.undefined);
      const val = evaluate(arg, env);
      if (isReturn(val)) return val;
      if (isBranch(val)) return val;
      return makeReturn(val);
    }

    case "VariableDeclaration": {
      for (const decl of node.declarations) {
        const init = decl.init ? evaluate(decl.init, env) : T.undefined;
        if (isReturn(init) || isBranch(init)) return init;
        bindPattern(decl.id, init, env);
      }
      return T.undefined;
    }

    case "AssignmentExpression": {
      if (node.left.type === "Identifier") {
        const val = evaluate(node.right, env);
        if (isReturn(val) || isBranch(val)) return val;
        if (!env.update(node.left.name, val)) {
          env.bind(node.left.name, val);
        }
        return val;
      }
      if (node.left.type === "MemberExpression") {
        const val = evaluate(node.right, env);
        if (isReturn(val) || isBranch(val)) return val;
        const objVal = evaluate(node.left.object, env);
        if (isReturn(objVal) || isBranch(objVal)) return val;
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
        if (isReturn(val) || isBranch(val)) return val;
        bindPattern(node.left, val, env);
        return val;
      }
      return T.unknown;
    }

    case "ForOfStatement": {
      const rightVal = evaluate(node.right, env);
      if (isReturn(rightVal) || isBranch(rightVal)) return rightVal;
      return evaluateForOf(node, rightVal, env);
    }

    case "ForInStatement": {
      const rightVal = evaluate(node.right, env);
      if (isReturn(rightVal) || isBranch(rightVal)) return rightVal;
      return evaluateForIn(node, rightVal, env);
    }

    case "ForStatement": {
      if (node.init) {
        const initResult = evaluate(node.init, env);
        if (isReturn(initResult) || isBranch(initResult)) return initResult;
      }
      return T.undefined;
    }

    case "WhileStatement":
      return T.undefined;

    case "FunctionDeclaration": {
      if (!node.id) return T.undefined;
      const paramNames = node.params.map((p) =>
        p.type === "Identifier" ? p.name : `_p${Math.random().toString(36).slice(2, 6)}`,
      );
      const fnType = T.fn(paramNames, node.body, env);
      (fnType as any)._paramPatterns = node.params;
      env.bind(node.id.name, fnType);
      return T.undefined;
    }

    case "FunctionExpression":
    case "ArrowFunctionExpression": {
      const paramNames = node.params.map((p) =>
        p.type === "Identifier" ? p.name : `_p${Math.random().toString(36).slice(2, 6)}`,
      );
      const body = node.body;
      const fnType = T.fn(paramNames, body, env);
      (fnType as any)._paramPatterns = node.params;
      return fnType;
    }

    case "CallExpression": {
      const callee = node.callee as Node;

      if (callee.type === "MemberExpression") {
        const methodResult = evaluateMethodCall(callee, node.arguments as Node[], env);
        if (methodResult !== null) return methodResult;
      }

      const calleeVal = evaluate(callee, env);
      if (isReturn(calleeVal) || isBranch(calleeVal)) return calleeVal;

      const argVals = evaluateArgs(node.arguments as Node[], env);
      if (isReturn(argVals) || isBranch(argVals)) return argVals;

      return distributeOverUnion(calleeVal, (fn) => {
        if (fn.kind !== "function") return T.unknown;
        return callFunction(fn, argVals as TypeValue[]);
      });
    }

    case "MemberExpression": {
      const objVal = evaluate(node.object, env);
      if (isReturn(objVal) || isBranch(objVal)) return objVal;

      if (node.computed) {
        const propVal = evaluate(node.property, env);
        if (isReturn(propVal) || isBranch(propVal)) return propVal;
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
          if (propName === "length" && (obj.kind === "array" || obj.kind === "tuple")) {
            return obj.kind === "tuple" ? T.literal(obj.elements.length) : T.number;
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
                return !isReturn(kv) && !isBranch(kv) && kv.kind === "literal" && typeof kv.value === "string"
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
            if (isReturn(val) || isBranch(val)) return val;
            props[key] = val;
          }
        } else if (prop.type === "SpreadElement") {
          const spreadVal = evaluate(prop.argument, env);
          if (isReturn(spreadVal) || isBranch(spreadVal)) return spreadVal;
          if (spreadVal.kind === "object") {
            Object.assign(props, spreadVal.properties);
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
          if (isReturn(spreadVal) || isBranch(spreadVal)) return spreadVal;
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
        if (isReturn(val) || isBranch(val)) return val;
        elements.push(val);
      }
      return T.tuple(elements);
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
    if (!isReturn(propVal) && !isBranch(propVal) && propVal.kind === "literal") {
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

  if (pattern.type === "AssignmentPattern") {
    const defaultVal = evaluate(pattern.right, env);
    const resolved = (value.kind === "literal" && value.value === undefined)
      ? (!isReturn(defaultVal) && !isBranch(defaultVal) ? defaultVal : T.unknown)
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

function evaluateArgs(args: Node[], env: Environment): TypeValue[] | ReturnSignal | BranchSignal {
  const result: TypeValue[] = [];
  for (const arg of args) {
    if (arg.type === "SpreadElement") {
      const spreadVal = evaluate(arg.argument, env);
      if (isReturn(spreadVal) || isBranch(spreadVal)) return spreadVal;
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
    if (isReturn(v) || isBranch(v)) return v;
    result.push(v);
  }
  return result;
}

function evaluateMethodCall(
  callee: Node & { type: "MemberExpression" },
  args: Node[],
  env: Environment,
): EvalResult | null {
  const objVal = evaluate(callee.object, env);
  if (isReturn(objVal) || isBranch(objVal)) return objVal;

  const methodName = !callee.computed && callee.property.type === "Identifier"
    ? callee.property.name
    : null;
  if (!methodName) return null;

  if (
    callee.object.type === "Identifier" &&
    callee.object.name === "Object" &&
    args.length >= 1
  ) {
    const argVal = evaluate(args[0], env);
    if (isReturn(argVal) || isBranch(argVal)) return argVal;
    return evaluateObjectStaticMethod(methodName, argVal);
  }

  if (objVal.kind === "array" || objVal.kind === "tuple") {
    return evaluateArrayMethod(objVal, methodName, args, env);
  }

  return null;
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
  if (isReturn(argVals) || isBranch(argVals)) return argVals;

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
    const acc = init ?? arr.element;
    return callFunction(fn, [acc, arr.element, T.number, arr]);
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
    const loopEnv = env.extend({});
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

  const loopEnv = env.extend({});
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

function callFunction(fn: TypeValue & { kind: "function" }, args: TypeValue[]): TypeValue {
  const callEnv = fn.closure.extend({});
  const paramPatterns = (fn as any)._paramPatterns as Node[] | undefined;
  for (let i = 0; i < fn.params.length; i++) {
    const argVal = args[i] ?? T.undefined;
    if (paramPatterns && paramPatterns[i]) {
      bindPattern(paramPatterns[i], argVal, callEnv);
    } else {
      callEnv.bind(fn.params[i], argVal);
    }
  }
  const result = evaluate(fn.body, callEnv);
  if (isReturn(result)) return result.value;
  if (isBranch(result)) return result.returnedValue;
  return result;
}

export function evaluateFunction(
  fnNode: Node,
  args: TypeValue[],
  env: Environment,
): TypeValue {
  if (fnNode.type === "FunctionDeclaration" || fnNode.type === "FunctionExpression") {
    const callEnv = env.extend({});
    for (let i = 0; i < fnNode.params.length; i++) {
      bindPattern(fnNode.params[i], args[i] ?? T.undefined, callEnv);
    }
    const result = evaluate(fnNode.body, callEnv);
    if (isReturn(result)) return result.value;
    if (isBranch(result)) return result.returnedValue;
    return result;
  }
  return T.unknown;
}

export function evaluateProgram(node: Node, env: Environment): TypeValue {
  const result = evaluate(node, env);
  if (isReturn(result)) return result.value;
  if (isBranch(result)) return result.returnedValue;
  return result;
}
