import type { Node } from "@babel/types";
import {
  type TypeValue,
  type Environment,
  T,
  narrowType,
  subtractType,
  getPrimitiveTypeOf,
  typeValueEquals,
  isSubtypeOf,
  createRange,
} from "@nudojs/core";

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
    const target = getTypeofTarget(test.left);
    if (target) {
      return target ? narrowByTypeof(target, test.right.value, env) : [env, env];
    }
  }

  // "string" === typeof x
  if (
    test.type === "BinaryExpression" &&
    test.operator === "===" &&
    test.left.type === "StringLiteral" &&
    isTypeofExpr(test.right)
  ) {
    const target = getTypeofTarget(test.right);
    if (target) {
      return target ? narrowByTypeof(target, test.left.value, env) : [env, env];
    }
  }

  // typeof x !== "string"
  if (
    test.type === "BinaryExpression" &&
    test.operator === "!==" &&
    isTypeofExpr(test.left) &&
    test.right.type === "StringLiteral"
  ) {
    const target = getTypeofTarget(test.left);
    if (target) {
      const [trueEnv, falseEnv] = target ? narrowByTypeof(target, test.right.value, env) : [env, env];
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
    const target = getTypeofTarget(test.right);
    if (target) {
      const [trueEnv, falseEnv] = narrowByTypeof(target, test.left.value, env);
      return [falseEnv, trueEnv];
    }
  }

  // obj.prop === literal (discriminated union)
  if (
    test.type === "BinaryExpression" &&
    test.operator === "===" &&
    test.left.type === "MemberExpression" &&
    test.left.object.type === "Identifier" &&
    test.left.property.type === "Identifier" &&
    isLiteralNode(test.right)
  ) {
    return narrowByDiscriminant(test.left.object.name, test.left.property.name, getLiteralValue(test.right), env);
  }

  // literal === obj.prop
  if (
    test.type === "BinaryExpression" &&
    test.operator === "===" &&
    isLiteralNode(test.left) &&
    test.right.type === "MemberExpression" &&
    test.right.object.type === "Identifier" &&
    test.right.property.type === "Identifier"
  ) {
    return narrowByDiscriminant(test.right.object.name, test.right.property.name, getLiteralValue(test.left), env);
  }

  // obj.prop !== literal
  if (
    test.type === "BinaryExpression" &&
    test.operator === "!==" &&
    test.left.type === "MemberExpression" &&
    test.left.object.type === "Identifier" &&
    test.left.property.type === "Identifier" &&
    isLiteralNode(test.right)
  ) {
    const [trueEnv, falseEnv] = narrowByDiscriminant(test.left.object.name, test.left.property.name, getLiteralValue(test.right), env);
    return [falseEnv, trueEnv];
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

  // x >= literal / x > literal / x <= literal / x < literal
  if (
    test.type === "BinaryExpression" &&
    (test.operator === ">=" || test.operator === ">" || test.operator === "<=" || test.operator === "<") &&
    test.left.type === "Identifier" &&
    isLiteralNode(test.right)
  ) {
    const litVal = getLiteralValue(test.right);
    if (litVal.kind === "literal" && typeof litVal.value === "number") {
      return narrowByComparison(test.left.name, test.operator, litVal.value, env);
    }
  }

  // literal >= x / literal > x / literal <= x / literal < x
  if (
    test.type === "BinaryExpression" &&
    (test.operator === ">=" || test.operator === ">" || test.operator === "<=" || test.operator === "<") &&
    isLiteralNode(test.left) &&
    test.right.type === "Identifier"
  ) {
    const litVal = getLiteralValue(test.left);
    if (litVal.kind === "literal" && typeof litVal.value === "number") {
      const flipped = { ">=": "<=", ">": "<", "<=": ">=", "<": ">" } as const;
      return narrowByComparison(test.right.name, flipped[test.operator as keyof typeof flipped], litVal.value, env);
    }
  }

  // "key" in obj
  if (
    test.type === "BinaryExpression" &&
    test.operator === "in" &&
    test.left.type === "StringLiteral" &&
    test.right.type === "Identifier"
  ) {
    return narrowByPropertyIn(test.left.value, test.right.name, env);
  }

  // Array.isArray(x)
  if (
    test.type === "CallExpression" &&
    test.callee.type === "MemberExpression" &&
    test.callee.object.type === "Identifier" &&
    test.callee.object.name === "Array" &&
    test.callee.property.type === "Identifier" &&
    test.callee.property.name === "isArray" &&
    test.arguments.length === 1 &&
    test.arguments[0].type === "Identifier"
  ) {
    return narrowByIsArray(test.arguments[0].name, env);
  }

  // !expr (negate)
  if (test.type === "UnaryExpression" && test.operator === "!") {
    const [trueEnv, falseEnv] = narrow(test.argument, env);
    return [falseEnv, trueEnv];
  }

  // Truthiness narrowing: if (x)
  if (test.type === "Identifier") {
    return narrowByTruthy(test.name, env);
  }

  return [env, env];
}

function isTypeofExpr(node: Node): boolean {
  return node.type === "UnaryExpression" && node.operator === "typeof";
}

/** typeof 目标：标识符（x）或成员访问链（ref.has / ns.fn） */
function getTypeofTarget(node: Node): { kind: "ident"; name: string } | { kind: "member"; objName: string; propName: string } | null {
  if (
    node.type === "UnaryExpression" &&
    node.operator === "typeof" &&
    node.argument.type === "Identifier"
  ) {
    return { kind: "ident", name: node.argument.name };
  }
  if (
    node.type === "UnaryExpression" &&
    node.operator === "typeof" &&
    node.argument.type === "MemberExpression" &&
    node.argument.object.type === "Identifier" &&
    !node.argument.computed &&
    node.argument.property.type === "Identifier"
  ) {
    return { kind: "member", objName: node.argument.object.name, propName: node.argument.property.name };
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

/** 内置类实例的原型方法归属（与 evaluator classMethods 表对齐的子集） */
const INSTANCE_METHOD_OWNERS: Record<string, Set<string>> = {
  has: new Set(["Set", "Map", "WeakSet", "WeakMap"]),
  get: new Set(["Map", "WeakMap"]),
  set: new Set(["Map", "WeakMap", "Set"]),
  add: new Set(["Set", "WeakSet"]),
  delete: new Set(["Set", "Map", "WeakSet", "WeakMap"]),
  clear: new Set(["Set", "Map"]),
  forEach: new Set(["Set", "Map", "Array"]),
  size: new Set(["Set", "Map"]),
  keys: new Set(["Set", "Map"]),
  values: new Set(["Set", "Map"]),
  entries: new Set(["Set", "Map"]),
  test: new Set(["RegExp"]),
  exec: new Set(["RegExp"]),
};

function narrowByTypeof(
  target: { kind: "ident"; name: string } | { kind: "member"; objName: string; propName: string },
  typeStr: string,
  env: Environment,
): [Environment, Environment] {
  // 成员目标（typeof ref.has === 'function'）：按对象成员中 prop 的类型
  // 过滤 union——留下 has 为函数的成员（如 Set），剔除 tuple/{}
  if (target.kind === "member") {
    const current = env.lookup(target.objName);
    if (!current || current.kind !== "union") return [env, env];
    const propMatches = (m: TypeValue): boolean => {
      let prop: TypeValue | undefined;
      if (m.kind === "object") prop = m.properties[target.propName];
      else if (m.kind === "instance") {
        // instance 的 properties 不含原型方法：按内置类方法表判断
        // （Set/Map 的 has 等——与 evaluator 的 classMethods 表保持一致）
        if (INSTANCE_METHOD_OWNERS[target.propName]?.has(m.className)) return true;
        prop = m.properties[target.propName];
      }
      if (typeStr === "function") return prop?.kind === "function" || prop?.kind === "unknown";
      return true;
    };
    const narrowed = narrowType(current, propMatches);
    const excluded = subtractType(current, propMatches);
    if (narrowed.kind === "never") return [env, env];
    const trueEnv = env.extend({});
    trueEnv.bind(target.objName, narrowed);
    const falseEnv = env.extend({});
    falseEnv.bind(target.objName, excluded.kind === "never" ? current : excluded);
    return [trueEnv, falseEnv];
  }

  const varName = target.name;
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

function narrowByComparison(
  varName: string,
  op: ">=" | ">" | "<=" | "<",
  value: number,
  env: Environment,
): [Environment, Environment] {
  const current = env.lookup(varName);
  if (!isSubtypeOf(current, T.number) && current.kind !== "union") return [env, env];

  const trueEnv = env.extend({});
  const falseEnv = env.extend({});

  const trueRange = op === ">=" ? createRange({ min: value })
    : op === ">" ? createRange({ min: value + 1 })
    : op === "<=" ? createRange({ max: value })
    : createRange({ max: value - 1 });

  const falseRange = op === ">=" ? createRange({ max: value - 1 })
    : op === ">" ? createRange({ max: value })
    : op === "<=" ? createRange({ min: value + 1 })
    : createRange({ min: value });

  trueEnv.bind(varName, trueRange);
  falseEnv.bind(varName, falseRange);
  return [trueEnv, falseEnv];
}

function narrowByPropertyIn(propName: string, varName: string, env: Environment): [Environment, Environment] {
  const current = env.lookup(varName);

  const narrowed = narrowType(current, (m) =>
    m.kind === "object" && propName in m.properties
  );
  const excluded = subtractType(current, (m) =>
    m.kind === "object" && propName in m.properties
  );

  const trueEnv = env.extend({});
  trueEnv.bind(varName, narrowed.kind === "never" ? current : narrowed);
  const falseEnv = env.extend({});
  falseEnv.bind(varName, excluded.kind === "never" ? current : excluded);
  return [trueEnv, falseEnv];
}

function narrowByIsArray(varName: string, env: Environment): [Environment, Environment] {
  const current = env.lookup(varName);

  const narrowed = narrowType(current, (m) => m.kind === "array" || m.kind === "tuple");
  const excluded = subtractType(current, (m) => m.kind === "array" || m.kind === "tuple");

  const trueEnv = env.extend({});
  trueEnv.bind(varName, narrowed.kind === "never" ? T.array(T.unknown) : narrowed);
  const falseEnv = env.extend({});
  falseEnv.bind(varName, excluded.kind === "never" ? current : excluded);
  return [trueEnv, falseEnv];
}

function narrowByDiscriminant(
  objName: string,
  propName: string,
  literalValue: TypeValue,
  env: Environment,
): [Environment, Environment] {
  const current = env.lookup(objName);

  const narrowed = narrowType(current, (m) => {
    if (m.kind !== "object") return false;
    const propType = m.properties[propName];
    if (!propType) return false;
    return typeValueEquals(propType, literalValue);
  });

  const excluded = subtractType(current, (m) => {
    if (m.kind !== "object") return false;
    const propType = m.properties[propName];
    if (!propType) return false;
    return typeValueEquals(propType, literalValue);
  });

  const trueEnv = env.extend({});
  trueEnv.bind(objName, narrowed.kind === "never" ? current : narrowed);
  const falseEnv = env.extend({});
  falseEnv.bind(objName, excluded.kind === "never" ? current : excluded);
  return [trueEnv, falseEnv];
}

function isFalsyType(tv: TypeValue): boolean {
  if (tv.kind === "literal") {
    return tv.value === null || tv.value === undefined || tv.value === false || tv.value === 0 || tv.value === "";
  }
  return false;
}

function narrowByTruthy(varName: string, env: Environment): [Environment, Environment] {
  const current = env.lookup(varName);

  const narrowed = narrowType(current, (m) => !isFalsyType(m));
  const excluded = subtractType(current, (m) => !isFalsyType(m));

  const trueEnv = env.extend({});
  trueEnv.bind(varName, narrowed.kind === "never" ? current : narrowed);
  const falseEnv = env.extend({});
  falseEnv.bind(varName, excluded.kind === "never" ? current : excluded);
  return [trueEnv, falseEnv];
}
