import type { Node } from "@babel/types";
import {
  type TypeValue,
  type Environment,
  T,
  narrowType,
  subtractType,
  getPrimitiveTypeOf,
  typeValueEquals,
} from "@nudo/core";

/**
 * Given a test expression and the current environment, produce two
 * environments: one where the test is truthy, one where it is falsy.
 */
export function narrow(
  test: Node,
  env: Environment,
): [trueEnv: Environment, falseEnv: Environment] {
  // typeof x === "string"
  if (
    test.type === "BinaryExpression" &&
    test.operator === "===" &&
    isTypeofExpr(test.left) &&
    test.right.type === "StringLiteral"
  ) {
    const varName = getTypeofTarget(test.left);
    if (varName) {
      return narrowByTypeof(varName, test.right.value, env);
    }
  }

  // "string" === typeof x
  if (
    test.type === "BinaryExpression" &&
    test.operator === "===" &&
    test.left.type === "StringLiteral" &&
    isTypeofExpr(test.right)
  ) {
    const varName = getTypeofTarget(test.right);
    if (varName) {
      return narrowByTypeof(varName, test.left.value, env);
    }
  }

  // typeof x !== "string"
  if (
    test.type === "BinaryExpression" &&
    test.operator === "!==" &&
    isTypeofExpr(test.left) &&
    test.right.type === "StringLiteral"
  ) {
    const varName = getTypeofTarget(test.left);
    if (varName) {
      const [trueEnv, falseEnv] = narrowByTypeof(varName, test.right.value, env);
      return [falseEnv, trueEnv];
    }
  }

  // "string" !== typeof x
  if (
    test.type === "BinaryExpression" &&
    test.operator === "!==" &&
    test.left.type === "StringLiteral" &&
    isTypeofExpr(test.right)
  ) {
    const varName = getTypeofTarget(test.right);
    if (varName) {
      const [trueEnv, falseEnv] = narrowByTypeof(varName, test.left.value, env);
      return [falseEnv, trueEnv];
    }
  }

  // x === literal
  if (
    test.type === "BinaryExpression" &&
    test.operator === "===" &&
    test.left.type === "Identifier" &&
    isLiteralNode(test.right)
  ) {
    return narrowByStrictEqual(test.left.name, getLiteralValue(test.right), env);
  }

  // literal === x
  if (
    test.type === "BinaryExpression" &&
    test.operator === "===" &&
    isLiteralNode(test.left) &&
    test.right.type === "Identifier"
  ) {
    return narrowByStrictEqual(test.right.name, getLiteralValue(test.left), env);
  }

  // x !== literal
  if (
    test.type === "BinaryExpression" &&
    test.operator === "!==" &&
    test.left.type === "Identifier" &&
    isLiteralNode(test.right)
  ) {
    const [trueEnv, falseEnv] = narrowByStrictEqual(test.left.name, getLiteralValue(test.right), env);
    return [falseEnv, trueEnv];
  }

  // literal !== x
  if (
    test.type === "BinaryExpression" &&
    test.operator === "!==" &&
    isLiteralNode(test.left) &&
    test.right.type === "Identifier"
  ) {
    const [trueEnv, falseEnv] = narrowByStrictEqual(test.right.name, getLiteralValue(test.left), env);
    return [falseEnv, trueEnv];
  }

  // x instanceof C
  if (
    test.type === "BinaryExpression" &&
    test.operator === "instanceof" &&
    test.left.type === "Identifier" &&
    test.right.type === "Identifier"
  ) {
    return narrowByInstanceof(test.left.name, test.right.name, env);
  }

  // !expr (negate)
  if (test.type === "UnaryExpression" && test.operator === "!") {
    const [trueEnv, falseEnv] = narrow(test.argument, env);
    return [falseEnv, trueEnv];
  }

  return [env, env];
}

function isTypeofExpr(node: Node): boolean {
  return node.type === "UnaryExpression" && node.operator === "typeof";
}

function getTypeofTarget(node: Node): string | null {
  if (
    node.type === "UnaryExpression" &&
    node.operator === "typeof" &&
    node.argument.type === "Identifier"
  ) {
    return node.argument.name;
  }
  return null;
}

function isLiteralNode(node: Node): boolean {
  return (
    node.type === "NumericLiteral" ||
    node.type === "StringLiteral" ||
    node.type === "BooleanLiteral" ||
    node.type === "NullLiteral" ||
    (node.type === "Identifier" && node.name === "undefined")
  );
}

function getLiteralValue(node: Node): TypeValue {
  if (node.type === "NumericLiteral") return T.literal(node.value);
  if (node.type === "StringLiteral") return T.literal(node.value);
  if (node.type === "BooleanLiteral") return T.literal(node.value);
  if (node.type === "NullLiteral") return T.null;
  if (node.type === "Identifier" && node.name === "undefined") return T.undefined;
  return T.unknown;
}

const typeofToPrimitive: Record<string, TypeValue> = {
  number: T.number,
  string: T.string,
  boolean: T.boolean,
  bigint: T.bigint,
  symbol: T.symbol,
};

function narrowByTypeof(
  varName: string,
  typeStr: string,
  env: Environment,
): [Environment, Environment] {
  const current = env.lookup(varName);
  const targetPrimitive = typeofToPrimitive[typeStr];

  const matchesPrimitive = (m: TypeValue): boolean => {
    const pt = getPrimitiveTypeOf(m);
    return pt === typeStr;
  };

  if (targetPrimitive) {
    const narrowed = narrowType(current, matchesPrimitive);
    const excluded = subtractType(current, matchesPrimitive);

    const trueEnv = env.extend({});
    trueEnv.bind(varName, narrowed.kind === "never" ? targetPrimitive : narrowed);
    const falseEnv = env.extend({});
    falseEnv.bind(varName, excluded.kind === "never" ? current : excluded);
    return [trueEnv, falseEnv];
  }

  if (typeStr === "object") {
    const narrowed = narrowType(current, (m) => {
      const pt = getPrimitiveTypeOf(m);
      return pt === "object";
    });
    const excluded = subtractType(current, (m) => {
      const pt = getPrimitiveTypeOf(m);
      return pt === "object";
    });
    const trueEnv = env.extend({});
    trueEnv.bind(varName, narrowed.kind === "never" ? current : narrowed);
    const falseEnv = env.extend({});
    falseEnv.bind(varName, excluded.kind === "never" ? current : excluded);
    return [trueEnv, falseEnv];
  }

  if (typeStr === "function") {
    const narrowed = narrowType(current, (m) => m.kind === "function");
    const excluded = subtractType(current, (m) => m.kind === "function");
    const trueEnv = env.extend({});
    trueEnv.bind(varName, narrowed.kind === "never" ? current : narrowed);
    const falseEnv = env.extend({});
    falseEnv.bind(varName, excluded.kind === "never" ? current : excluded);
    return [trueEnv, falseEnv];
  }

  return [env, env];
}

function narrowByInstanceof(
  varName: string,
  className: string,
  env: Environment,
): [Environment, Environment] {
  const current = env.lookup(varName);

  const narrowed = narrowType(current, (m) =>
    m.kind === "instance" && m.className === className,
  );
  const excluded = subtractType(current, (m) =>
    m.kind === "instance" && m.className === className,
  );

  const trueEnv = env.extend({});
  trueEnv.bind(varName, narrowed.kind === "never" ? T.instanceOf(className) : narrowed);
  const falseEnv = env.extend({});
  falseEnv.bind(varName, excluded.kind === "never" ? current : excluded);
  return [trueEnv, falseEnv];
}

function narrowByStrictEqual(
  varName: string,
  literalTV: TypeValue,
  env: Environment,
): [Environment, Environment] {
  const current = env.lookup(varName);

  const narrowed = narrowType(current, (m) => typeValueEquals(m, literalTV));
  const excluded = subtractType(current, (m) => typeValueEquals(m, literalTV));

  const trueEnv = env.extend({});
  trueEnv.bind(varName, narrowed.kind === "never" ? literalTV : narrowed);
  const falseEnv = env.extend({});
  falseEnv.bind(varName, excluded.kind === "never" ? current : excluded);
  return [trueEnv, falseEnv];
}
