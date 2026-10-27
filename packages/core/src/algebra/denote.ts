/**
 * 指称：Abs → 运行时谓词（设计 §2.7）。
 * - 无 pred：按 shape 检查（typeof / 结构）
 * - 有 pred：在 `term ↦ v` 下检查可判定的数值比较
 * - sum：任一成员
 */

import type { Abs } from "./abs.ts";
import type { Pred } from "./pred.ts";
import { termEquals, type LiteralValue, type Term } from "./term.ts";
import { accessorReadDomain } from "./accessors.ts";
import { isHiddenInternalSlot } from "./slot-visibility.ts";
import { safeMemberAccess } from "./codegen-escape.ts";
import { ProjectionBudget } from "./projection-budget.ts";
import { getEvalClass } from "./exec/class-registry.ts";
import { SELF } from "./constraint.ts";

/**
 * **没有可用 prototype** 的全局构造器（ES2024 标准全局 / node v26.10.0 实测）
 * ——这些名字上的 `instanceof` 判定**原生抛 TypeError**：
 * - 可调用但 `prototype` 不是对象（`Proxy` / `parseInt` / `eval` / `escape` …）
 *   ⇒ `Get(C, "prototype")` 的结果不是对象 ⇒ 抛「Function has non-object
 *   prototype 'undefined' in instanceof check」；
 * - **不可调用**（`Math` / `JSON` / `Intl` / `Reflect` / `Atomics` /
 *   `globalThis`）⇒ 抛「Right-hand side of 'instanceof' is not callable」。
 *
 * Bug 1130：brand 身份子句对这些构造器**必须跳过**——`instanceof` 一跑就抛 ⇒
 * 守卫产物**不可用**。model 里会出现的是 `Proxy`（`new Proxy(...)` 的 brand，
 * `builtins/error/error-family.ts` 的 `makeProxyAbs`）；其余是「用户类名与
 * 标准全局同名」的防御（同名 ⇒ `globalThis[name]` 就是那个不可用的构造器）。
 *
 * 口径固定在 **ES2024 标准全局**（不依赖宿主环境——守卫产物可能在浏览器里跑）。
 */
const PROTOTYPE_LESS_GLOBALS = new Set([
  // 可调用但没有对象 prototype
  "Proxy",
  "parseFloat",
  "parseInt",
  "decodeURI",
  "decodeURIComponent",
  "encodeURI",
  "encodeURIComponent",
  "escape",
  "unescape",
  "eval",
  "isFinite",
  "isNaN",
  // 不可调用（非构造器）
  "Math",
  "JSON",
  "Intl",
  "Reflect",
  "Atomics",
  "globalThis",
]);

/** 全局构造器**没有可用 prototype** ⇒ 身份子句不可表达（跳过） */
function hasUnusablePrototype(name: string): boolean {
  return PROTOTYPE_LESS_GLOBALS.has(name);
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

/** shape 守卫（按 Abs 递归：obj 槽需按对象身份查访问器侧表，Bug 191）。
 *
 * `arrayLike`（BUG-158）：被检查值所在 brand 是**非数组 exotic**（`arguments`）
 * 时，内层 arr / tuple 面**不得**以 `Array.isArray` 为前提——`arguments`
 * 满足长度 / 下标语义却不是数组 exotic ⇒ 该前提使守卫恒假。
 */
function denoteShape(a: Abs, v: string, budget: ProjectionBudget, arrayLike = false): string {
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
      //
      // BUG-258：**数组视图**（`view: "array"`，RegExpExecArray 等）反过来
      // 要求 `Array.isArray` 成立——原生 exec 结果的 `0..n-1` / `length` /
      // `index` / `input` / `groups` 全是自有属性（`length` 非枚举），所以下面
      // 的槽存在性子句 / 值子句逐条照旧成立；只有头部判据要翻转，否则真实
      // 值被 `!Array.isArray` 判假（假红）。
      const checks =
        s.view === "array"
          ? [`Array.isArray(${v})`]
          : [`typeof ${v} === "object"`, `${v} !== null`, `!Array.isArray(${v})`];
      for (const [key, slot] of Object.entries(s.slots)) {
        // Bug 240（S21）：internal 槽不进 guard 面（内部槽不是自有属性）——
        // 规范数组下标槽除外（承载元素域，族 01 口径）。
        if (isHiddenInternalSlot(key, slot)) continue;
        // BUG-097：槽名撞 `Object.prototype` 具名成员（`toString` / `valueOf` /
        // `constructor` / `hasOwnProperty` …）时，`data.toString` 的**静态类型**
        // 是原型成员的类型（`Record<string, any>` 的索引签名不遮蔽它们）⇒ 与
        // 字面量比较报 TS2367 ⇒ 产物在 strict 工程里编不过。方括号取值让索引
        // 签名生效（`any`）⇒ 可编译；其余键保留点号（可读性）。
        const access = Object.hasOwn(Object.prototype, key)
          ? `${v}[${JSON.stringify(key)}]`
          : safeMemberAccess(v, key);
        // Bug 191：访问器键的槽是 `$lit(void 0)` 占位——守卫须按 getter 读域
        // 判定（原生读 `data.ab` 走 getter），否则对函数自己的返回值报假红。
        // BUG-167：占位槽 `unknown` = 读域**不可判**（非纯 getter / defineProperty
        // 装的访问器）⇒ 不得为守卫执行用户 getter，也不得把冻结末值写成必等式
        //（那样 guard 对自己的返回值恒假）；落到占位值 → 只判 presence。
        // 判据是 **term 缺失**（`unknown` 无 term；纯 getter 占位 `$lit(void 0)`
        // 的 term = {op:"lit"}）——按 shape.k 判会误伤所有访问器。
        const slotAbs =
          slot.value.term === undefined
            ? slot.value
            : (accessorReadDomain(a, key) ?? slot.value);
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
    case "arr": {
      // BUG-095：`Array.prototype.every` **跳过不存在的下标（洞）** ⇒ 稀疏数组
      // 的洞位从不被检查 ⇒ guard 放行 `[1,,3]`（zod / standard 按位读作
      // undefined ⇒ 拒绝）。`Array.from` 把洞**填成 undefined** 后再逐位检查
      // ⇒ 与 standard 面「按位读 `value[i]`」同口径（回调内判 `i in v` 无用：
      // 洞位根本不会回调）。
      const elem = denoteGuardB(s.element, "item", budget);
      const every = `Array.from(${v}).every((item) => ${elem})`;
      // BUG-158：`arguments` 等非数组 exotic 不满足 `Array.isArray`。
      return arrayLike ? every : `Array.isArray(${v}) && ${every}`;
    }
    case "tuple": {
      // BUG-158：同上——非数组 exotic（`arguments`）只判长度 / 下标语义。
      const checks = arrayLike ? [] : [`Array.isArray(${v})`];
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
      // BUG-098：brand 的内层槽在 Abs 里是**观测到的字面量**（`source` /
      // `flags` / `lastIndex` / `message` / `name` …）⇒ 直接投影等于把「这次
      // 观测到的那个实例」钉成出口域 ⇒ 守卫拒绝同 brand 的其它实例
      // （`/abc/i` / `new TypeError(…)`），而 `.d.ts` / zod / standard 只判
      // **brand 身份**（`instanceof`）⇒ 四面接受集相反。内层只保留**类型**
      // 子句（观测字面量深度放宽）。
      const widenedInner = widenObservedLiterals(s.shape);
      // BUG-158：`arguments` 是**非数组 exotic**——内层 tuple / arr 面不得以
      // `Array.isArray` 为前提（core 自己判 `Array.isArray(arguments) === false`）。
      const inner = denoteShape(widenedInner, v, budget, s.name === "Arguments");
      // Bug 1130：**没有可用 prototype** 的构造器（`Proxy` 等）⇒ `instanceof`
      // 原生抛错 ⇒ 身份子句**跳过**（守卫必须能跑；身份信息在守卫面不可表达
      // ⇒ 只保留内层 shape 判定）。
      // BUG-166：brand 名属于**用户类**（`class URL { … }` 与宿主全局同名，
      // 原生词法作用域 ⇒ 用户类遮蔽全局）时，`Reflect.get(globalThis, "URL")`
      // 拿到的是**宿主**构造器 ⇒ 用户实例 `instanceof` 恒 false ⇒ 守卫拒绝
      // 导出函数**自己的返回值**（恒假）。身份信息在守卫面不可表达 ⇒ 跳过
      // 身份子句，只保留内层 shape 判定（宁可少判，不得恒假）。
      //
      // 但「守卫面不可表达」**只**成立于「同名宿主全局确实存在」——
      // `brandIdentityClause` 自带 `typeof Reflect.get(globalThis, name) !==
      // "function" || …` 的放行支：全局不存在时子句恒真（用户类 `class C`
      // 就属于这种）。若对所有已注册用户类一律跳过，普通用户类的身份子句会
      // 整段消失（`new C()` 的 guard 少一条）。
      const shadowsHostGlobal =
        getEvalClass(s.name) !== undefined &&
        typeof (globalThis as Record<string, unknown>)[s.name] === "function";
      if (hasUnusablePrototype(s.name) || shadowsHostGlobal) return inner;
      const identity = brandIdentityClause(s.name, v);
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
 * BUG-098：brand 内层形状的**观测字面量**不是出口域。
 *
 * 投影面（`.d.ts` / zod / standard）对 brand 只判**身份**（`instanceof`），
 * 内层槽里的字面量只是「求值时观测到的那个实例」的痕迹 ⇒ guard 若把它们写成
 * 等值比较，同一个 brand 的其它实例（`/abc/i`、`new TypeError("boom")`）会被
 * 拒绝 ⇒ 四面接受集相反（假红）。此处**深度**丢弃 lit term + 等值 pred，
 * 只留类型子句（顶层 `widenUncertainLiteral` 只放宽顶层 ⇒ 槽位漏网）。
 */
function widenObservedLiterals(a: Abs): Abs {
  const s = a.shape;
  switch (s.k) {
    case "obj": {
      const slots = Object.fromEntries(
        Object.entries(s.slots).map(([k, slot]) => [
          k,
          { ...slot, value: widenObservedLiterals(slot.value) },
        ]),
      ) as typeof s.slots;
      return a.term?.op === "lit"
        ? { ...a, shape: { ...s, slots }, term: undefined, pred: undefined }
        : { ...a, shape: { ...s, slots } };
    }
    case "arr":
      return { ...a, shape: { ...s, element: widenObservedLiterals(s.element) } };
    case "tuple":
      return {
        ...a,
        shape: {
          ...s,
          elements: s.elements.map(widenObservedLiterals),
          ...(s.rest !== undefined ? { rest: widenObservedLiterals(s.rest) } : {}),
        },
      };
    case "brand":
      return { ...a, shape: { ...s, shape: widenObservedLiterals(s.shape) } };
    case "sum":
      return { ...a, shape: { ...s, members: s.members.map(widenObservedLiterals) } };
    default:
      break;
  }
  // 叶子形态：lit term + 其等值 pred 一并丢弃 ⇒ 只剩类型子句
  if (a.term?.op === "lit") return { ...a, term: undefined, pred: undefined };
  return a;
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
      // BUG-092：整性谓词 `.int()` —— `eq(app("%", [x, lit(1)]), lit(0))`
      // （`constraint.ts` 的 `intPredOnTerm`）。左端是 **app 项** ⇒ 下面的
      // 「值 vs 字面量」分支全部落空 ⇒ 谓词被抹成 "true" ⇒ guard 放行
      // `3.5` / `NaN` / `Infinity`（zod / standard 拒绝 ⇒ 假绿）。
      if (p.op === "eq" || p.op === "ne") {
        const modZero =
          p.a.op === "app" &&
          p.a.fn === "%" &&
          p.a.args.length === 2 &&
          p.a.args[1]!.op === "lit" &&
          p.a.args[1]!.value === 1 &&
          termIsValue(p.a.args[0]!, a) &&
          p.b.op === "lit" &&
          p.b.value === 0;
        if (modZero) {
          return p.op === "eq" ? `Number.isInteger(${v})` : `!Number.isInteger(${v})`;
        }
      }
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
 * 口径 = **三面唯一规则**（BUG-096）：HasProperty 语义（原型链上的**用户**键
 * 算在场）**减去** `Object.prototype` 自身的成员（污染键 `constructor` /
 * `toString` / `valueOf` … 不算在场）。三面逐条同判据：
 * - guard 面 = 本函数；
 * - standard 面 = `standard-schema.ts` 的 `hasProperty` / 产物里的
 *   `__nudoHasProperty`（逐字等价）；
 * - zod 面 = `schema-generator.ts` 给**必填污染键槽**补的 `.superRefine`
 *   （`z.object` 原生按 `in` 判在场、含 Object.prototype 成员 ⇒ 不补就比
 *   另两面松：`Object.create({ toString: "s" })` 会被放行）。
 *
 * 必须是**独立子句**：值子句不能反推存在性——值域含 `undefined` 时
 * `v.a === undefined` 对「缺键」与「显式 undefined」同形。
 *
 * ⚠ 子句文本被 guard 产物钉住（`eval-bug-191-*` / `eval-bug-240-*` 逐字断言），
 * 改口径要连带改那两处与 zod / standard 面。
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
  // BUG-092：**字段读项** `get(parent, key)` 就是被检查值本身——obj 槽的
  // 守卫以 `v = <槽访问>` 递归，谓词左端的字段项与槽 Abs 自身 term 是**同一
  // 项**（`constraint.ts` 的 `getTerm`）⇒ 该形态可与字面量比较。其余 app 项
  // （`%` / 算术等**计算**项）不是 v 本身 ⇒ 保守不绑。
  if (t.op === "app" && t.fn === "get" && a.term !== undefined) {
    return termEquals(t, a.term);
  }
  // app 等复合项：保守不绑到 v
  return false;
}
