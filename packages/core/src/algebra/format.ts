/**
 * 格式化：把 Abs 渲染成人类可读 / CLI 友好的字符串。
 */

import type { Abs, Shape } from "./abs.ts";
import { litValue } from "./abs.ts";
import type { Term, LiteralValue } from "./term.ts";
import { termEquals, termToString } from "./term.ts";
import type { Pred } from "./pred.ts";
import { predToString } from "./pred.ts";
import { ProjectionBudget, PROJECTION_MAX_DEPTH } from "./projection-budget.ts";
import { accessorReadDomain } from "./accessors.ts";
import { canonicalArrayIndex } from "./objects.ts";

export type FormatOptions = {
  /** 是否显示 term= */
  showTerm?: boolean;
  /** 是否显示 pred */
  showPred?: boolean;
  indent?: string;
};

export function formatAbs(a: Abs, opts: FormatOptions = {}): string {
  const showTerm = opts.showTerm !== false;
  const showPred = opts.showPred !== false;
  const parts: string[] = [];

  parts.push(formatShape(a));

  if (showTerm && a.term && a.term.op !== "lit") {
    parts.push(`= ${termToString(a.term)}`);
  }
  if (showPred && a.pred && a.pred.op !== "true") {
    parts.push(`where ${predToString(a.pred)}`);
  }
  parts.push(`#${a.conf}`);
  // C2.4：分支 join 来源（hover / --verbose 报告可见）
  if (a.pathNote) {
    parts.push(a.pathNote);
  }
  return parts.join("  ");
}

/** fn/arr 槽位：shape + 非 lit term（禁止在 format 里内联复制 term 逻辑） */
export function formatShapeSlot(a: Abs): string {
  return formatShapeSlotB(a, new ProjectionBudget());
}

/**
 * fn 契约槽位的**内部占位名**（constraint.ts 生成：`x${i}` / `ret`）——不是用户
 * 面信息。Bug 349：回显出来长成 TS 默认参数 `(number = x0) => number = ret`，
 * 与用户源码无关。关系 fn 槽位的 α 名（A1/B1…）**照旧回显**（hof-relation
 * 的既有口径：relation 槽位带 α 身份是有意义的）。
 */
function isFnSlotPlaceholderTerm(id: string): boolean {
  return id === "ret" || /^x\d+$/.test(id);
}

function formatShapeSlotB(
  a: Abs,
  budget: ProjectionBudget,
  ind: string = "",
  suppressTerm: boolean = false,
): string {
  const base = formatShapeB(a, budget, ind);
  if (!a.term || a.term.op === "lit") return base;
  // 关系在 paramTypes/returnType 或 element 里，外层 term 是形参 α 身份，不重复展示
  // （否则 items: arr(A1) 会变成 arr(A1) = A1）
  if (a.shape.k === "fn" || a.shape.k === "arr") return base;
  // Bug 349：fn 形状的**内层槽位**（paramTypes / returnType）不回显内部占位
  // term——契约 fn 的槽位 term 是 constraint.ts 的占位名（`x${i}` / `ret`），
  // 回显出来像 TS 默认参数。只压占位名，α 名（A1/B1）保留。
  if (
    suppressTerm &&
    a.term.op === "var" &&
    isFnSlotPlaceholderTerm(a.term.id)
  ) {
    return base;
  }
  // any + var → 直接打 term id（A1，而不是 any = A1）
  if (a.shape.k === "any" && a.term.op === "var") return termToString(a.term);
  return `${base} = ${termToString(a.term)}`;
}

/** 环 / 超深 shape 的截断标记（format 无 dropped 台账——标记本身即观测） */
const FORMAT_TRUNC = { cycle: "…cycle", depth: "…" } as const;

export function formatShape(
  a: Abs,
  opts?: { maxDepth?: number; showLits?: boolean; pretty?: boolean },
): string {
  const budget = new ProjectionBudget(opts?.maxDepth ?? PROJECTION_MAX_DEPTH);
  budget.showLits = opts?.showLits === true;
  budget.pretty = opts?.pretty === true;
  return formatShapeB(a, budget);
}

/** eq(self, lit(v)) pred 的字面量值——lit 判别槽位渲染
 * （`lit('StringLiteral')`——与侧车契约文法同形）；pred 断言
 * Abs 自身 term（槽位为 `get(p, k)` 字段项，顶层为参数
 * 项）等于字面量；非该形态 pred / 无 pred → undefined
 * （纯 shape 渲染不变） */
function litPredValue(a: Abs): LiteralValue | undefined {
  if (a.term === undefined) return undefined;
  // eq 事实可藏在合取深层（$narrowMemberEq 的 keep 臂槽精化挂 and(既有, eq)）
  const conjuncts: Pred[] = [];
  const visit = (p: Pred | undefined): void => {
    if (p === undefined) return;
    if (p.op === "and") {
      p.args.forEach(visit);
      return;
    }
    conjuncts.push(p);
  };
  visit(a.pred);
  for (const p of conjuncts) {
    if (p.op !== "eq") continue;
    const { a: x, b: y } = p;
    const litT =
      x.op === "lit" && termEquals(y, a.term)
        ? x
        : y.op === "lit" && termEquals(x, a.term)
          ? y
          : undefined;
    if (litT !== undefined) return litT.value;
  }
  return undefined;
}

function formatShapeB(a: Abs, budget: ProjectionBudget, ind: string = ""): string {
  // DESIGN-001：Abs 可环可深（`a.self = a` 在 evaluator 下是真环），
  // 展示层必须有界；截断渲染显式标记而非栈溢出。
  const stop = budget.enter(a);
  if (stop === "cycle") return FORMAT_TRUNC.cycle;
  if (stop === "depth") return FORMAT_TRUNC.depth;
  try {
    return formatShapeInner(a, budget, ind);
  } finally {
    budget.exit();
  }
}

/** pretty 断行的复合 shape（union 臂断行条件——map/set 即 brand） */
const PRETTY_COMPOSITE_SHAPES = new Set(["obj", "arr", "tuple", "fn", "brand", "eff"]);

/**
 * Bug 240：**投影面剔除 internal 槽**（内部槽对属性 introspection 不可见）。
 *
 * `Slot.internal`（Bug 84 私有槽机制）是仓里既有的「该槽不是自有属性」标记：
 * 枚举面 / 自有面早已过滤它（`builtins/invariants.ts` 的 `enumOwnKeys`、
 * `builtins/object/methods.ts` 的 `enumKeys`、`builtins/json.ts` 的序列化
 * 面），但**投影面**（本文件）此前不过滤 ⇒ 签名面把内部实现细节当用户
 * 可见属性发布（生成器对象的 `next` / `return` / `throw` / `constructor` /
 * `@@iterator` 五个协议槽）。
 *
 * 例外：**规范数组下标槽**保留——族 01 的建模口径里生成器的数字下标槽承载
 * **元素域**（签名面靠它发布元素域面：`eval-spread-iter-elems` 钉住
 * `"0": string`），不是内部实现细节 ⇒ 不在此剔除。
 */
function isHiddenInternalSlot(k: string, slot: { internal?: boolean }): boolean {
  return slot.internal === true && canonicalArrayIndex(k) === undefined;
}

/**
 * 字面量值 → JS 字面量拼法（`JSON.stringify` 对 bigint **直接抛**、
 * 对 NaN / ±Infinity 印成 `null`、对 -0 抹成 `0`）——渲染面不能崩，
 * 也不能把「另一个值」印出来（Bug 361）。
 */
function formatLitValue(v: LiteralValue): string {
  if (typeof v === "bigint") return `${String(v)}n`;
  if (typeof v === "number" && !Number.isFinite(v)) return String(v);
  if (typeof v === "number" && Object.is(v, -0)) return "-0";
  return JSON.stringify(v) ?? "undefined";
}

/**
 * Bug 403 / 404：**需要分组括号**的形状判定。
 *
 * `fn` 的文本（`(a) => b`）后面直接接后缀时，按 TS 解析规则后缀绑定到
 * **函数的返回类型**而不是外层容器：
 * - `arr(fn)` → `(a) => b[]` 被读成「返回 `b[]` 的函数」（应是「函数数组」）
 * - `sum(fn, n)` → `(a) => b | n` 被读成「返回 `b | n` 的函数」（应是「函数或 n」）
 *
 * ⇒ `fn` 出现在「后面还要接后缀」的位置（数组元素 / union 成员）时必须加括号。
 * dts 面（`absToTSType`）对同一形态**已经**加了括号 ⇒ 两个渲染器此前对同一
 * Abs 给出两种读法（`formatShape` 面是坏渲染）。
 *
 * ⚠ 裁决范围：**只对 `fn`**（403 / 404 的实测证据只涉及 `fn`）。`brand` /
 * `obj` / `tuple` 的同类缺口**不在本片范围**（见族 09 勘察报告的越界发现）。
 */
function needsGrouping(shape: Shape): boolean {
  return shape.k === "fn";
}

function formatShapeInner(a: Abs, budget: ProjectionBudget, ind: string): string {
  const s = a.shape;
  switch (s.k) {
    case "never":
      return "never";
    case "any":
      return "any";
    case "unknown": {
      // lit undefined / lit null（缺键 / Map miss / null 字面量）必须展示为
      // 自己的名字，不能与真 unknown 混淆。litValue 哨兵对 lit(undefined) 也是
      // undefined，须直接看 term。
      if (a.term?.op === "lit") {
        if (a.term.value === undefined) return "undefined";
        if (a.term.value === null) return "null";
      }
      return "unknown";
    }
    case "prim": {
      const lvR = litValue(a);
      const lv = lvR.ok ? lvR.value : undefined;
      // JSON.stringify(NaN|±Infinity) is "null" — keep JS literal spelling.
      if (typeof lv === "number" && !Number.isFinite(lv)) return String(lv);
      // -0 与 0 可观察不同（1/x、Object.is）；JSON.stringify(-0)==="0" 会抹掉
      if (typeof lv === "number" && Object.is(lv, -0)) return "-0";
      // JSON.stringify(bigint) throws；按 JS 字面量拼法展示
      if (typeof lv === "bigint") return `${String(lv)}n`;
      if (lvR.ok) return JSON.stringify(lv);
      if (budget.showLits) {
        const plv = litPredValue(a);
        if (plv !== undefined) return `lit(${formatLitValue(plv)})`;
      }
      return s.type;
    }
    case "obj": {
      // Bug 240：internal 槽不进投影面（内部槽不是自有属性）——规范数组
      // 下标槽除外（承载元素域，族 01 口径）。
      const entries = Object.entries(s.slots)
        .filter(([k, slot]) => !isHiddenInternalSlot(k, slot))
        .map(([k, slot]) => {
          const opt = slot.optional ? "?" : "";
          // 非标识符键 JSON 引号，避免展示串本身不可解析（`a, b: 1`）
          const key = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k) ? k : JSON.stringify(k);
          // Bug 191：访问器键的槽是 `$lit(void 0)` 占位（真 getter 住侧表）——
          // 投影须取 getter 读域，否则把 getter 的返回值谎报成 exact undefined。
          const slotAbs = accessorReadDomain(a, k) ?? slot.value;
          let val = formatShapeB(slotAbs, budget, `${ind}  `);
          if (budget.showLits) {
            const plv = litPredValue(slotAbs);
            if (plv !== undefined) val = `lit(${formatLitValue(plv)})`;
          }
          return `${key}${opt}: ${val}`;
        });
      // pretty：每槽一行 + 尾逗号 + 2 空格缩进递增（值内嵌套以槽位
      // 行起点为基准列——悬挂式对齐）；空 obj 保持单行（与默认口径同形）
      if (budget.pretty && entries.length > 0) {
        return `{\n${entries.map((e) => `${ind}  ${e},`).join("\n")}\n${ind}}`;
      }
      return `{ ${entries.join(", ")} }`;
    }
    case "arr": {
      // any+var 元素 → arr(A1)（展示关系）；否则 element[]
      if (s.element.shape.k === "any" && s.element.term?.op === "var") {
        return `arr(${formatShapeSlotB(s.element, budget, ind)})`;
      }
      // Bug 34：union 元素加括号——`3 | 1 | 2[]` 按 TS 解析歧义为
      // 3 | 1 | (2[])（sort/flatMap 元素 join 的 arr(sum) 面）；单 prim/
      // lit 元素保持 `X[]` 不加冗余括号
      // Bug 403：**函数元素**同样要加括号——`(a) => b[]` 按 TS 解析歧义为
      // 「返回 `b[]` 的函数」；`fn` 元素走 needsGrouping 判定（union 判定保留）
      const el = formatShapeB(s.element, budget, ind);
      return s.element.shape.k === "sum" || needsGrouping(s.element.shape)
        ? `(${el})[]`
        : `${el}[]`;
    }
    case "tuple": {
      // hole 槽是稀疏空位（`1 in a` 为 false），不得渲染成 undefined 槽
      const holes = s.holes ?? [];
      const parts = s.elements.map((el, i) =>
        holes.includes(i) ? "" : formatShapeB(el, budget, ind),
      );
      if (s.rest) {
        parts.push(`...${formatShapeB(s.rest, budget, ind)}`);
      }
      return `[${parts.join(", ")}]`;
    }
    case "fn": {
      // Bug 349：fn 的内层槽位（paramTypes / returnType）不回显 term——
      // 契约 fn 的槽位 term 是内部占位名（`x${i}` / `ret`），不是用户面信息。
      const ret =
        s.returnType !== undefined ? formatShapeSlotB(s.returnType, budget, ind, true) : "?";
      const labels = s.params ?? [];
      const paramTypes = s.paramTypes;
      const hasMarkers = labels.some(
        (p) => p.startsWith("...") || p.endsWith("?"),
      );

      // Rest (`...paths`) / optional (`options?`) labels win over raw paramTypes
      // so env signatures do not over-declare Node variadic/optional arity.
      const renderLabeled = (): string[] => {
        const ps: string[] = [];
        const n = paramTypes ? Math.max(paramTypes.length, labels.length) : labels.length;
        for (let i = 0; i < n; i++) {
          const label = labels[i];
          const type = paramTypes?.[i];
          const typeText =
            type !== undefined ? formatShapeSlotB(type, budget, ind, true) : undefined;
          if (label?.startsWith("...")) {
            ps.push(typeText ? `...${label.slice(3)}: ${typeText}` : label);
          } else if (label?.endsWith("?")) {
            ps.push(typeText ? `${label.slice(0, -1)}?: ${typeText}` : label);
          } else if (typeText !== undefined) {
            ps.push(typeText);
          } else if (label) {
            ps.push(label);
          }
        }
        return ps;
      };

      if (hasMarkers) {
        return `(${renderLabeled().join(", ")}) => ${ret}`;
      }
      if (paramTypes && paramTypes.length > 0) {
        const ps = paramTypes.map((p) => formatShapeSlotB(p, budget, ind, true));
        return `(${ps.join(", ")}) => ${ret}`;
      }
      return `(${labels.join(", ")}) => ${ret}`;
    }
    case "brand": {
      // Map/Set/WeakMap 泛型参数（harvest 的 __key/__value/__elem 槽）
      const inner = s.shape as Abs;
      const slots = inner && inner.shape && inner.shape.k === "obj" ? inner.shape.slots : undefined;
      if (slots) {
        const arg = (key: string): string | undefined => {
          const sl = slots[key];
          return sl ? formatShapeSlotB(sl.value, budget, ind) : undefined;
        };
        if (s.name === "Map" || s.name === "ReadonlyMap" || s.name === "WeakMap") {
          const k = arg("__key");
          const v = arg("__value");
          if (k !== undefined && v !== undefined) return `${s.name}<${k}, ${v}>`;
        }
        if (s.name === "Set" || s.name === "ReadonlySet" || s.name === "WeakSet") {
          const el = arg("__elem");
          if (el !== undefined) return `${s.name}<${el}>`;
        }
      }
      return `${s.name}`;
    }
    case "eff":
      return `${s.eff}<${formatShapeB(s.inner, budget, ind)}>`;
    case "sum": {
      // 渲染去重：不同 term/pred 的成员可能渲染成同一形状（例如两条 number
      // 路径）——formatShape 是有损外延视图，重复文本只留一次；formatAbs
      // 仍保留全部成员（无损）。
      const seen = new Set<string>();
      const parts: string[] = [];
      const kinds: string[] = [];
      for (const m of s.members) {
        const t = formatShapeB(m, budget, ind);
        if (seen.has(t)) continue;
        seen.add(t);
        // Bug 404：**函数成员**加括号——`(a) => b | n` 按 TS 解析歧义为
        // 「返回 `b | n` 的函数」（`|` 被函数的返回类型吃掉）；去重 key 仍用
        // **未包裹**的文本（避免把 `fn` 成员与别的成员误去重）
        parts.push(needsGrouping(m.shape) ? `(${t})` : t);
        kinds.push(m.shape.k);
      }
      // pretty：仅当至少一臂是复合 shape（object/array/map/set/fn——
      // map/set 即 brand）或其渲染含 `{` 时按臂断行（` | ` 前缀换行，
      // 臂缩进与首臂起点对齐）；纯 prim/lit 联合保持单行
      // （`string | null | undefined` 不断）
      if (
        budget.pretty &&
        parts.some((t, i) => PRETTY_COMPOSITE_SHAPES.has(kinds[i]!) || t.includes("{"))
      ) {
        return parts.join(`\n${ind}| `);
      }
      return parts.join(" | ");
    }
    default:
      return "·";
  }
}

/** 多行展示，CLI 用 */
export function formatAbsMultiline(a: Abs, label?: string): string {
  const lines: string[] = [];
  if (label) lines.push(label);
  lines.push(`  ${formatShape(a)}`);
  if (a.term && a.term.op !== "lit") {
    lines.push(`  term: ${termToString(a.term)}`);
  }
  if (a.pred && a.pred.op !== "true") {
    lines.push(`  pred: ${predToString(a.pred)}`);
  }
  lines.push(`  conf: ${a.conf}`);
  return lines.join("\n");
}
