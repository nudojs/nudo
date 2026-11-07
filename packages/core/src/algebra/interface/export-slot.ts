/**
 * 导出槽解析（Bug 489 / 995）：本地普查名 → 模块导出槽。
 *
 * ESM / CJS 语义里，**导出槽**（export name）与源码里的**本地名**不是一回事：
 *
 * - `export default function f() { … }` —— 本地名 `f`，但模块的导出面只有
 *   `default` 槽（ESM 语义：默认导出只挂在 `default` 槽上）。按本地名查
 *   导出表 ⇒ 落空 ⇒ 签名退成 `unknown` + 一条指向错误的 `nudo:opaque-result`
 *   （Bug 489）。
 * - `module.exports = { greet: fn }` —— 导出面是 `module.exports` 这个**对象**
 *   （CJS 语义），成员 `greet` 挂在对象上，不是顶层槽。按本地名查导出表 ⇒
 *   落空 ⇒ 函数在 check 面完全不可见（Bug 995）。
 *
 * 本模块只做**解析**（本地名 → 该怎么调）：不碰求值引擎，不改导出表形状
 * （导出表是产品面契约：dts / schema / emit 都按它渲染）。
 *
 * 口径与 service 面的普查一致（`packages/service/src/analyzer-ast.ts` 的
 * `assignedName`：普查名 = 本地名，导出槽 = default / 对象成员键）。
 */

import type { File } from "@babel/types";

/** AST 产物（`parseSource` / `@babel/parser` 两种产物同形——都带 program.body） */
type AstFileLike = { program: { body: readonly unknown[] } };

/** 一个导出槽的调用形态 */
export type ExportSlotCall =
  /** 顶层具名导出：`evalRun[key]` */
  | { kind: "named"; key: string }
  /** default 槽（具名 default 导出）：`evalRun["default"]` */
  | { kind: "default"; key: "default" }
  /** CJS 对象字面量成员：`$invoke(evalRun["default"], member, args)` */
  | { kind: "cjs-member"; key: "default"; member: string };

type NodeLike = Record<string, unknown> & { type?: string };

const identName = (n: unknown): string | undefined => {
  if (!n || typeof n !== "object") return undefined;
  const node = n as NodeLike;
  if (node.type === "Identifier" && typeof node.name === "string") return node.name;
  if (
    (node.type === "StringLiteral" || node.type === "Literal") &&
    typeof node.value === "string"
  ) {
    return node.value;
  }
  return undefined;
};

/** 对象成员键（`{ f: … }` → "f"；`{ 1: … }` → "1"；计算键 → undefined） */
const memberKeyName = (member: NodeLike): string | undefined => {
  const key = member.key as NodeLike | undefined;
  if (!key) return undefined;
  if (key.type === "Identifier" && typeof key.name === "string") return key.name;
  if (
    (key.type === "StringLiteral" || key.type === "NumericLiteral") &&
    (typeof key.value === "string" || typeof key.value === "number")
  ) {
    return String(key.value);
  }
  return undefined;
};

/** `module.exports` / `exports` 赋值目标 → true */
const isExportsTarget = (left: NodeLike | undefined): boolean => {
  if (!left) return false;
  if (left.type === "Identifier") return left.name === "exports";
  if (left.type === "MemberExpression") {
    const obj = left.object as NodeLike | undefined;
    return identName(obj) === "module" && identName(left.property as NodeLike) === "exports";
  }
  return false;
};

/**
 * 本地名 → 导出槽（不含顶层具名导出——那由调用方先查导出表）。
 *
 * - `defaultLocalNameOf(file)`：具名 default 导出的本地名
 *   （`export default function f` / `export default f`）；
 * - `cjsMemberSlotsOf(file)`：CJS 对象字面量导出（`module.exports = { … }`）
 *   的「普查名 → 成员键」表。
 */
function defaultLocalNameOf(file: AstFileLike): string | undefined {
  for (const stmt of file.program.body as NodeLike[]) {
    if (stmt.type !== "ExportDefaultDeclaration") continue;
    const d = stmt.declaration as NodeLike | undefined;
    if (!d) continue;
    if (d.type === "FunctionDeclaration" || d.type === "ClassDeclaration") {
      const id = identName(d.id);
      if (id) return id;
      continue;
    }
    if (d.type === "Identifier") {
      const n = identName(d);
      if (n) return n;
    }
  }
  return undefined;
}

/**
 * CJS 对象字面量导出：`module.exports = { … }` / `exports = { … }`。
 *
 * 返回「普查名 → 导出槽（成员键）」表。**普查名口径 = 成员键**——与
 * `listTopFunctions` 的 CJS 分支**同源**（`scan-top-functions.ts`：
 * `pushFnFromInit(keyName, …)` ⇒ `fallbackName ?? r.id?.name` ⇒ 成员键优先）。
 *
 * ⚠ **不得**用具名函数表达式的内层 id（`fnId ?? key`）：内层 id 不是导出槽名
 * （`{ greet: function inner() {} }` 的导出槽是 `greet`）⇒ 普查名 `greet` 在表里
 * 查不到 ⇒ 侧车契约整个不绑定（L1 闸门**假绿**）+ 签名退成 `unknown`；且内层 id
 * 会与别的成员键**碰撞**（`{ a: function b(){}, b: () => … }` ⇒ 映射串成
 * `b -> a`）。成员键是导出面的唯一口径 ⇒ 映射**只用成员键**（Bug 1128）。
 */
function cjsMemberSlotsOf(file: AstFileLike): Map<string, string> {
  const out = new Map<string, string>();
  for (const stmt of file.program.body as NodeLike[]) {
    if (stmt.type !== "ExpressionStatement") continue;
    const expr = stmt.expression as NodeLike | undefined;
    if (!expr || expr.type !== "AssignmentExpression" || expr.operator !== "=") continue;
    if (!isExportsTarget(expr.left as NodeLike | undefined)) continue;
    const right = expr.right as NodeLike | undefined;
    if (!right || right.type !== "ObjectExpression") continue;
    for (const member of (right.properties as NodeLike[] | undefined) ?? []) {
      if (member.type !== "ObjectProperty" && member.type !== "Property" && member.type !== "ObjectMethod") {
        continue;
      }
      const key = memberKeyName(member);
      if (!key) continue;
      // 普查名 = **成员键**（对象方法 / 属性 / 具名函数表达式一律同口径）
      if (!out.has(key)) out.set(key, key);
    }
  }
  return out;
}

/**
 * 本地名 → 导出槽调用形态。
 *
 * 顺序（先精确后兜底，兜底不得吃掉精确命中）：
 * 1. 顶层具名导出命中 → `named`（既有行为，不变）；
 * 2. 本地名是具名 default 导出的本地名 → `default`（Bug 489）；
 * 3. 本地名是 CJS 对象字面量导出的成员 → `cjs-member`（Bug 995）。
 *
 * @param file 被分析文件的 AST（同一棵 parse 产物）
 * @param fnName 本地普查名（函数名 / 成员名）
 * @param evalRun B run 的导出表（键 = 导出槽名）
 */
export function resolveExportSlotCall(
  file: AstFileLike,
  fnName: string,
  evalRun: Record<string, unknown>,
): ExportSlotCall | undefined {
  if (Object.hasOwn(evalRun, fnName)) return { kind: "named", key: fnName };
  // 具名 default 导出：本地名 ≠ 导出槽名 ⇒ 回退 default 槽
  if (defaultLocalNameOf(file) === fnName && Object.hasOwn(evalRun, "default")) {
    return { kind: "default", key: "default" };
  }
  // CJS 对象字面量导出：成员挂在 default 槽（module.exports）这个对象上
  const member = cjsMemberSlotsOf(file).get(fnName);
  if (member !== undefined && Object.hasOwn(evalRun, "default")) {
    return { kind: "cjs-member", key: "default", member };
  }
  return undefined;
}
