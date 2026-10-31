/**
 * HOF 关系 Abs：无 body 的外延关系（paramTypes → returnType）的判定、
 * α 替换与应用。类型变量仍是 term var；关系仍是 fn 形状上的外延槽。
 */

import type { Abs, Shape, Confidence } from "./abs.ts";
import { abs, anyAbs, confJoin, unknown } from "./abs.ts";
import type { Term } from "./term.ts";
import { simplifyTerm, termToString } from "./term.ts";
import type { Pred, PrimName } from "./pred.ts";
import { and, pTrue, pFalse, substPred } from "./pred.ts";
import { getFnImpl } from "./abs-fn.ts";
import { getSlot, joinAbs, makeSum } from "./objects.ts";
import { NudoThrow } from "./nudo-throw.ts";
import { errorTypeAbs, recordMayThrow } from "./may-throw.ts";
import { isSymbolAbs } from "./symbol-id.ts";
import type { HofSite, RelSource } from "./hof-types.ts";

// --- P2 types（定义在 hof-types.ts，重导出保持稳定导入路径）---

export type { RelSource, HofSite } from "./hof-types.ts";

/** deep-ish copy for snapshot（新对象，不是 env.vars 同一引用） */
export function snapshotAbs(a: Abs): Abs {
  const shape = a.shape;
  const copyShape = (s: Shape): Shape => {
    switch (s.k) {
      case "arr":
        return { ...s, element: snapshotAbs(s.element) };
      case "tuple": {
        const out: Shape = {
          ...s,
          elements: s.elements.map(snapshotAbs),
        };
        if (s.rest) out.rest = snapshotAbs(s.rest);
        if (s.holes) out.holes = [...s.holes]; // 空洞下标（读 undefined / in false）
        return out;
      }
      case "fn": {
        const out: Shape = { ...s, params: [...s.params] };
        if (s.paramTypes) out.paramTypes = s.paramTypes.map(snapshotAbs);
        if (s.returnType) out.returnType = snapshotAbs(s.returnType);
        if (s.optionalParams) out.optionalParams = [...s.optionalParams];
        if (s.slots) {
          const slots: NonNullable<Extract<Shape, { k: "fn" }>["slots"]> = {};
          for (const [k, slot] of Object.entries(s.slots)) {
            const nextSlot = { ...slot, value: snapshotAbs(slot.value) };
            Object.defineProperty(slots, k, {
              value: nextSlot, enumerable: true, writable: true, configurable: true,
            });
          }
          out.slots = slots;
        }
        return out;
      }
      case "sum":
        return { ...s, members: s.members.map(snapshotAbs) };
      case "obj": {
        const slots: Extract<Shape, { k: "obj" }>["slots"] = {};
        for (const [k, slot] of Object.entries(s.slots)) {
          // slot 标志（optional/readonly/internal/inherited/symbolKey）全保留
          const nextSlot = { ...slot, value: snapshotAbs(slot.value) };
          Object.defineProperty(slots, k, {
            value: nextSlot, enumerable: true, writable: true, configurable: true,
          });
        }
        const out: Shape = { ...s, slots };
        if (s.index) {
          out.index = {
            key: snapshotAbs(s.index.key),
            value: snapshotAbs(s.index.value),
          };
        }
        return out;
      }
      case "brand":
        return { ...s, shape: snapshotAbs(s.shape) };
      case "eff": {
        const out: Shape = { ...s, inner: snapshotAbs(s.inner) };
        if (s.rejected) out.rejected = snapshotAbs(s.rejected);
        return out;
      }
      default:
        return s;
    }
  };
  return {
    shape: copyShape(shape),
    term: a.term,
    pred: a.pred,
    conf: a.conf,
    // pathNote 是 Abs 级展示 facet —— 快照是**等价副本**，不得丢
    //（同 renameAbs 纪律：重建只搬四件套会把 join 标注静默抹掉）。
    ...(a.pathNote !== undefined ? { pathNote: a.pathNote } : {}),
  };
}


/**
 * 「有可用外延签名」判定：唯一权威定义。
 *
 * 名实说明：isRelFn **不要求** term 是 var。完全单态的具体签名
 * （paramTypes=[number], returnType=string）同样满足——map 有槽就用。
 * 多态（term=var）只是其中一种形态；名字里的 Rel 指「关系槽可用」。
 *
 * 收紧条件——仅有 returnType 而 paramTypes 与 arity 不对齐时，不算 rel，
 * 防止半截签名在 map 里冒充关系。
 */
export function isRelFn(a: Abs | undefined | null): boolean {
  if (!a || typeof a !== "object") return false;
  if (getFnImpl(a)) return false;
  const s = a.shape;
  if (!s || s.k !== "fn") return false;
  if (s.returnType === undefined) return false;
  if (s.paramTypes === undefined) return s.params.length === 0;
  // Display labels may trail required slots with `x?` / `...rest`; types
  // describe the typed prefix (required + rest element). Align on required
  // count OR full length (legacy exact shapes).
  if (s.paramTypes.length === s.params.length) return true;
  let required = 0;
  for (const p of s.params) {
    if (p && !p.startsWith("...") && !p.endsWith("?")) required++;
  }
  return s.paramTypes.length === required;
}

// --- pred 归约 ---

function litOfTerm(t: Term): import("./term.ts").LiteralValue | undefined {
  return t.op === "lit" ? t.value : undefined;
}

function foldCompare(
  op: Pred["op"],
  a: import("./term.ts").LiteralValue | undefined,
  b: import("./term.ts").LiteralValue | undefined,
): Pred | undefined {
  if (a === undefined || b === undefined) return undefined;
  if (typeof a !== typeof b) {
    if (op === "eq") return pFalse;
    if (op === "ne") return pTrue;
    return undefined;
  }
  switch (op) {
    case "eq":
      return a === b ? pTrue : pFalse;
    case "ne":
      return a !== b ? pTrue : pFalse;
    case "lt":
      return (a as number) < (b as number) ? pTrue : pFalse;
    case "le":
      return (a as number) <= (b as number) ? pTrue : pFalse;
    case "gt":
      return (a as number) > (b as number) ? pTrue : pFalse;
    case "ge":
      return (a as number) >= (b as number) ? pTrue : pFalse;
    default:
      return undefined;
  }
}

function predUsesMappedVars(p: Pred, map: ReadonlyMap<string, Abs>): boolean {
  const walkTerm = (t: Term): boolean => {
    if (t.op === "var") return map.has(t.id);
    if (t.op === "app") return t.args.some(walkTerm);
    return false;
  };
  const walk = (q: Pred): boolean => {
    switch (q.op) {
      case "true":
      case "false":
        return false;
      case "eq":
      case "ne":
      case "lt":
      case "le":
      case "gt":
      case "ge":
        return walkTerm(q.a) || walkTerm(q.b);
      case "and":
      case "or":
        return q.args.some(walk);
      case "not":
        return walk(q.arg);
      case "typeof":
        return walkTerm(q.t);
      case "assumeFinite":
        return walkTerm(q.t);
    }
  };
  return walk(p);
}

/** map 内有无 term 的实参（shape-only）→ 无法维持蕴含，整 pred 降 true */
function mapHasShapeOnlyVar(p: Pred, map: ReadonlyMap<string, Abs>): boolean {
  const walkTerm = (t: Term): boolean => {
    if (t.op === "var") {
      const arg = map.get(t.id);
      return !!arg && arg.term === undefined;
    }
    if (t.op === "app") return t.args.some(walkTerm);
    return false;
  };
  const walk = (q: Pred): boolean => {
    switch (q.op) {
      case "true":
      case "false":
        return false;
      case "eq":
      case "ne":
      case "lt":
      case "le":
      case "gt":
      case "ge":
        return walkTerm(q.a) || walkTerm(q.b);
      case "and":
      case "or":
        return q.args.some(walk);
      case "not":
        return walk(q.arg);
      case "typeof":
        return walkTerm(q.t);
      case "assumeFinite":
        return walkTerm(q.t);
    }
  };
  return walk(p);
}

/**
 * pred 三条规则：
 * 1. var ∈ map + 实参有 term → 换 term，可归约则归约，否则残余保留
 * 2. var ∈ map + 实参无 term → pred → true（conf 由调用方降级）
 * 3. var ∉ map（自由 α）→ 原样保留
 */
export function substPredAbs(
  p: Pred,
  map: ReadonlyMap<string, Abs>,
): { pred: Pred; dropped: boolean } {
  if (!predUsesMappedVars(p, map)) return { pred: p, dropped: false };
  if (mapHasShapeOnlyVar(p, map)) return { pred: pTrue, dropped: true };

  const substTerm = (t: Term): Term => {
    if (t.op === "var") {
      const arg = map.get(t.id);
      return arg?.term ?? t;
    }
    if (t.op === "app") {
      return { op: "app", fn: t.fn, args: t.args.map(substTerm) };
    }
    return t;
  };

  const replaced = substPred(p, substTerm);

  const fold = (q: Pred): Pred => {
    switch (q.op) {
      case "true":
      case "false":
        return q;
      case "eq":
      case "ne":
      case "lt":
      case "le":
      case "gt":
      case "ge": {
        const a = litOfTerm(q.a);
        const b = litOfTerm(q.b);
        const folded = foldCompare(q.op, a, b);
        return folded ?? q;
      }
      case "and": {
        const args = q.args.map(fold);
        if (args.some((x) => x.op === "false")) return pFalse;
        const rest = args.filter((x) => x.op !== "true");
        if (rest.length === 0) return pTrue;
        if (rest.length === 1) return rest[0]!;
        return and(...rest);
      }
      case "or": {
        const args = q.args.map(fold);
        if (args.some((x) => x.op === "true")) return pTrue;
        const rest = args.filter((x) => x.op !== "false");
        if (rest.length === 0) return pFalse;
        if (rest.length === 1) return rest[0]!;
        return { op: "or", args: rest };
      }
      case "not": {
        const inner = fold(q.arg);
        if (inner.op === "true") return pFalse;
        if (inner.op === "false") return pTrue;
        return { op: "not", arg: inner };
      }
      case "typeof":
        return q;
      case "assumeFinite":
        return q;
    }
  };

  return { pred: fold(replaced), dropped: false };
}

// --- substAbs ---

function substTermAbs(t: Term, map: ReadonlyMap<string, Abs>): Term {
  if (t.op === "var") {
    const arg = map.get(t.id);
    return arg?.term ?? t;
  }
  if (t.op === "app") {
    return simplifyTerm({
      op: "app",
      fn: t.fn,
      args: t.args.map((x) => substTermAbs(x, map)),
    });
  }
  return t;
}

function substShape(
  s: Shape,
  map: ReadonlyMap<string, Abs>,
  cache: Map<object, Abs>,
  visiting: Set<object>,
): Shape {
  switch (s.k) {
    case "never":
    case "any":
    case "unknown":
    case "prim":
      return s;
    case "brand":
      return { ...s, shape: substAbsInner(s.shape, map, cache, visiting) };
    case "eff":
      return { ...s, inner: substAbsInner(s.inner, map, cache, visiting) };
    case "arr":
      return { ...s, element: substAbsInner(s.element, map, cache, visiting) };
    case "tuple": {
      const elements = s.elements.map((e) =>
        substAbsInner(e, map, cache, visiting),
      );
      const next: Shape = { k: "tuple", elements };
      if (s.rest) next.rest = substAbsInner(s.rest, map, cache, visiting);
      return next;
    }
    case "fn": {
      const next: Shape = { k: "fn", params: s.params };
      if (s.name !== undefined) next.name = s.name;
      if (s.paramTypes) {
        next.paramTypes = s.paramTypes.map((p) =>
          substAbsInner(p, map, cache, visiting),
        );
      }
      if (s.returnType !== undefined) {
        next.returnType = substAbsInner(s.returnType, map, cache, visiting);
      }
      if (s.ctor !== undefined) next.ctor = s.ctor; // Bug 9 facet：替换不改可构造性
      return next;
    }
    case "sum":
      return {
        ...s,
        members: s.members.map((m) => substAbsInner(m, map, cache, visiting)),
      };
    case "obj": {
      const slots: Record<
        string,
        { value: Abs; optional?: boolean; readonly?: boolean }
      > = {};
      for (const [k, slot] of Object.entries(s.slots)) {
        const nextSlot: { value: Abs; optional?: boolean; readonly?: boolean } =
          { value: substAbsInner(slot.value, map, cache, visiting) };
        if (slot.optional) nextSlot.optional = true;
        if (slot.readonly) nextSlot.readonly = true;
        Object.defineProperty(slots, k, {
          value: nextSlot, enumerable: true, writable: true, configurable: true,
        });
      }
      const next: Shape = { k: "obj", slots };
      if (s.index) {
        next.index = {
          key: substAbsInner(s.index.key, map, cache, visiting),
          value: substAbsInner(s.index.value, map, cache, visiting),
        };
      }
      if (s.open) next.open = true;
      return next;
    }
  }
}

/**
 * cache：DAG 共享同一 Abs 对象时复用已替换结果（不是「访问过就返回原对象」）。
 * visiting：真环防御；Abs 正常是树，环路径返回原对象以避免死循环。
 */
function substAbsInner(
  a: Abs,
  map: ReadonlyMap<string, Abs>,
  cache: Map<object, Abs>,
  visiting: Set<object>,
): Abs {
  // term 是映射内 var：整 Abs 替换（不进 cache——替换结果与对象身份无关）
  if (a.term?.op === "var" && map.has(a.term.id)) {
    const repl = map.get(a.term.id)!;
    return {
      shape: repl.shape,
      term: repl.term,
      pred: repl.pred,
      conf: confJoin(a.conf, repl.conf),
    };
  }

  const hit = cache.get(a);
  if (hit !== undefined) return hit;
  // 真环：计算中重入 → 返回原对象（不缓存半截结果）
  if (visiting.has(a)) return a;

  visiting.add(a);
  const shape = substShape(a.shape, map, cache, visiting);
  const term = a.term ? substTermAbs(a.term, map) : undefined;

  let pred = a.pred;
  let conf = a.conf;
  if (a.pred) {
    const r = substPredAbs(a.pred, map);
    pred = r.pred;
    if (r.dropped) conf = confJoin(conf, "partial");
  }
  visiting.delete(a);

  const result = abs(shape, term, pred, conf);
  // pathNote（分支 join 可解释标注）同 renameAbs 纪律：α 替换是语义等价
  // 变换，Abs 级展示 facet 不得因重建丢失。
  if (a.pathNote !== undefined) result.pathNote = a.pathNote;
  cache.set(a, result);
  return result;
}

/**
 * α 替换：map 的 key 是 term var id，value 是替换 Abs。
 * var ∉ map 原样保留（含自由 α 上的 term/pred）。
 */
export function substAbs(a: Abs, map: ReadonlyMap<string, Abs>): Abs {
  if (map.size === 0) return a;
  return substAbsInner(a, map, new Map(), new Set());
}

/**
 * 裸宿主值 → Abs 的归一化桥（**普通调用面**实参归一化用）。
 *
 * hof.ts 是 algebra 层叶子，**不 import exec**（避免 hof ↔ exec 环，
 * 见本文件 `setApplyCallbackHost` 同款纪律）⇒ 归一化实现由宿主在运行时
 * 注册（`exec/class/invoke.ts` 注册 `asAbsVal`——与成员调用面同一门面，
 * 同一宿主函数恒同一 Abs 身份 ⇒ 两种调用口径一致）。
 *
 * 未注册 ⇒ 回落 `unknown`（fail-closed，不崩）。
 */
let rawArgNormalizer: ((v: unknown) => Abs) | undefined;

/** 注册裸宿主值 → Abs 的归一化实现（宿主加载期调用；同款注册式）。 */
export function setRawArgNormalizer(fn: (v: unknown) => Abs): void {
  rawArgNormalizer = fn;
}

/**
 * 普通调用面实参归一化（Bug 882）：具名导入 / 直接调用的实参可能是
 * **裸宿主值**（宿主函数 / 宿主构造器 / 用户函数声明——transpile 侧直发
 * host function）。这类值没有 Abs 形状 ⇒ 流进代数解引用点（`arg.shape`）
 * 会解引用 undefined ⇒ TypeError 冒泡 ⇒ 上层当成「这个调用可能抛」⇒
 * 记 may TypeError ⇒ **L2 门禁假红**（native 必不抛）。
 *
 * 归一化口径与成员调用面（`exec/class/invoke.ts` 的 Bug 85 段）同款：
 * 非 Abs 实参一律经 `asAbsVal` 收成 Abs。
 */
function normalizeCallArg(a: Abs | undefined): Abs {
  if (a && typeof a === "object" && "shape" in (a as object)) return a;
  return rawArgNormalizer ? rawArgNormalizer(a) : unknown;
}

/**
 * 从 pattern（声明形参）与 arg（实参 Abs）做结构合一，绑定 α 变量。
 * 首次绑定保留；只下钻 arr / obj / tuple / sum / fn 形参。
 *
 * Bug 882：**实参未必是 Abs**（普通调用面把裸宿主值原样灌进来——见
 * `normalizeCallArg`）。无形状的实参**不参与类型变量绑定**（此前
 * `arg.shape` 解引用 undefined ⇒ TypeError 冒泡 ⇒ L2 假红）。
 *
 * Bug 453：形参/实参的**形状 kind 可不同**（收割的 `T[]` = `arr` vs 引擎的
 * 数组字面量 = `tuple`）⇒ 增加**跨 kind 臂**（`arr`×`tuple` / `tuple`×`arr`）。
 * ⚠ **同 kind 臂排在前**（既有用例依赖它）。
 */
function bindTypeVars(
  pattern: Abs,
  arg: Abs,
  map: Map<string, Abs>,
  depth = 0,
): void {
  if (depth > 6 || map.size > 16) return;
  // 无形状实参（裸宿主值）：不绑定、不下钻——「绑不出」而非「崩」。
  const as = (arg as Abs | undefined)?.shape;
  if (!as) return;
  const pt = pattern.term;
  if (pt?.op === "var") {
    if (!map.has(pt.id)) map.set(pt.id, arg);
    return;
  }
  const ps = pattern.shape;
  if (ps.k === "arr" && as.k === "arr") {
    bindTypeVars(ps.element, as.element, map, depth + 1);
    return;
  }
  if (ps.k === "tuple" && as.k === "tuple") {
    const n = Math.min(ps.elements.length, as.elements.length);
    for (let i = 0; i < n; i++) bindTypeVars(ps.elements[i]!, as.elements[i]!, map, depth + 1);
    return;
  }
  // 跨 kind 臂（Bug 453）：**收割**的 `T[]` 形参建成 `arr`（元素 = α var），
  // 而**引擎**的数组字面量建成 `tuple` ⇒ 只做同 kind 配对 ⇒ α **永不绑定**
  // ⇒ 返回值落 `any`（未绑定 α）⇒ 参与算术即「抽象操作数强制转换」
  // ⇒ 记 may-throw ⇒ **L2 假红**（tsc exit 0 的合法代码被门禁判红）。
  //
  // ⚠ **同 kind 臂必须排在前**（上面两臂）：否则
  // `packages/core/src/algebra/__tests__/hof-relation.test.ts` 的既有用例
  // 「deep α: `T[]` param binds T from `number[]` arg (lodash-style)」
  // （arr 形参 × arr 实参）会被改判。
  //
  // Bug 1079：跨 kind 臂的**取值口径**收紧——元素域必须是 tuple **全部**
  // 元素的同型域（见 `tupleElementDomain`），不得拿首元素代表整个元素域。
  if (ps.k === "arr" && as.k === "tuple") {
    // Bug 1079：元素域取 tuple **全部**元素的同型域（**不是首元素**）。
    // 首元素只代表一个槽：拿它当整个元素域 ⇒ 异构数组 `[1,"a"]` 被推成
    // `number[]`——比真实类型 `(number|string)[]` **更窄** ⇒ 把「不知道」
    // 升级成「知道」⇒ 契约 `array(number())` 假绿 / `array(string())` 假红。
    // 异构 ⇒ `any`（诚实的「不知道」，不臆造窄类型）。
    const domain = tupleElementDomain(as.elements, as.rest);
    if (domain !== undefined) bindTypeVars(ps.element, domain, map, depth + 1);
    return;
  }
  if (ps.k === "tuple" && as.k === "arr") {
    // tuple 形参 × arr 实参：实参只有一个元素类型（arr 元素类型本身即其元素的
    // 保守 join）⇒ 各槽都拿它（α 首次绑定保留 ⇒ 多槽同 α 时首个胜出）。
    for (const el of ps.elements) bindTypeVars(el, as.element, map, depth + 1);
    return;
  }
  if (ps.k === "sum") {
    // union 形参：在与实参成员最匹配的 pattern 成员上绑定（取首个能下钻的）
    for (const m of ps.members) {
      const before = map.size;
      bindTypeVars(m, arg, map, depth + 1);
      if (map.size > before) return;
    }
    return;
  }
  if (ps.k === "obj" && as.k === "obj") {
    for (const [key, slot] of Object.entries(ps.slots)) {
      // getSlot：pattern 槽键是跨来源 key（toString 等）时裸读会踩 Object.prototype
      const aSlot = getSlot(as.slots, key);
      if (aSlot) bindTypeVars(slot.value, aSlot.value, map, depth + 1);
    }
    return;
  }
  if (ps.k === "fn" && as.k === "fn" && ps.paramTypes && as.paramTypes) {
    const n = Math.min(ps.paramTypes.length, as.paramTypes.length);
    for (let i = 0; i < n; i++) bindTypeVars(ps.paramTypes[i]!, as.paramTypes[i]!, map, depth + 1);
    return;
  }
  if (ps.k === "eff" && as.k === "eff" && ps.eff === as.eff) {
    // Promise<T> / generator<T>
    bindTypeVars(ps.inner, as.inner, map, depth + 1);
    return;
  }
  if (ps.k === "brand" && as.k === "brand") {
    // Map/Set 等：__key/__value/__elem 槽做 α 合一（名字一致才下钻）
    if (ps.name === as.name) bindTypeVars(ps.shape, as.shape, map, depth + 1);
    return;
  }
  // prim / unknown：无 α 可绑
}

/**
 * **已知 nullish 元素**（Bug 1097）：引擎把 `null` / `undefined` 建成
 * 「`unknown` **形状** + lit **项**」（`abs.ts` 的 `absLit` / `exec` runtime 的
 * `undef()`）⇒ 形状 kind 是 `unknown`，但**类型是已知的**。
 *
 * 与「真·推断失败」严格区分：后者是 `unknown` 形状且**没有**已知 lit
 * （`unknown` 令牌 / 未知 term）⇒ 元素域真的不可知。
 *
 * 口径锚点（`abs.ts` 顶部）：`any` = 无约束并集（**自信的任意值**），
 * `unknown` = 推导失败（**不是**任意值）⇒ 二者不可互换。
 */
function isKnownNullishAbs(el: Abs): boolean {
  if (el.shape.k !== "unknown") return false;
  const t = el.term;
  if (t?.op !== "lit") return false;
  return t.value === null || t.value === undefined;
}

/**
 * tuple 实参的**元素域**（Bug 1079）——arr 形参（收割的 `T[]`）× tuple 实参
 * （引擎的数组字面量）时 α 的取值。
 *
 * - 空 tuple（无元素）⇒ `undefined` ⇒ **不绑**（α 留在原处 ⇒ 返回值落
 *   `any`：诚实的「不知道」，不臆造元素类型）。
 * - 元素**同型**（prim 类型相同 / 形状 kind 相同）⇒ 该同型域：
 *   - prim：字面量按 TS 侧字面量拓宽落 base prim（`[1,2]` ⇒ `number`，
 *     不是 `1|2`——字面量域比 TS 推出来的类型**窄**）；
 *   - 结构形状（obj / arr / tuple…）：各元素 join（obj 槽并集等——与引擎
 *     其它「tuple ⇒ 元素域」口径同款）。
 * - 元素**异型**（`[1,"a"]`）⇒ `any`：TS 侧推成 `number | string`，本引擎
 *   不做联合投影 ⇒ 取 `any`（不窄于真实类型 ⇒ 不假绿）。
 *
 * ⚠ 「首次绑定保留」语义（见上方 tuple×arr 臂注释）：`any` 也要**绑上去**
 * （而不是跳过）——否则后续形参可能把同一个 α 绑成窄类型 ⇒ 又回到「自信的
 * 错误类型」。
 *
 * **Bug 1097：`unknown` 形状 ≠ 域不可知。** 引擎把 `null` / `undefined`
 * 建成「`unknown` 形状 + lit 项」⇒ 这两个是**已知类型**。此前按形状 kind
 * 一刀切（`shape.k === "unknown"` ⇒ 域退 `any`）⇒ 精度回退（`[null]` 的
 * 元素域从 `null` 退成 `any`）且 `any` 是「自信的任意值」（参与算术即抽象
 * 强转 ⇒ 记 may-throw ⇒ L2 假红）。现按三类分派：
 *
 * 1. **已知 nullish**（`unknown` 形状 + lit 项，值为 `null`/`undefined`）
 *    ⇒ 已知类型：**不参与**异型判定（否则 `[1,null]` 会被判异型），
 *    只**贡献可空性**（`[1,null]` ⇒ `number | null`；只有 nullish ⇒ `null`）。
 * 2. **真·推断失败**（`unknown` 形状且无已知 lit）⇒ 域**不可知** ⇒ 退
 *    **`unknown`**（**不是** `any`：仓内口径 `unknown` = 推导失败，
 *    `any` = 无约束并集）。选 `unknown` 还顺带避开 may-tier：算术抽象臂
 *    对 `any` 记 may-throw、对 `unknown` 不记（wave 1 口径）⇒ 不制造
 *    L2 假红。
 * 3. **其它**（prim / obj / tuple / any…）⇒ 保持既有同型 base type 口径
 *    （同型 ⇒ 该 base type；异型 ⇒ 仍退 `any`——本轮不把异型窄化成联合）。
 */
function tupleElementDomain(elements: Abs[], rest?: Abs): Abs | undefined {
  const live = [...elements, ...(rest ? [rest] : [])].filter(
    (e) => e.shape.k !== "never",
  );
  if (live.length === 0) return undefined;
  // Bug 1097：先分流 nullish / 真·未知，其余走既有同型判定。
  const nullish: Abs[] = [];
  const others: Abs[] = [];
  for (const el of live) {
    if (el.shape.k === "unknown") {
      // 已知 nullish（null / undefined）⇒ 已知类型：只贡献可空性。
      if (isKnownNullishAbs(el)) nullish.push(el);
      // 真·推断失败 ⇒ 元素域不可知 ⇒ unknown（不是 any）。
      else return unknown;
      continue;
    }
    others.push(el);
  }
  // 异型判定：元素 base type 必须一致
  let key: string | undefined;
  for (const el of others) {
    const k = el.shape.k === "prim" ? `prim:${el.shape.type}` : el.shape.k;
    if (key === undefined) key = k;
    else if (key !== k) return anyAbs;
  }
  // 只有 nullish 元素 ⇒ 域 = null / undefined（可空性本身就是域）。
  if (key === undefined) {
    let acc = nullish[0]!;
    for (let i = 1; i < nullish.length; i++) acc = makeSum(acc, nullish[i]!);
    return acc;
  }
  // `any` 元素 ⇒ 域 = any（吸收一切，含可空性：any | null ≡ any）。
  if (key === "any") return anyAbs;
  const conf = others.reduce((c, e) => confJoin(c, e.conf), "exact" as Confidence);
  let base: Abs;
  if (key.startsWith("prim:")) {
    const type = key.slice("prim:".length) as PrimName;
    const only = others[0]!;
    // 单元素且非字面量：保留该项自身的界证据（term + pred）
    if (others.length === 1 && only.term?.op !== "lit") base = only;
    // 字面量 / 多元素：落 base prim（字面量拓宽；多元素的界不互相成立 ⇒ 不下窄）
    else base = { shape: { k: "prim", type }, conf };
  } else {
    // 同型结构形状：各元素 join（obj 槽并集 / 同构嵌套等）
    base = others.reduce((a, b) => joinAbs(a, b));
  }
  // 可空性：base ∪ {null / undefined}（用仓内既有 sum 构造，不自造联合表示）
  if (nullish.length === 0) return base;
  return nullish.reduce((acc, n) => makeSum(acc, n), base);
}

/**
 * relation 面必填 arity（**调用执法**口径）。
 *
 * 判据与 `leq.ts` 的 `requiredFnArity` / `diagnostics.ts` 的 `arityFace`
 * 同一「必填位计数」口径（`...rest` 与 `x?` 不是必填位），补上 Bug 399 的
 * `optionalParams[i] === true` 标记。
 *
 * **只在声明方表态可选性时执法**（`optionalParams` 或任一标签带 `...` / `?`
 * 标记）。`envFn` 自动生成的标签（`x` / `x0`…）不承载可选性信息 ⇒ 返回
 * `undefined` = **不执法**：把「未表态」当「全必填」会对合法代码报必抛
 *（假红，CI 卡死），而对合法代码假红的代价高于「少报一种必抛」。要执法
 * 哪一位，声明侧用 `params: ["type", "options?"]` 明确表态即可（node env
 * 的 Event 族已是此形态）。
 */
function relationRequiredArity(shape: {
  params: string[];
  optionalParams?: boolean[];
}): number | undefined {
  const opt = shape.optionalParams;
  const declared =
    !!opt || shape.params.some((p) => p.startsWith("...") || p.endsWith("?"));
  if (!declared) return undefined;
  let required = 0;
  for (let i = 0; i < shape.params.length; i++) {
    const p = shape.params[i] ?? "";
    if (p.startsWith("...")) continue;
    if (opt ? opt[i] === true : p.endsWith("?")) continue;
    required++;
  }
  return required;
}

/**
 * relation-only / isRelFn 的应用：按 paramTypes 做 α 替换得到 returnType。
 * impl.relation 槽优先于 shape.returnType。重复 α 先绑定保留。
 * **深度合一**：`T[]` 形参可从 `number[]` 实参绑出 T=number（lodash 泛型）。
 */
export function instantiateReturn(fn: Abs, args: Abs[]): Abs {
  const shape = fn.shape;
  if (!shape || shape.k !== "fn") return unknown;
  // Bug 162：relation 面（env 声明的**无体**函数 / 构造器）的必填实参执法。
  // 宿主侧（WebIDL / node 内建）对「少传必填实参」**定抛 TypeError**
  //（`new Event()` / `new Request()` / `document.querySelector()`…）；
  // 旧实现把缺失实参静默补成 `unknown`（下方 `args[i] ?? unknown`）⇒ 不记抛
  // ⇒ L2 门禁假绿。口径与用户函数面（`diagnostics.ts` 的 `arityFace`，
  // 「少参 error 按必填位判」）一致，避免两面结论相反。
  //
  // 两个门槛（**只主张可证的那一档**，宁可欠精确不可假红）：
  // 1. 声明方必须表态可选性（见 `relationRequiredArity` 的 `undefined`）；
  // 2. 只对**声明为构造器**（`ctor: true`）的 relation 面执法——非构造器
  //    fn 被 `new` 时 `$new` 已走「构造性未知」通道（env-bug-866 的反向
  //    对照钉），不得被本档抢占成另一种结论。
  if (shape.ctor === true) {
    const required = relationRequiredArity(shape);
    if (required !== undefined && args.length < required) {
      throw new NudoThrow(errorTypeAbs("TypeError"));
    }
  }
  const impl = getFnImpl(fn);
  const src = impl?.relation ?? {
    paramTypes: shape.paramTypes ?? [],
    returnType: shape.returnType ?? unknown,
  };
  const map = new Map<string, Abs>();
  src.paramTypes.forEach((p, i) => {
    // Bug 882：普通调用面实参归一化（裸宿主值 → Abs）——与成员调用面
    // （`exec/class/invoke.ts` 的 Bug 85 段）同款口径。
    bindTypeVars(p, normalizeCallArg(args[i] ?? unknown), map);
  });
  // 条件类型 infer：T 绑定后投出 E/U；extends 不成立 → fallback 支
  if (src.inferFrom) {
    const bound = map.get(src.inferFrom.fromVar);
    if (src.inferFrom.via === "arr" && bound?.shape.k === "arr") {
      map.set(src.inferFrom.inferVar, bound.shape.element);
    } else if (src.inferFrom.via === "promise" && bound?.shape.k === "eff" && bound.shape.eff === "promise") {
      map.set(src.inferFrom.inferVar, bound.shape.inner);
    } else if (src.condFallback) {
      return substAbs(src.condFallback, map);
    }
  }
  return substAbs(src.returnType, map);
}

/**
 * 回调统一入口（单点定义）。A–F + sum：
 * A Node inline | B apply | C body | D relation | E isRelFn | F unknown
 *
 * 实现委托 applyAbsFn（已含 sum / D / E / body 优先）。
 * Identifier 解析层：env.vars 有 Abs → B–E；env.fns 有 → callFunction；否则 unknown。
 *
 * 为避免 hof ↔ exec 循环依赖，本函数由宿主在运行时绑定。
 *
 * 依赖说明：宿主在 `exec/call.ts`（evaluator `$call` 宿主）加载时注册（副作用）。
 * 只 import hof.ts 而未加载 exec/call 时，fallback 仅认 relation/isRelFn。
 * 与 §5.1 的「禁止全局 collector」不同——这里是无状态委托钩子，不是 run 局部状态。
 */
type ApplyCallbackHost = (
  cb: Abs | { type: string },
  args: Abs[],
  env: unknown,
  phi: unknown,
  budget: unknown,
  thisVal?: Abs,
) => Abs;

let applyCallbackHost: ApplyCallbackHost | undefined;

/**
 * evaluator 宿主 `exec/call.ts` 加载时注册（副作用）。
 * 必须经 `exec/call.ts`（或其依赖方：exec/class、generalize）加载，
 * 才能启用 Identifier/env.fns/inline body 路径；只 import hof.ts 时 fallback
 * 仅认 relation/isRelFn。勿在多份实例下各写各的——双包/双副本会覆盖。
 */
export function setApplyCallbackHost(fn: ApplyCallbackHost): void {
  applyCallbackHost = fn;
}

/**
 * Bug 26：宿主全局函数回调桥（exec/calls.ts 的 callHostGlobalFn——模块
 * 加载时注册）。applyCallbackValue 的宿主函数分支此前把 Abs 实参直接喂
 * 宿主函数（parseInt(absObj) → NaN 裸值被弃成 unknown）；命中宿主全局
 * 身份时改走被调用位同款桥（evalGlobalFn / 字面量守卫执行）。
 * 注册方（calls.ts）单向依赖本模块，避免 hof → exec 循环。
 */
let hostGlobalCallBridge: ((fn: unknown, args: Abs[]) => Abs | undefined) | undefined;

export function setHostGlobalCallBridge(bridge: (fn: unknown, args: Abs[]) => Abs | undefined): void {
  hostGlobalCallBridge = bridge;
}

/**
 * 通用回调实参调用（exec/class invokeArrMethod 与 builtins Array.from 共用）：
 * 原始 JS 函数直调（展开实参）；Abs fn 走 applyCallbackAbs（sum 分发/宿主）。
 * 求值引擎 transpile 的箭头回调是 $fnVal Abs——$fnVal.apply 自带调用边界。
 */
export function applyCallbackValue(
  fn: unknown,
  args: Abs[],
  env: unknown,
  phi: unknown,
  budget: unknown,
  thisVal?: Abs,
): Abs {
  if (typeof fn === "function") {
    // Bug 26：宿主全局函数值回调（[1,2].map(Number) / map(parseInt)）——
    // 经桥按被调用位语义分派；非宿主全局（转译函数）保持直调
    const bridged = hostGlobalCallBridge?.(fn, args);
    if (bridged !== undefined) return bridged;
    // thisVal（HOF thisArg，Bug 21）经宿主调用位注入（undefined ≡ 现状）
    const r = Reflect.apply(fn as (...a: Abs[]) => unknown, thisVal as never, args);
    if (r && typeof r === "object" && "shape" in (r as object)) return r as Abs;
    return unknown;
  }
  const absFn = asAbs(fn);
  if (absFn) return applyCallbackAbs(absFn, args, env, phi, budget, thisVal);
  return unknown;
}

/**
 * sum 实参的成员级分发（applyCallbackAbs 与 exec/class invokeArr callFn 共用）：
 * 只看**首个** sum 下标（其余位置原样），逐成员递归后 `joinAbs` 左折；
 * 空 sum 无成员 → unknown（JS 不会产生，保守兜底）。
 * 未命中 sum → `handled: false`，调用方继续自己的回调分派。
 */
export function dispatchSumArg(
  args: Abs[],
  recurse: (nextArgs: Abs[]) => Abs,
): { handled: boolean; result: Abs } {
  const sumIdx = args.findIndex(
    (a) => a && typeof a === "object" && "shape" in (a as object) && (a as Abs).shape.k === "sum",
  );
  if (sumIdx < 0) return { handled: false, result: unknown };
  const members = (args[sumIdx] as Abs & { shape: { k: "sum"; members: Abs[] } }).shape.members;
  let acc: Abs | undefined;
  for (const m of members) {
    const r = recurse(args.map((a, i) => (i === sumIdx ? m : a)));
    acc = acc === undefined ? r : joinAbs(acc, r);
  }
  return { handled: true, result: acc ?? unknown };
}

export function applyCallbackAbs(
  cb: Abs | { type: string },
  args: Abs[],
  env: unknown,
  phi: unknown,
  budget: unknown,
  thisVal?: Abs,
): Abs {
  // sum 实参按成员分发再 join（joinAbs 字面量枚举后 map/filter 元素常为 sum）
  const sum = dispatchSumArg(args, (nextArgs) =>
    applyCallbackAbs(cb, nextArgs, env, phi, budget, thisVal),
  );
  if (sum.handled) return sum.result;
  if (!applyCallbackHost) {
    // fallback：纯 Abs 关系路径（测试/无宿主）
    if (cb && typeof cb === "object" && "shape" in cb) {
      const a = cb as Abs;
      const impl = getFnImpl(a);
      if (impl?.relation) return instantiateReturn(a, args);
      if (isRelFn(a)) return instantiateReturn(a, args);
    }
    return unknown;
  }
  return applyCallbackHost(cb, args, env, phi, budget, thisVal);
}

// --- 共享结果投影（exec/class 与 hof 共用，禁止各写一套）---

/** undefined 值的统一 Abs 表示（forEach/find 等） */
export function undefAbs(): Abs {
  return abs(
    { k: "unknown" },
    { op: "lit", value: undefined },
    pTrue,
    "exact",
  );
}

/**
 * map 元素投影：body 在符号实参上跑出 unknown 时，
 * 用 shape.returnType 槽，conf 由调用方按 path/partial 处理。
 * rel 回调不会走到这里（instantiateReturn 已给出结果）。
 */
export function mapElementFallback(
  cbAbs: Abs | undefined,
  elem: Abs,
  out: Abs,
): Abs {
  if (out.shape.k !== "unknown" || elem.term?.op !== "var") return out;
  const slot = cbAbs?.shape.k === "fn" ? cbAbs.shape.returnType : undefined;
  return slot ?? out;
}

/**
 * flatMap 统一结果：展开后的元素 join 成 arr(γ)。
 * JS flatMap 永远返回 Array；双路径共用此投影，禁止一边 tuple 一边 arr。
 * 同 lit/var term 元素 first-wins（joinAbs 会丢 β 身份，见 design §5.1）。
 */
export function projectFlatMapResult(
  arrConf: Confidence,
  mapped: Abs[],
): Abs {
  const flatEls: Abs[] = [];
  for (const m of mapped) {
    if (m.shape.k === "arr") flatEls.push(m.shape.element);
    else if (m.shape.k === "tuple") flatEls.push(...m.shape.elements);
    // Bug 84：非数组映射值原生合法（FlattenIntoArray 只展开 IsArray 值，
    // 其余原样追加）——x => x / () => "ab" 不得折 unknown
    else flatEls.push(m);
  }
  // Bug 21：空展开（() => []）是可精确计算的 []，不再折 unknown
  if (flatEls.length === 0) {
    return abs({ k: "tuple", elements: [] }, undefined, undefined, confJoin(arrConf, "exact"));
  }
  const first = flatEls[0]!;
  // Bug 21：identity 仅在双方都有 term（lit/var）时由 termToString 判定；
  // 无 term 的结构元素（tuple/obj…）一律视为互不相同 → joinAbs——
  // 旧 first-wins 会把 [[v]] 全部元素折成 [1]，静默丢弃 [2]
  const sameIdentity = flatEls.every(
    (e) =>
      !!e.term &&
      !!first.term &&
      termToString(e.term) === termToString(first.term),
  );
  const el = sameIdentity ? first : flatEls.reduce((a, b) => joinAbs(a, b));
  return abs(
    { k: "arr", element: el },
    undefined,
    undefined,
    confJoin(arrConf, "path"),
  );
}

/**
 * GetMethod/IsCallable 前置校验（Bug 49/51/55/73/74 共享）：
 * 回调 / 比较器 / mapper 在**迭代前**校验（空接收者也要抛——原生
 * GetCallback 先于任何元素访问）。
 * - JS 函数 / fn 形 / 带 fnImpl（body/apply/relation）→ 可调用，放行；
 * - prim / tuple / arr / 闭 obj / nullish 字面量 / 缺省 → 确定 TypeError
 *   （hard NudoThrow，catch 层可吸收）；
 * - any / 真 unknown / open obj / brand / eff / 含不可调用成员的 union →
 *   recordMayThrow（值域由调用方保守）。
 * undefinedOk（sort / toSorted / Array.from）：缺省或**严格 undefined** 字面量
 * 视为无实参（合法）——注意 null 不在豁免之列（sort(null)/from(x,null) 原生
 * 同抛）；HOF（map/filter/…）不设：undefined 同样不可调用，原生同抛。
 */
export function validateCallableArg(
  arg: unknown,
  cause: string,
  opts?: { undefinedOk?: boolean },
): void {
  if (opts?.undefinedOk) {
    if (arg === undefined) return;
    const pre = asAbs(arg);
    if (pre?.term?.op === "lit" && pre.term.value === undefined) return;
  }
  const isCallable = (v: unknown): boolean => {
    const a = asAbs(v);
    return (
      typeof v === "function" ||
      (!!a &&
        ((a.shape as { k?: string }).k === "fn" || getFnImpl(a) !== undefined))
    );
  };
  if (isCallable(arg)) return;
  const a = asAbs(arg);
  const k = a ? (a.shape as { k?: string }).k : undefined;
  const nullishLit =
    !!a && a.term?.op === "lit" && (a.term.value === null || a.term.value === undefined);
  const definitelyUncallable =
    !a ||
    nullishLit ||
    k === "prim" ||
    k === "tuple" ||
    k === "arr" ||
    (k === "obj" && (a.shape as { open?: boolean }).open !== true);
  if (definitelyUncallable) throw new NudoThrow(errorTypeAbs("TypeError"));
  if (k === "sum") {
    // union：全员可调用才放行，否则存在不可调用臂 → may
    const members = (a!.shape as unknown as { members: unknown[] }).members;
    if (members.length > 0 && members.every(isCallable)) return;
  }
  recordMayThrow({ kind: "TypeError", cause });
}

/**
 * ToIntegerOrInfinity 下标实参校验（Bug 56/66/67/75 共享）：shape 先于 lit 判定
 * ——symbol 无 lit 项（makeSymbolAbs 不产 term），bigint 有 lit 项但
 * ToNumber 恒抛，都必须按 shape 硬抛 TypeError。缺省 / undefined / null /
 * number / string / bool 字面量 → 可折叠（交给 toIOI / toIntegerOrInfinityLit）；
 * 抽象 obj/fn/brand/sum/any/unknown/tuple/arr → recordMayThrow（可能为
 * symbol/bigint 或 coercer 产 symbol——node 实测 charAt({valueOf(){return 1n}}) 抛）；
 * 抽象 prim（number/string/bool，symbol/bigint 已在上面硬抛）ToNumber 恒
 * total → 不打 may（wave 10 精化：受约束 number 参数不得假报 may）。
 */
export function validateIndexArg(v: Abs | undefined, cause: string): void {
  if (v === undefined) return;
  if (isSymbolAbs(v)) throw new NudoThrow(errorTypeAbs("TypeError"));
  const s = v.shape as { k?: string; type?: string };
  if (s.k === "prim" && s.type === "bigint") {
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  if (s.k === "prim") return;
  if (v.term?.op === "lit") return;
  recordMayThrow({ kind: "TypeError", cause });
}

/** 从 map/filter/reduce 回调实参里取出 Abs（Identifier 已绑定或直接 Abs） */
export function asAbs(v: unknown): Abs | undefined {
  if (v && typeof v === "object" && "shape" in (v as object)) return v as Abs;
  return undefined;
}
