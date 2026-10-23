/**
 * 指称：Abs → 运行时谓词（设计 §2.7）。
 * - 无 pred：按 shape 检查（typeof / 结构）
 * - 有 pred：在 `term ↦ v` 下检查可判定的数值比较
 * - sum：任一成员
 */

import type { Abs } from "./abs.ts";
import type { Pred } from "./pred.ts";
import { termEquals, type LiteralValue, type Term } from "./term.ts";
import { safeMemberAccess } from "./codegen-escape.ts";
import { ProjectionBudget } from "./projection-budget.ts";
import { accessorReadDomain } from "./accessors.ts";
import { canonicalArrayIndex } from "./objects.ts";
import { SELF } from "./constraint.ts";

/**
 * Bug 240（S21）：**guard 面剔除 internal 槽**（内部槽对属性 introspection
 * 不可见，不是自有属性）。
 *
 * 与投影面（`format.ts` 的 `isHiddenInternalSlot`）**同口径**：`Slot.internal`
 * 为 true 且键**不是**规范数组下标 ⇒ 该槽不进 guard 产物。
 *
 * 不剔会产出**恒假条款**：生成器对象的协议槽（`next` / `return` / `throw` /
 * `constructor` / `@@iterator`）是 internal 槽——原生挂在原型上、不是自有
 * 属性。`@@iterator` 尤其致命：它是 **symbol 键**槽（`Symbol.iterator`），
 * guard 面却按**字符串键** `"@@iterator"` 取值 ⇒ 原生恒 `undefined` ⇒
 * `typeof data["@@iterator"] === "function"` **恒假** ⇒ 恒假条款污染 guard
 * 产物（`service/src/emit/guard-generator.ts` 直接消费本函数）。
 *
 * 例外：**规范数组下标槽**保留——族 01 的建模口径里生成器的数字下标槽承载
 * **元素域**（`format.ts` 同例外，`eval-spread-iter-elems` 钉住 `"0": string`），
 * 不是内部实现细节 ⇒ 不在此剔除。
 */
function isHiddenInternalSlot(k: string, slot: { internal?: boolean }): boolean {
  return slot.internal === true && canonicalArrayIndex(k) === undefined;
}

/** Abs 上的运行时守卫表达式（JS boolean 布尔串） */
export function denoteGuard(a: Abs, v: string): string {
  return denoteGuardB(a, v, new ProjectionBudget());
}

function denoteGuardB(a: Abs, v: string, budget: ProjectionBudget): string {
  // DESIGN-001：环 / 超深 shape 截断。与 denotePred 的不可判定同口径——
  // true 保守不撒谎；`/* nudo:truncated */` 注释让截断在生成源码里可观测。
  const stop = budget.enter(a);
  if (stop) return `/* nudo:truncated:${stop} */ true`;
  try {
    // 字面量：等值已蕴含 typeof，短路。litValue 哨兵对 lit(undefined) 也是
    // undefined，必须直接看 term（同 format.ts / leq.ts）。
    if (a.term?.op === "lit" && (!a.pred || a.pred.op === "true")) {
      return eqGuard(v, a.term.value);
    }
    const shape = denoteShape(a, v, budget);
    const pred = denotePred(a, v);
    if (shape === "true") return pred;
    if (pred === "true") return shape;
    return `(${shape}) && (${pred})`;
  } finally {
    budget.exit();
  }
}

/** shape 守卫（按 Abs 递归：obj 槽需按对象身份查访问器侧表，Bug 191） */
function denoteShape(a: Abs, v: string, budget: ProjectionBudget): string {
  const s = a.shape;
  switch (s.k) {
    case "never":
      return "false";
    case "unknown":
    case "any":
      return "true";
    case "prim":
      switch (s.type) {
        case "number":
          return `typeof ${v} === "number"`;
        case "string":
          return `typeof ${v} === "string"`;
        case "boolean":
          return `typeof ${v} === "boolean"`;
        case "bigint":
          return `typeof ${v} === "bigint"`;
        case "symbol":
          return `typeof ${v} === "symbol"`;
        default:
          return "true";
      }
    case "obj": {
      // Bug 409 / 410：对象判定必须**排除数组**——`typeof v === "object"` 对
      // 数组同样成立 ⇒ 数组被当普通对象放行（假绿）。standard 面显式排除
      // 数组（"expected object, got array"），zod 的 `z.object()` 同口径。
      const checks = [`typeof ${v} === "object"`, `${v} !== null`, `!Array.isArray(${v})`];
      for (const [key, slot] of Object.entries(s.slots)) {
        // Bug 240（S21）：internal 槽不进 guard 面（内部槽不是自有属性）——
        // 规范数组下标槽除外（承载元素域，族 01 口径）。
        if (isHiddenInternalSlot(key, slot)) continue;
        const access = safeMemberAccess(v, key);
        // Bug 191：访问器键的槽是 `$lit(void 0)` 占位——守卫须按 getter 读域
        // 判定（原生读 `data.ab` 走 getter），否则对函数自己的返回值报假红。
        const slotAbs = accessorReadDomain(a, key) ?? slot.value;
        const inner = denoteGuardB(slotAbs, access, budget);
        if (slot.optional) {
          // 可选槽本就允许缺键 ⇒ 不产存在性子句（standard 面同口径）。
          if (inner !== "true") checks.push(`(${access} === undefined || ${inner})`);
        } else {
          // Bug 409 / 410：必填槽的**存在性**必须是**独立子句**。
          // ① 内层守卫为 "true"（`any()` / `unknown`）时值子句整条消失 ⇒
          //    存在性一并消失；② 值域含 `undefined` 时 `v.a === undefined`
          //    对「缺键」与「显式 undefined」**同形** ⇒ 缺键对象被放行。
          checks.push(hasPropertyClause(v, key));
          if (inner !== "true") checks.push(inner);
        }
      }
      return checks.join(" && ");
    }
    case "arr":
      return `Array.isArray(${v}) && ${v}.every((item) => ${denoteGuardB(s.element, "item", budget)})`;
    case "tuple": {
      const checks = [`Array.isArray(${v})`];
      const minLen = s.elements.length;
      const holes = new Set(s.holes ?? []);
      checks.push(s.rest ? `${v}.length >= ${minLen}` : `${v}.length === ${minLen}`);
      s.elements.forEach((el, i) => {
        // hole 槽是下标缺席（`i in v` 为 false），不得检成 `v[i] === undefined`
        // （后者对显式 undefined 元素同样成立，会把稀疏位抹平）。
        if (holes.has(i)) {
          checks.push(`!(${i} in ${v})`);
          return;
        }
        const inner = denoteGuardB(el, `${v}[${i}]`, budget);
        if (inner !== "true") checks.push(inner);
      });
      for (const i of holes) {
        if (i >= minLen) checks.push(`!(${i} in ${v})`);
      }
      if (s.rest) {
        // rest 槽：长度超出部分统一检查
        const rest = denoteGuardB(s.rest, "item", budget);
        if (rest !== "true") {
          checks.push(`${v}.slice(${minLen}).every((item) => ${rest})`);
        }
      }
      return checks.join(" && ");
    }
    case "fn":
      return `typeof ${v} === "function"`;
    case "eff":
      if (s.eff === "promise") return `${v} instanceof Promise`;
      return "true";
    case "brand": {
      // Bug 407：brand **身份**必须被投影——只递归内层 shape 时守卫退化成
      // 「是个对象即可」（`{}` / `[]` / `new Map()` 全放行 = 假绿）。
      // 构造器按**全局名**查（`Reflect.get(globalThis, "<Brand>")`）：① 不用
      // 裸标识符（用户类标识符在产物里 ⇒ TS2304，strict 工程编不过）；
      // ② 运行时没有这个全局构造器 ⇒ **放行**（与 standard 面「ctor 找不到 ⇒
      // 放行」同口径）。
      const identity = brandIdentityClause(s.name, v);
      // brand 的内层是 Abs（对象面按内层身份查访问器侧表）
      const inner = denoteShape(s.shape, v, budget);
      if (inner === "true") return identity;
      return `(${identity}) && (${inner})`;
    }
    case "sum": {
      if (s.members.length === 0) return "false";
      const parts = s.members.map((m) => denoteGuardB(m, v, budget));
      return `(${parts.join(" || ")})`;
    }
  }
}

/**
 * 在 `term ↦ v` 下检查 pred。
 * 仅编码可判定的数值比较与字面量等值；不可判定返回 "true"（保守、不撒谎）。
 */
function denotePred(a: Abs, v: string): string {
  const p = a.pred;
  if (!p || p.op === "true") {
    // 无 pred：字面量 term 直接等值（term 判定，不用 litValue 哨兵）
    if (a.term?.op === "lit") return eqGuard(v, a.term.value);
    return "true";
  }
  return predAsJs(p, v, a);
}

function predAsJs(p: Pred, v: string, a: Abs): string {
  switch (p.op) {
    case "true":
      return "true";
    case "false":
      return "false";
    case "and":
      return p.args.map((x) => predAsJs(x, v, a)).join(" && ");
    case "or":
      return `(${p.args.map((x) => predAsJs(x, v, a)).join(" || ")})`;
    case "not": {
      const inner = predAsJs(p.arg, v, a);
      return inner === "true" ? "false" : `!(${inner})`;
    }
    case "gt":
    case "ge":
    case "lt":
    case "le":
    case "eq":
    case "ne": {
      // 仅支持 term 侧为值本身（var/lit 与 Abs.term 一致）或字面量比较。
      // lit 判定须看 t.op==="lit"：litValue 哨兵对 lit(undefined) 折成 undefined。
      const op = { gt: ">", ge: ">=", lt: "<", le: "<=", eq: "===", ne: "!==" }[p.op];
      const leftIsValue = termIsValue(p.a, a);
      const rightLitTerm = p.b.op === "lit" ? p.b : undefined;
      if (leftIsValue && rightLitTerm) {
        return cmpOp(v, op, rightLitTerm.value);
      }
      const leftLitTerm = p.a.op === "lit" ? p.a : undefined;
      const rightIsValue = termIsValue(p.b, a);
      if (rightIsValue && leftLitTerm) {
        return cmpLitValue(leftLitTerm.value, op, v);
      }
      // 双字面量：可判定
      if (leftLitTerm && rightLitTerm) {
        return `${jsLit(leftLitTerm.value)} ${op} ${jsLit(rightLitTerm.value)}`;
      }
      // Bug 410：长度界（`length(self)`）—— 比较端是 **app 项**时上面的
      // 分支都落空（`termIsValue` 对 app 恒 false）⇒ 谓词被抹成 "true"
      // ⇒ `string().length(3)` / `max(3)` / `min(2)` 的长度界**整段蒸发**。
      // 锚定项与 `projection.ts` 的 `lengthBound` **同口径**：`length(self)`
      // 或 `length(__nudo_self__)`；其余 app 项（`get(...)` 等）不可判定 ⇒
      // 保守不投影（不撒谎）。
      if (rightLitTerm && typeof rightLitTerm.value === "number" && isLengthSelf(p.a, a)) {
        return `${v}.length ${op} ${rightLitTerm.value}`;
      }
      return "true";
    }
    default:
      return "true";
  }
}

/**
 * Bug 409 / 410：键的**存在性**子句（必填槽）。
 *
 * 口径与 standard 面 `__nudoHasProperty` **同**：HasProperty 语义（用户原型上
 * 的真实键算在场）**减去** `Object.prototype` 的污染键（"constructor" /
 * "toString" 等不算在场）。
 *
 * 必须是**独立子句**：值子句不能反推存在性——值域含 `undefined` 时
 * `v.a === undefined` 对「缺键」与「显式 undefined」同形。
 */
function hasPropertyClause(v: string, key: string): string {
  const k = JSON.stringify(key);
  return `(Object.hasOwn(${v}, ${k}) || (${k} in ${v} && !Object.hasOwn(Object.prototype, ${k})))`;
}

/**
 * Bug 407：brand **身份**子句——`globalThis["<Brand>"]` 形态的 `instanceof`
 * 判定。
 *
 * - 用**字符串下标**取构造器（不用裸标识符）：用户类标识符进产物 ⇒ TS2304，
 *   产物在 strict 工程里编不过（Bug 512 的负控制）。
 * - 取值走 `Reflect.get(globalThis, "<Brand>")`：`globalThis["X"]` 的**字面量
 *   下标**在 TS 里会报 TS2339（`X` 不是 `globalThis` 的已知键），而 `Reflect.get`
 *   返回 `any` ⇒ 既无 TS2339 又无 `as` 断言 ⇒ 产物仍是**纯 JS 表达式**
 *   （可被 `new Function` / `.js` 消费面直接跑）。
 * - 运行时**没有**这个全局构造器 ⇒ **放行**（与 standard 面「ctor 找不到 ⇒
 *   放行」同口径）；有 ⇒ 必须 `instanceof`（brand 身份的全部信息）。
 */
function brandIdentityClause(name: string, v: string): string {
  const ctor = `Reflect.get(globalThis, ${JSON.stringify(name)})`;
  return `(typeof ${ctor} !== "function" || ${v} instanceof ${ctor})`;
}

/**
 * Bug 410：`length(self)` 的**锚定**判定。
 *
 * 锚定项接受 `length(self)`（被检查值自身）或 `length(__nudo_self__)`
 * （未实例化的占位符）——与 `projection.ts` 的 `lengthBound` **同口径**。
 * 其余 app 项（`get(...)` 等）不是长度界 ⇒ 不可判定 ⇒ 保守不投影。
 */
function isLengthSelf(t: Term, a: Abs): boolean {
  if (t.op !== "app" || t.fn !== "length" || t.args.length !== 1) return false;
  const arg = t.args[0]!;
  if (a.term && termEquals(arg, a.term)) return true;
  return arg.op === "var" && arg.id === SELF;
}

/** 字面量 → JS 表达式串。NaN/±Infinity 经 JSON.stringify 会得 "null"，须专处理。 */
function jsLit(v: LiteralValue): string {
  if (v === undefined) return "undefined";
  if (v === null) return "null";
  if (typeof v === "bigint") return `${v}n`;
  if (typeof v === "number") {
    if (Number.isNaN(v)) return "NaN";
    if (v === Infinity) return "Infinity";
    if (v === -Infinity) return "-Infinity";
    return String(v);
  }
  return JSON.stringify(v);
}

/** 等值守卫：NaN 必须走 Number.isNaN（NaN === NaN 为 false），不能 === 比较 */
function eqGuard(v: string, lv: LiteralValue): string {
  if (typeof lv === "number" && Number.isNaN(lv)) return `Number.isNaN(${v})`;
  return `${v} === ${jsLit(lv)}`;
}

/** 比较操作数：NaN 在 ===/!== 上同样不能用 ===，其余交给 jsLit 渲染 */
function cmpOp(v: string, op: string, lit: LiteralValue): string {
  if (typeof lit === "number" && Number.isNaN(lit)) {
    if (op === "===") return `Number.isNaN(${v})`;
    if (op === "!==") return `!Number.isNaN(${v})`;
  }
  return `${v} ${op} ${jsLit(lit)}`;
}

/** 反向比较：lit op v（关系算子不对称，须保持字面量在左） */
function cmpLitValue(lit: LiteralValue, op: string, v: string): string {
  if (typeof lit === "number" && Number.isNaN(lit)) {
    if (op === "===") return `Number.isNaN(${v})`;
    if (op === "!==") return `!Number.isNaN(${v})`;
  }
  return `${jsLit(lit)} ${op} ${v}`;
}

/** term 是否可视为「当前检查值 v」本身 */
function termIsValue(t: Term, a: Abs): boolean {
  if (t.op === "var") return true;
  if (t.op === "lit") {
    // litValue 哨兵对 lit(undefined) 折成 undefined，须直接看 term + Object.is
    return a.term?.op === "lit" && Object.is(a.term.value, t.value);
  }
  // app 等复合项：保守不绑到 v
  return false;
}
