/**
 * dts 类型拓宽管线：形参逆变 widen、返回位顶层 widen、模块值 widen。
 *
 * 从 dts-generator 抽出。所有函数只依赖 Abs / ProjectionBudget 与 IR 渲染，
 * 不读投影上下文。
 */
import type { Abs } from "@nudojs/core";
import {
  abs as makeAbs,
  anyAbs,
  lookupObjAccessor,
  provenanceOf,
  unknown,
} from "@nudojs/core";
import { ProjectionBudget } from "@nudojs/core/internal";
import { absToTSTypeIr } from "./dts-context.ts";

export function slotAbsOf(a: Abs, k: string, fallback: Abs): Abs {
  // BUG-167：占位槽 `unknown` = 读域**不可判**（非纯 getter / defineProperty 装的
  // 访问器）⇒ 不得为投影执行用户 getter（分析期副作用 + 末次读被冻结成「确定值」
  // ⇒ dts 面自信错值）；直接投影 unknown。
  if (fallback.term === undefined) return fallback;
  const acc = lookupObjAccessor(a, k);
  if (!acc?.get) return fallback;
  try {
    return acc.get(a);
  } catch {
    return unknown;
  }
}

const CANONICAL_INDEX = /^(?:0|[1-9]\d*)$/;

export function widenParamAbs(a: Abs, budget: ProjectionBudget = new ProjectionBudget()): Abs {
  // DESIGN-001：环 / 超深时原样返回（widen 是尽力精度剥离，不是正确性必需）；
  // 类型 IR 的预算会在同位置给出显式截断标记。
  const stop = budget.enter(a);
  if (stop) return a;
  try {
    const widened = widenParamAbsInner(a, budget);
    // facets（生成器元素域 / 数组视图身份 / 迭代器协议）随 Abs 携带，widen 造
    // 新身份时会丢 ⇒ 元素域退回 shape 数字槽，`Generator<number | string>` 塌成
    // `Generator<unknown>`。拓宽只该剥精度，不该丢身份。
    return a.facets !== undefined && widened !== a && widened.facets === undefined
      ? { ...widened, facets: a.facets }
      : widened;
  } finally {
    budget.exit();
  }
}

export function widenParamAbsInner(a: Abs, budget: ProjectionBudget): Abs {
  const s = a.shape;
  switch (s.k) {
    case "prim":
      return makeAbs(s, undefined, undefined, "exact");
    case "tuple": {
      const widened = s.elements.map((el) => widenParamAbs(el, budget));
      // rest 槽必须透传/并入：`[1, ...string]` 不得塌成 `number[]`（拒绝合法值）
      const widenedRest = s.rest ? widenParamAbs(s.rest, budget) : undefined;
      const holes = s.holes;
      const first = widened[0];
      // holes 必须透传：洞/显式 undefined 是可观察不同的（`in` / Object.keys），
      // 同构退化成 array 会把稀疏位抹平成稠密元素。
      // rest 参与同构判定：只有 rest 元素与固定位同型时才退化（`[1, ...number]` → number[]）。
      if (
        !holes?.length &&
        first &&
        widened.length > 0 &&
        widened.every((el) => absToTSTypeIr(el) === absToTSTypeIr(first)) &&
        (!widenedRest || absToTSTypeIr(widenedRest) === absToTSTypeIr(first))
      ) {
        return makeAbs({ k: "arr", element: first }, undefined, undefined, "exact");
      }
      return makeAbs(
        {
          k: "tuple",
          elements: widened,
          ...(widenedRest ? { rest: widenedRest } : {}),
          ...(holes?.length ? { holes: [...holes] } : {}),
        },
        undefined,
        undefined,
        "exact",
      );
    }
    case "arr":
      return makeAbs({ k: "arr", element: widenParamAbs(s.element, budget) }, undefined, undefined, "exact");
    case "obj": {
      const slots: Record<
        string,
        {
          value: Abs;
          optional?: boolean;
          readonly?: boolean;
          internal?: boolean;
          symbolKey?: boolean;
        }
      > = {};
      for (const [k, slot] of Object.entries(s.slots)) {
        // Bug 191：访问器键的槽是 `$lit(void 0)` 占位——**先**取 getter 读域
        // 再 widen（本分支造新对象，侧表按对象身份键控，造新后读域即丢）。
        const src = slotAbsOf(a, k, slot.value);
        // 数组视图的**下标**槽承担位置语义（渲染成元组）；`index` / `input` /
        // `groups` 这类伴生槽是引擎协议字段（每次调用的读值），不参与位置
        // 语义 ⇒ 原样保留（否则 `RegExpExecArray` 的 `index: 0` 被抹成
        // `index: number`，与产物里其余槽的口径不一致）。
        const sideSlot = s.view === "array" && !CANONICAL_INDEX.test(k) && k !== "length";
        slots[k] = {
          value: sideSlot ? src : widenParamAbs(src, budget),
          ...(slot.optional ? { optional: true } : {}),
          // BUG-233：只读标记**透传**（由声明面写入，见
          // `overlayObjectFnAnnotations`）——widen 造新槽时丢了它，getter-only
          // 就会被发布成可写。
          ...(slot.readonly === true ? { readonly: true } : {}),
          // Bug 240：internal / symbolKey 标记必须**透传**——widen 造新槽时丢了
          // 标记 ⇒ 内部槽（私有字段 / 生成器协议槽）被"提权"成用户可见字段
          // （`"#priv": number` / `"@@iterator": …`），产物面泄漏内部实现细节。
          ...(slot.internal === true ? { internal: true } : {}),
          ...(slot.symbolKey === true ? { symbolKey: true } : {}),
        };
      }
      return makeAbs(
        {
          k: "obj",
          slots,
          // BUG-258：数组视图 facet 必须透传——widen 造新 shape 时丢掉它 ⇒
          // 形参位投影回对象字面量类型（`.map` TS2339）。
          ...(s.view !== undefined ? { view: s.view } : {}),
          // BUG-383：open 对象的值域（groupBy / fromEntries 的 index 签名）
          // 必须随 widen 透传，否则 dts 退化成空对象。
          ...(s.open === true ? { open: true } : {}),
          ...(s.index !== undefined
            ? {
                index: {
                  key: widenParamAbs(s.index.key, budget),
                  value: widenParamAbs(s.index.value, budget),
                },
              }
            : {}),
        },
        undefined,
        undefined,
        "exact",
      );
    }
    case "eff":
      return makeAbs(
        { k: "eff", eff: s.eff, inner: widenParamAbs(s.inner, budget) },
        undefined,
        undefined,
        "exact",
      );
    case "brand":
      return makeAbs(
        { k: "brand", name: s.name, shape: widenParamAbs(s.shape, budget) },
        undefined,
        undefined,
        "exact",
      );
    case "sum":
      return makeAbs(
        { k: "sum", members: s.members.map((m) => widenParamAbs(m, budget)) },
        undefined,
        undefined,
        "exact",
      );
    default:
      return a;
  }
}

/**
 * 返回位拓宽：**观测值不是函数的类型**。
 *
 * 旧口径（BUG-206）只剥顶层标量字面量，依据是「返回位协变，收窄只让调用方
 * 拿到更精确的类型」。这个前提对**可变容器**不成立——观测到的元组 / 对象槽
 * 字面量是**一次调用**快照：
 * - `r1(): ["a"]` 让消费方 `r1()[1]` / `r1().push("b")` 报 TS2493 / TS2345；
 * - `r3(): { a: 1 }` 让消费方 `r3().a = 2` 报 TS2322（每次调用返回新对象）。
 *
 * `deep`（纯观测证据：call@ / entry@ 见证）⇒ 与形参位共用同一条拓宽管线
 * （`widenParamAbs`）：同构元组 → 数组、对象槽递归到基类型。
 * 作者写下的 `@nudo:case` 是**域声明**而不是观测 ⇒ 维持「嵌套精度保留」
 * （位置语义真实，字面量精度由 JSDoc 的 `Case:` 行承担）。
 *
 * BUG-209：`never` 是「这次观测抛了」的事实，不是返回类型（抛出已由独立的
 * `throws` 面表达）。把它发布成底类型会**同时**制造假红（成员访问 TS2339）
 * 与假绿（可赋给任意类型）；没有声明层证据时回到无信息域 `unknown`。
 */
/**
 * BUG-362：OOB 合成 undefined 臂是引擎的**内部**精度产物（`conf=partial` +
 * `lit(undefined)`），不是函数出口域。对外 dts 投影删除该臂；真实
 * `undefined`（作者 return / 缺失 return）的 term 同为 lit(undefined)，但
 * conf 不是 partial ⇒ 保留。
 */
function isSyntheticOobAbs(a: Abs): boolean {
  if (provenanceOf(a) === "synthetic") return true;
  return (
    a.conf === "partial" &&
    a.shape.k === "unknown" &&
    a.term?.op === "lit" &&
    a.term.value === undefined
  );
}

function stripSyntheticOobArms(a: Abs): Abs {
  if (a.shape.k === "sum") {
    const members = a.shape.members
      .filter((m) => !isSyntheticOobAbs(m))
      .map((m) => stripSyntheticOobArms(m));
    if (members.length === 0) return a;
    if (members.length === 1) return members[0]!;
    return { ...a, shape: { k: "sum", members } };
  }
  if (a.shape.k === "arr") {
    const element = stripSyntheticOobArms(a.shape.element);
    return element === a.shape.element ? a : { ...a, shape: { k: "arr", element } };
  }
  if (a.shape.k === "tuple") {
    let changed = false;
    const elements = a.shape.elements.map((m) => {
      const w = stripSyntheticOobArms(m);
      if (w !== m) changed = true;
      return w;
    });
    return changed ? { ...a, shape: { ...a.shape, elements } } : a;
  }
  return a;
}

export function widenReturnAbs(a: Abs, deep: boolean): Abs {
  if (a.shape.k === "never") return unknown;
  const widened = stripSyntheticOobArms(deep ? widenParamAbs(a) : widenTopLevelAbs(a));
  // BUG-252：返回位的**空数组字面量**观测 `[]` 不能发布成 0 长元组（消费方
  // `.push("x")` 报 TS2345 `never`）——与模块值通道同口径退化成 `unknown[]`。
  if (
    widened.shape.k === "tuple" &&
    widened.shape.elements.length === 0 &&
    widened.shape.rest === undefined
  ) {
    return { ...widened, shape: { k: "arr", element: anyAbs }, term: undefined, pred: undefined };
  }
  return widened;
}

/** 返回位（协变）：仅顶层（含 sum 成员）标量字面量 → 基类型，嵌套精度保留 */
export function widenTopLevelAbs(a: Abs): Abs {
  if (a.shape.k === "sum") {
    return makeAbs(
      { k: "sum", members: a.shape.members.map(widenTopLevelAbs) },
      undefined,
      undefined,
      a.conf,
    );
  }
  return widenLiteralToPrimAbs(a);
}

export function widenLiteralToPrimAbs(a: Abs): Abs {
  if (a.term?.op === "lit" && a.term.value === null) return a;
  if (a.term?.op === "lit" && a.term.value === undefined) return a;
  if (a.term?.op === "lit" && a.shape.k === "prim") {
    const v = a.term.value;
    if (
      typeof v === "number" ||
      typeof v === "string" ||
      typeof v === "boolean" ||
      typeof v === "bigint"
    ) {
      return makeAbs(a.shape, undefined, undefined, a.conf);
    }
  }
  return a;
}

/**
 * Bug 72：模块级**值绑定**通道的拓宽（与返回位 `widenObservedReturnAbs`、
 * 参数位 `widenParamAbs` 对应，但目标是可变容器的基类型形态）。
 *
 * `widenTopLevelAbs` 只拓宽顶层 prim lit ⇒ `config.retries: 3` /
 * `empty: []` / `nums: [1,2,3]` 把可写绑定说成冻结字面量，消费端对
 * `config.retries = 5` / `empty.push(1)` / `nums[0] = 9` 报 TS2322 / TS2345。
 * 复用参数位的递归 widen（同构元组 → 数组、对象槽递归到基类型），再补两处：
 * - 空元组（`const x = []`）⇒ `unknown[]`（否则 `.push` 参数恒 `never`）；
 * - 保留随值携带的 `facets`（生成器身份 / 元素域）——widen 造新 Abs 时丢了。
 */
export function widenModuleValueAbs(a: Abs): Abs {
  const widened = widenParamAbs(a);
  let out: Abs =
    a.facets !== undefined && widened.facets === undefined
      ? { ...widened, facets: a.facets }
      : widened;
  if (out.shape.k === "tuple" && out.shape.elements.length === 0 && !out.shape.rest) {
    out = {
      ...out,
      shape: { k: "arr", element: anyAbs },
      term: undefined,
      pred: undefined,
      conf: "exact",
    };
  }
  // BUG-237：**异构**元组退化成数组（元素域并集）。形参位的「异构元组保留」
  // 是真实的位置语义（实参要按位对上），但这里是 `export const` 的**可变
  // 数组绑定**：`[1, "a"]` 在 tsc 里是 `(string | number)[]`，发成定长
  // `[number, string]` 会让消费方的元素改写 / 越界读 / 异构替换全部假红
  // （TS2322 / TS2493 / TS2353）。同构元组在上一步 `widenParamAbs` 已退化成
  // `T[]`；`as const` 绑定不走本函数（冻结元组按 BUG-140 保留）。
  if (out.shape.k === "tuple") {
    out = { ...out, shape: { k: "arr", element: tupleElementDomain(out.shape) } };
  }
  return out;
}

/**
 * BUG-237：元组的元素域并集（按渲染文本去重，保持声明顺序）。
 * 洞（稀疏位）读值是 `undefined` ⇒ 域里必须含它。
 */
function tupleElementDomain(t: { elements: Abs[]; rest?: Abs; holes?: number[] }): Abs {
  const members: Abs[] = [];
  const seen = new Set<string>();
  const push = (m: Abs): void => {
    const key = absToTSTypeIr(m);
    if (seen.has(key)) return;
    seen.add(key);
    members.push(m);
  };
  for (const el of t.elements) push(el);
  if (t.holes?.length) push(unknown);
  if (t.rest) push(t.rest.shape.k === "arr" ? t.rest.shape.element : t.rest);
  return members.length === 1 ? members[0]! : makeAbs({ k: "sum", members }, undefined, undefined, "exact");
}

/**
 * rest 位类型：必须是**数组**类型（TS2370：A rest parameter must be of an
 * array type）——非 arr（sum/fn/prim…）提升为 `(T)[]`（sum/fn 成员带括号）。
 */
/**
 * pred → 字面量值集合（`eq(self, lit(v))` 口径）。
 *
 * 手写契约的返回域在 Abs 里是「prim + eq(self, lit(v)) pred」（core 的
 * `constraintToEntryAbs` 形态）——**字面量在 pred 里，不在 term 里** ⇒
 * 只看 term 的 widen 路径永远看不到它（`lit(42)` → `number`）。
 *
 * - `eq(self, lit(v))` ⇒ `[v]`
 * - `and(…)` ⇒ 各合取项的**交集**（只有一个字面量时才收窄）
 * - `or(…)` ⇒ 各析取项的并集（任一项不是字面量 eq ⇒ undefined：域不是有限集）
 * - 其它 pred（`gt` / `ne` / `typeof` …）⇒ undefined
 */
