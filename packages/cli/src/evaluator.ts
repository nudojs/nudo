import type { Node } from "@babel/types";
import {
  type TypeValue,
  T,
  simplifyUnion,
  applyBinaryOp,
  Ops,
  type Environment,
  createEnvironment,
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
        if (decl.id.type === "Identifier") {
          const init = decl.init ? evaluate(decl.init, env) : T.undefined;
          if (isReturn(init) || isBranch(init)) return init;
          env.bind(decl.id.name, init);
        }
      }
      return T.undefined;
    }

    case "AssignmentExpression": {
      if (node.left.type === "Identifier") {
        const val = evaluate(node.right, env);
        if (isReturn(val) || isBranch(val)) return val;
        env.bind(node.left.name, val);
        return val;
      }
      if (node.left.type === "MemberExpression") {
        const val = evaluate(node.right, env);
        if (isReturn(val) || isBranch(val)) return val;
        return val;
      }
      return T.unknown;
    }

    case "FunctionDeclaration": {
      if (!node.id) return T.undefined;
      const paramNames = node.params.map((p) =>
        p.type === "Identifier" ? p.name : "_",
      );
      const fnType = T.fn(paramNames, node.body, env);
      env.bind(node.id.name, fnType);
      return T.undefined;
    }

    case "FunctionExpression":
    case "ArrowFunctionExpression": {
      const paramNames = node.params.map((p) =>
        p.type === "Identifier" ? p.name : "_",
      );
      const body = node.body;
      return T.fn(paramNames, body, env);
    }

    case "CallExpression": {
      const calleeVal = evaluate(node.callee as Node, env);
      if (isReturn(calleeVal) || isBranch(calleeVal)) return calleeVal;

      const argVals: TypeValue[] = [];
      for (const arg of node.arguments) {
        const v = evaluate(arg as Node, env);
        if (isReturn(v) || isBranch(v)) return v;
        argVals.push(v);
      }

      return distributeOverUnion(calleeVal, (fn) => {
        if (fn.kind !== "function") return T.unknown;
        return callFunction(fn, argVals);
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
          const key =
            prop.key.type === "Identifier"
              ? prop.key.name
              : prop.key.type === "StringLiteral"
                ? prop.key.value
                : null;
          if (key) {
            const val = evaluate(prop.value as Node, env);
            if (isReturn(val) || isBranch(val)) return val;
            props[key] = val;
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
          env.bind(node.argument.name, newVal);
          return node.prefix ? newVal : current;
        }
        env.bind(node.argument.name, T.number);
        return T.number;
      }
      return T.number;
    }

    default:
      return T.unknown;
  }
}

function callFunction(fn: TypeValue & { kind: "function" }, args: TypeValue[]): TypeValue {
  const callEnv = fn.closure.extend({});
  for (let i = 0; i < fn.params.length; i++) {
    callEnv.bind(fn.params[i], args[i] ?? T.undefined);
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
    const paramNames = fnNode.params.map((p) =>
      p.type === "Identifier" ? p.name : "_",
    );
    const callEnv = env.extend({});
    for (let i = 0; i < paramNames.length; i++) {
      callEnv.bind(paramNames[i], args[i] ?? T.undefined);
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
