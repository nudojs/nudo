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
  typeValueToString,
  isSubtypeOf,
} from "@justscript/core";
import { narrow } from "./narrowing.ts";

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

    case "Identifier": {
      if (node.name === "undefined") return T.undefined;
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
      return T.string;
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
        applyBinaryOp(node.operator, l, r),
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
        const rv = evaluate(node.right, env);
        const rightTV = isReturn(rv) || isBranch(rv) || isThrow(rv) ? T.unknown : rv;
        return simplifyUnion([leftVal, rightTV]);
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
      const cVal = isReturn(cResult) ? cResult.value : isBranch(cResult) ? cResult.returnedValue : cResult;
      const aVal = isReturn(aResult) ? aResult.value : isBranch(aResult) ? aResult.returnedValue : aResult;
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
      const blockEnv = env.extend({});
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
        const val = evaluate(node.right, env);
        if (isReturn(val) || isBranch(val) || isThrow(val)) return val;
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
      if (node.init) {
        const initResult = evaluate(node.init, env);
        if (isReturn(initResult) || isBranch(initResult) || isThrow(initResult)) return initResult;
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
      if (node.async) (fnType as any)._async = true;
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
          if (obj.kind === "object") return obj.properties[propName] ?? T.undefined;
          if (obj.kind === "instance") return obj.properties[propName] ?? T.undefined;
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
        } else if (prop.type === "SpreadElement") {
          const spreadVal = evaluate(prop.argument, env);
          if (isReturn(spreadVal) || isBranch(spreadVal) || isThrow(spreadVal)) return spreadVal;
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
  const tryResult = evaluateStatements(node.block.body, env.extend({}));

  const thrownType = isThrow(tryResult) ? tryResult.thrown : null;

  const tryValue = isThrow(tryResult)
    ? null
    : isReturn(tryResult)
      ? tryResult
      : isBranch(tryResult)
        ? tryResult
        : tryResult;

  let catchResult: EvalResult | null = null;
  if (node.handler && thrownType) {
    const catchEnv = env.extend({});
    if (node.handler.param) {
      bindPattern(node.handler.param, thrownType, catchEnv);
    }
    catchResult = evaluateStatements(node.handler.body.body, catchEnv);
  }

  if (node.finalizer) {
    const finallyResult = evaluateStatements(node.finalizer.body, env.extend({}));
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
    const result = evaluateStatements(caseNode.consequent, env);
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
  const callEnv = fn.closure.extend({});
  const paramPatterns = (fn as any)._paramPatterns as Node[] | undefined;
  const isAsync = !!(fn as any)._async;
  for (let i = 0; i < fn.params.length; i++) {
    const argVal = args[i] ?? T.undefined;
    if (paramPatterns && paramPatterns[i]) {
      bindPattern(paramPatterns[i], argVal, callEnv);
    } else {
      callEnv.bind(fn.params[i], argVal);
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
  if (fnNode.type === "FunctionDeclaration" || fnNode.type === "FunctionExpression") {
    const callEnv = env.extend({});
    const isAsync = !!(fnNode as any).async;
    for (let i = 0; i < fnNode.params.length; i++) {
      bindPattern(fnNode.params[i], args[i] ?? T.undefined, callEnv);
    }
    const result = evaluate(fnNode.body, callEnv);
    if (isThrow(result)) return { value: T.never, throws: result.thrown, throwLoc: result.loc };
    const value = isReturn(result) ? result.value
      : isBranch(result) ? result.returnedValue
      : result;
    const wrapped = isAsync ? T.promise(value) : value;
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
