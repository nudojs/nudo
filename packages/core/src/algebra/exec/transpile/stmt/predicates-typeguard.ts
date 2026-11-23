/** typeof / in / 用户类型谓词守卫与臂 thunk。 */
import { parseSource } from "../../../parse-source.ts";
import { isStrictIllegalBinding, narrowArmShadowWrap } from "./narrow-arm.ts";
import {
  TYPEOF_NAMES,
  isStrLitNode,
  memberGuardTarget,
  nullishRemoveCallOf,
  typeofTargetOf,
  type NullishGuard,
} from "./predicates-nullish.ts";

export type TypeGuard = {
  /** 被守卫的标识符（成员目标时是基名；`in` 时是对象名） */
  name: string;
  /** typeof 结果字面量（标识符目标）。成员目标 / `in` 形态为 ""——只带
   *  typeOf 的通道（三元 / `&&` 短路臂）对基名执行 `$narrowTypeOf(name,"")`
   *  是安全 no-op（成员键 / in 键在该通道没有参数位，不能把基名本身按
   *  typeof 剪错）。 */
  typeOf: string;
  /** 该 fact 成立的臂 */
  arm: "cons" | "alt";
  /** BUG-291：成员目标键（`typeof o.v`） */
  memberKey?: string;
  /** BUG-291：成员目标的 typeof 名（memberKey 在场时由 typeNarrowCallOf 使用） */
  memberTypeOf?: string;
  /** BUG-290：`in` 守卫的成员键（`"a" in o`） */
  inKey?: string;
  /** BUG-372：`x instanceof A` 的类名（any/unknown 事实臂窄化为实例面） */
  instanceName?: string;
  /** BUG-375：`Array.isArray(x)`（事实臂剪成数组 / 补集臂剪掉数组） */
  arrayCheck?: boolean;
};

/** 用户定义类型谓词声明（BUG-282）：`function isStr(x): x is string` →
 *  { paramIndex: 0, typeOf: "string" }。只收顶层声明（模块作用域）——
 *  名字在调用点按模块绑定解析，嵌套作用域的同名谓词可能被遮蔽，保守不收。 */
type TypePredicateDecl = { paramIndex: number; typeOf: string; asserts?: boolean };

/** 当前转译单元的源码（由 statement.ts 的 transpileStatement 在每个语句
 *  入口喂入）：typeGuardOf 的签名没有 opts，用户谓词声明只能按源码查表。
 *  body-fn 单元（无 source）沿用最近一次模块转译的源码——同一文件的第一个
 *  body 编译必然发生在其模块转译之后；跨文件顺序由 statement 入口刷新。 */
let typePredicateSource: string | undefined;

/** 源码 → 谓词表。parseSource 自带缓存（剥除 AST 保留 nudoReturnTypeText）。 */
const typePredicateMemo = new Map<string, Map<string, TypePredicateDecl>>();
const TYPE_PREDICATE_MEMO_MAX = 8;
const EMPTY_TYPE_PREDICATES: ReadonlyMap<string, TypePredicateDecl> = new Map();

/** statement 入口喂入当前源码（undefined 不清空——body-fn 单元无 source）。 */
export function setTypePredicateSource(source: string | undefined): void {
  if (source) typePredicateSource = source;
}

/** 谓词目标类型文本 → typeof 名（只认 typeof 可健全表达的分类；`x is
 *  "a" | "b"` / 对象类型等保守放弃）。 */
function typeOfPredicateTarget(text: string): string | undefined {
  const t = text.trim();
  if (t === "undefined") return undefined;
  return TYPEOF_NAMES.has(t) ? t : undefined;
}

/** 谓词声明的参数索引（`x is T` 中 x 在形参表的位置）。 */
function predicateParamIndex(fn: unknown, paramName: string): number {
  const params = (fn as { params?: Array<{ type?: string; name?: string }> }).params ?? [];
  return params.findIndex((p) => p?.type === "Identifier" && p.name === paramName);
}

function addPredicateDecl(name: string, fn: unknown, map: Map<string, TypePredicateDecl>): void {
  const text = (fn as { nudoReturnTypeText?: unknown }).nudoReturnTypeText;
  if (typeof text !== "string") return;
  // BUG-380：`asserts x is T` 的声明位是 `asserts` 前缀；调用 `assertS(x)`
  // 之后的路径可以直接把 x 窄化为 T。
  const assertsMatch = /^\s*asserts\s+([A-Za-z_$][\w$]*)\s+is\s+(.+?)\s*$/.exec(text);
  const m =
    assertsMatch ?? /^\s*([A-Za-z_$][\w$]*)\s+is\s+(.+?)\s*$/.exec(text);
  if (!m) return;
  const paramName = m[1]!;
  const typeOf = typeOfPredicateTarget(m[2]!);
  if (typeOf === undefined) return;
  const paramIndex = predicateParamIndex(fn, paramName);
  if (paramIndex < 0) return;
  map.set(name, { paramIndex, typeOf, ...(assertsMatch ? { asserts: true } : {}) });
}

/** 顶层语句 → 谓词声明（FunctionDeclaration / const fn = function|arrow）。 */
function collectPredicateDecls(stmt: unknown, map: Map<string, TypePredicateDecl>): void {
  const s = stmt as { type?: string; declaration?: unknown; declarations?: unknown[] };
  if (s?.type === "ExportNamedDeclaration" || s?.type === "ExportDefaultDeclaration") {
    collectPredicateDecls(s.declaration, map);
    return;
  }
  if (s?.type === "FunctionDeclaration") {
    const n = (s as { id?: { name?: string } }).id?.name;
    if (n) addPredicateDecl(n, s, map);
    return;
  }
  if (s?.type === "VariableDeclaration") {
    for (const d of (s.declarations ?? []) as Array<{
      id?: { type?: string; name?: string };
      init?: { type?: string };
    }>) {
      const n = d.id?.type === "Identifier" ? d.id.name : undefined;
      if (!n || !d.init) continue;
      if (d.init.type === "FunctionExpression" || d.init.type === "ArrowFunctionExpression") {
        addPredicateDecl(n, d.init, map);
      }
    }
  }
}

function typePredicatesOf(source: string | undefined): ReadonlyMap<string, TypePredicateDecl> {
  if (!source) return EMPTY_TYPE_PREDICATES;
  const hit = typePredicateMemo.get(source);
  if (hit) {
    typePredicateMemo.delete(source); // LRU bump
    typePredicateMemo.set(source, hit);
    return hit;
  }
  const map = new Map<string, TypePredicateDecl>();
  try {
    const ast = parseSource(source);
    for (const stmt of ast.program.body) collectPredicateDecls(stmt, map);
  } catch {
    return EMPTY_TYPE_PREDICATES;
  }
  if (typePredicateMemo.size >= TYPE_PREDICATE_MEMO_MAX) {
    const oldest = typePredicateMemo.keys().next().value;
    if (oldest !== undefined) typePredicateMemo.delete(oldest);
  }
  typePredicateMemo.set(source, map);
  return map;
}

/** 类型谓词调用事实（BUG-282）：`isStr(x)` / `isStr(o.v)` → 谓词目标事实。
 *  只认模块顶层声明的谓词（名字解析保守）。参数位非单个标识符/成员时放弃。 */
function predicateCallGuardOf(t: {
  callee?: unknown;
  arguments?: unknown;
}): TypeGuard | undefined {
  const callee = t.callee as { type?: string; name?: string };
  if (callee?.type !== "Identifier" || !callee.name) return undefined;
  const decl = typePredicatesOf(typePredicateSource).get(callee.name);
  // asserts 签名返回 void，不是布尔测试式；语句位的窄化见
  // assertionNarrowingOf。
  if (!decl || decl.asserts === true) return undefined;
  const args = t.arguments;
  if (!Array.isArray(args)) return undefined;
  const arg = args[decl.paramIndex] as { type?: string; name?: string } | undefined;
  if (!arg) return undefined;
  const target: { name: string; key?: string } | undefined =
    arg.type === "Identifier" && arg.name
      ? { name: arg.name }
      : memberGuardTarget(arg);
  if (!target) return undefined;
  return {
    name: target.name,
    typeOf: target.key !== undefined ? "" : decl.typeOf,
    arm: "cons",
    ...(target.key !== undefined
      ? { memberKey: target.key, memberTypeOf: decl.typeOf }
      : {}),
  };
}

/**
 * BUG-380：语句位断言 `assertS(x);` 之后的窄化事实。
 *
 * `asserts x is T` 的调用表达式本身不是布尔测试式，不能走 `typeGuardOf`；
 * 调用后的路径可以把实参绑定窄化为 T。只认单层 Identifier 实参（成员 /
 * 解构实参没有可重绑的局部名）。
 */
export function assertionNarrowingOf(
  stmt: unknown,
): { name: string; typeOf: string } | undefined {
  const s = stmt as { type?: string; expression?: unknown };
  if (s?.type !== "ExpressionStatement") return undefined;
  const e = s.expression as {
    type?: string;
    callee?: { type?: string; name?: string };
    arguments?: unknown;
  };
  if (e?.type !== "CallExpression") return undefined;
  const callee = e.callee;
  if (callee?.type !== "Identifier" || !callee.name) return undefined;
  const decl = typePredicatesOf(typePredicateSource).get(callee.name);
  if (!decl?.asserts) return undefined;
  const args = e.arguments;
  if (!Array.isArray(args)) return undefined;
  const arg = args[decl.paramIndex] as { type?: string; name?: string } | undefined;
  if (arg?.type !== "Identifier" || !arg.name) return undefined;
  return { name: arg.name, typeOf: decl.typeOf };
}

/** `Array.isArray(x)` → x（BUG-375）；其他形态 / 多参 ⇒ undefined。 */
function arrayIsArrayArgOf(t: {
  callee?: unknown;
  arguments?: unknown;
}): string | undefined {
  const callee = t.callee as {
    type?: string;
    computed?: boolean;
    object?: { type?: string; name?: string };
    property?: { type?: string; name?: string };
  };
  if (callee?.type !== "MemberExpression" || callee.computed === true) return undefined;
  if (callee.object?.type !== "Identifier" || callee.object.name !== "Array") return undefined;
  if (callee.property?.type !== "Identifier" || callee.property.name !== "isArray") return undefined;
  const args = t.arguments;
  if (!Array.isArray(args) || args.length !== 1) return undefined;
  const arg = args[0] as { type?: string; name?: string };
  return arg?.type === "Identifier" && arg.name ? arg.name : undefined;
}

export function typeGuardOf(test: unknown): TypeGuard | undefined {
  const t = test as {
    type?: string;
    operator?: string;
    left?: unknown;
    right?: unknown;
    argument?: unknown;
    callee?: unknown;
    arguments?: unknown;
  };
  // `!isStr(x)` / `!(typeof o.v === "string")`：事实臂对调
  if (t?.type === "UnaryExpression" && t.operator === "!") {
    const g = typeGuardOf(t.argument);
    return g ? { ...g, arm: g.arm === "cons" ? "alt" : "cons" } : undefined;
  }
  // BUG-282：用户定义类型谓词调用
  if (t?.type === "CallExpression") {
    // BUG-375：`Array.isArray(x)` —— 内置判定没有声明位，单独识别。
    const arrayArg = arrayIsArrayArgOf(t);
    if (arrayArg !== undefined) {
      return { name: arrayArg, typeOf: "", arm: "cons", arrayCheck: true };
    }
    return predicateCallGuardOf(t);
  }
  if (t?.type !== "BinaryExpression") return undefined;
  const op = t.operator;
  // BUG-372：`x instanceof A` —— 右操作数是单层类名。
  if (op === "instanceof") {
    const left = t.left as { type?: string; name?: string };
    const right = t.right as { type?: string; name?: string };
    if (left?.type !== "Identifier" || !left.name) return undefined;
    if (right?.type !== "Identifier" || !right.name) return undefined;
    return { name: left.name, typeOf: "", arm: "cons", instanceName: right.name };
  }
  // BUG-290：`"a" in o` —— 右操作数是单层对象标识符；字面量键为字符串
  // （数值键的 `in` 收窄面罕见，保守不认）。
  if (op === "in") {
    const right = t.right as { type?: string; name?: string };
    if (right?.type !== "Identifier" || !right.name) return undefined;
    if (!isStrLitNode(t.left)) return undefined;
    return { name: right.name, typeOf: "", arm: "cons", inKey: t.left.value };
  }
  if (op !== "===" && op !== "!==" && op !== "==" && op !== "!=") return undefined;
  const lTo = typeofTargetOf(t.left);
  const rTo = typeofTargetOf(t.right);
  const litSide = lTo !== undefined ? t.right : rTo !== undefined ? t.left : null;
  const target = lTo ?? rTo;
  if (target === undefined || !isStrLitNode(litSide)) return undefined;
  if (litSide.value === "undefined" || !TYPEOF_NAMES.has(litSide.value)) return undefined;
  return {
    name: target.name,
    // 成员目标：短路径通道（只有 typeOf 参数）不得把基名按 typeof 剪错
    typeOf: target.key !== undefined ? "" : litSide.value,
    arm: op === "===" || op === "==" ? "cons" : "alt",
    ...(target.key !== undefined
      ? { memberKey: target.key, memberTypeOf: litSide.value }
      : {}),
  };
}

/**
 * BUG-011：`&&` 合取测试式里的 typeof 事实要一起进 `if` 体。
 *
 * `typeof x === "string" && true` 在语义上恒等于单守卫，但 `typeGuardOf`
 * 对 LogicalExpression 直接返回 undefined ⇒ cons 臂不窄化 ⇒ 体内读属性
 * 被判 `nudo:entry-may-throw`（合法代码假红）。短路右操作数已有单守卫
 * 通道（operators.ts），缺的是 `if` 臂的合取聚合入口。
 *
 * 只聚合 `&&` 的 cons 事实：整体为真时两侧都成立。对 `||` 保守返回空
 * （任一臂都可能为真 ⇒ 无法断定某个 typeof 事实），不制造假绿/假红。
 * 同名保留首条，与 nullishGuardsOf 的合并粒度一致。
 */
export function typeGuardsOf(test: unknown): TypeGuard[] {
  const t = test as { type?: string; operator?: string; left?: unknown; right?: unknown };
  if (t?.type === "LogicalExpression" && t.operator === "&&") {
    const out: TypeGuard[] = [];
    for (const g of [...typeGuardsOf(t.left), ...typeGuardsOf(t.right)]) {
      if (g.arm !== "cons") continue;
      if (!out.some((o) => o.name === g.name)) out.push(g);
    }
    return out;
  }
  const g = typeGuardOf(test);
  return g ? [g] : [];
}

/** nullish 守卫的臂 thunk 剪影运行时助手调用串（按粒度/成员形态分发） */

function typeNarrowCallOf(g: TypeGuard, keep: boolean): string {
  if (g.arrayCheck === true) {
    return `$narrowArray(${g.name}, ${keep})`;
  }
  if (g.instanceName !== undefined) {
    return `$narrowInstanceof(${g.name}, ${JSON.stringify(g.instanceName)}, ${keep})`;
  }
  if (g.inKey !== undefined) {
    return `$narrowIn(${g.name}, ${JSON.stringify(g.inKey)}, ${keep})`;
  }
  if (g.memberKey !== undefined) {
    const t = g.memberTypeOf ?? g.typeOf;
    return `$narrowTypeOf(${g.name}, ${JSON.stringify(t)}, ${keep}, ${JSON.stringify(g.memberKey)})`;
  }
  return `$narrowTypeOf(${g.name}, ${JSON.stringify(g.typeOf)}, ${keep})`;
}

/** typeof 类型守卫臂 thunk 的剪影包装：`((v) => THUNK)($narrowTypeOf(v, T, keep))`。
 *  事实臂（arm）保留匹配成员，对侧臂绑补集；守卫名在 fork 绑定集时跳过
 *  （与 nullish 剪影同规则）。 */
/**
 * typeof 通道的多名版本：narrowArmShadowWrap 的 "multi" 模式本就为
 * 「全部事实同层生效」设计，合取守卫必须一次性传入，逐条嵌套会让
 * 同名/异名影子重绑的 fork 绑定裁决不一致。
 */
export function narrowTypeArmThunks(
  thunk: string,
  guards: readonly TypeGuard[],
  arm: "cons" | "alt",
  forkBindingNames: ReadonlySet<string> | readonly string[],
): string {
  if (guards.length === 0) return thunk;
  return narrowArmShadowWrap(
    thunk,
    guards.map((g) => ({
      name: g.name,
      arg: typeNarrowCallOf(g, arm === g.arm),
    })),
    forkBindingNames,
    "multi",
  );
}

export function narrowTypeArmThunk(thunk: string, guard: TypeGuard | undefined, arm: "cons" | "alt", forkBindingNames: ReadonlySet<string> | readonly string[]): string {
  if (!guard) return thunk;
  const keep = arm === guard.arm;
  return narrowArmShadowWrap(
    thunk,
    [{
      name: guard.name,
      arg: typeNarrowCallOf(guard, keep),
    }],
    forkBindingNames,
    "multi",
  );
}

/**
 * BUG-335：`if (guard) <写被守卫绑定>` 缺 else 时，隐式 else 臂（fall-through）
 * 必须把**取反的守卫事实**应用到 join 基线。
 *
 * fork 协议在测试求值后快照被写绑定，缺 else 时隐式臂是常量
 * `() => $lit(void 0)` ⇒ 臂尾 `__fk2_<name> = name` 捕获的仍是测试前快照
 * （`string | undefined`）⇒ join 回来 `"x" | (string | undefined)` ⇒ 合法
 * `a.length` 记假 TypeError。这里在隐式臂入口把**在 fork 绑定集里**的
 * 守卫名按取反事实重绑（`a = $removeUndefined(a)` / `o = $removeMemberNullish(...)`）
 * ——臂尾捕获到窄化值，join 得到 `string`。
 *
 * 只处理 fork 绑定集里的名字（join 保护）：不在集里的绑定若在此重绑，会
 * 在「cons 臂正常完成」的路径上泄漏一个只在 fall-through 成立的窄化值。
 * `arguments` / `eval` 等 strict 非法绑定名跳过（与影子重绑同口径）。
 */
export function narrowImplicitElseArmThunk(
  thunk: string,
  guards: readonly NullishGuard[],
  typeGuards: readonly TypeGuard[],
  forkBindingNames: ReadonlySet<string> | readonly string[],
): string {
  const names =
    forkBindingNames instanceof Set ? (forkBindingNames as Set<string>) : new Set(forkBindingNames);
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const g of guards) {
    if (g.arm !== "alt" || !names.has(g.name) || seen.has(g.name)) continue;
    if (isStrictIllegalBinding(g.name)) continue;
    seen.add(g.name);
    lines.push(`${g.name} = ${nullishRemoveCallOf(g)};`);
  }
  for (const g of typeGuards) {
    // 隐式 else = 测试为假：guard.arm === "alt" 的事实成立（keep=true），
    // cons 事实取补集（keep=false）——与 narrowTypeArmThunk(arm="alt") 同口径。
    if (!names.has(g.name) || seen.has(g.name)) continue;
    if (isStrictIllegalBinding(g.name)) continue;
    seen.add(g.name);
    lines.push(`${g.name} = ${typeNarrowCallOf(g, g.arm === "alt")};`);
  }
  if (lines.length === 0) return thunk;
  return `() => { ${lines.join(" ")} return (${thunk})(); }`;
}

// --- 判别等值守卫（issue #126） ---------------------------------------------

/**
 * 判别等值守卫（issue #126）：`x.key === 'lit'`（或 `!==` 对偶，字面量在
 * 左对称）——判别事实「x.key === value」成立的臂（`===` → cons、`!==` →
 * alt）内 x 以 $narrowMemberEq 影子重绑为「key 值域可能等于 value」的
 * union 成员子集，kind-specific 字段的 index 读（`node.quasis[0]`）不再
 * 撞其他臂的 undefined 记假 may-throw。只认严格等价（`===`/`!==`——宽松
 * `==` 有强制转换面）与非计算键单层成员（memberGuardTarget 同形态）；
 * nullish 字面量归 nullishGuardOf 通道，此处只认 string/number/boolean。
 */
