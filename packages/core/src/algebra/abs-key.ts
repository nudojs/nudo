/**
 * Abs 稳定结构键（leaf）：shape × term × pred 的单一序列化实现。
 *
 * 历史上有三个各自为政的键面——
 *   1. `objects.ts::absShapeKey`（join / 槽相等 / env 去重）
 *   2. `abs-fn.ts::absStableKey`（relationFn 指纹）
 *   3. `generalize-key.ts::absKeyInner`（instantiate 记忆键，带 α-rename）
 * 字段覆盖互有缺口（holes / fn slots / optionalParams / ctor / obj 槽标志 /
 * eff rejected / brand tv），同一结构在不同缓存面上的可观察性不一致。
 * 本模块是唯一实现；三个消费面只做薄包装。
 *
 * 纪律：
 * - 只序列化**值语义**字段：shape（结构）、term（身份）、pred（约束）。
 *   conf / pathNote 是置信度与展示信息，不进键（需要精确相等的调用方
 *   自行比较 conf，如 objects.ts::sameOptionalAbs）。
 * - 环安全：seen 按**当前递归路径**记账（进栈/出栈）。DAG 共享的兄弟子树
 *   不误判为环（结构相等的两份图无论是否共享对象，键相同）；真正回到
 *   祖先时才记 "cycle"。
 * - 用户可控字符串（对象槽名 / 形参名 / 函数名 / brand 名）用 JSON 引号
 *   包裹：闭合引号是自定界边界，`a,b` / `a`+`b` 不会撞键。
 * - 不读任何侧表（fn impl 身份 / proto / accessor）——纯结构键跨对象身份
 *   稳定；fn 实现身份只在 makeSum 去重面由 objects.ts::sumDedupeKey 附加。
 */
import type { Abs, Shape } from "./abs.ts";
import type { Term } from "./term.ts";
import { litKeyString } from "./term.ts";
import type { Pred } from "./pred.ts";

/** α-rename 映射（term 变元 id → 规范名） */
export type VarRename = ReadonlyMap<string, string>;

// ---------------------------------------------------------------------------
// term / pred
// ---------------------------------------------------------------------------

export function termKey(t: Term, rename?: VarRename): string {
  switch (t.op) {
    case "lit":
      // -0/0 身份不同：键走 litKeyString（String(-0)==="0" 会折叠）
      return `L:${typeof t.value}:${litKeyString(t.value)}`;
    case "var":
      return `V:${rename?.get(t.id) ?? t.id}`;
    case "app":
      return `A:${t.fn}(${t.args.map((a) => termKey(a, rename)).join(",")})`;
  }
}

/** L2：and/or 子约束按键排序，交换律不造成 miss */
export function predKey(p: Pred, rename?: VarRename): string {
  switch (p.op) {
    case "true":
      return "T";
    case "false":
      return "F";
    case "eq":
    case "ne":
    case "lt":
    case "le":
    case "gt":
    case "ge":
      return `${p.op}(${termKey(p.a, rename)},${termKey(p.b, rename)})`;
    case "and":
    case "or": {
      const keys = p.args.map((a) => predKey(a, rename)).sort();
      return `${p.op}(${keys.join(",")})`;
    }
    case "not":
      return `not(${predKey(p.arg, rename)})`;
    case "typeof":
      return `typeof(${termKey(p.t, rename)},${p.type})`;
    case "assumeFinite":
      return `assumeFinite(${termKey(p.t, rename)})`;
  }
}

// ---------------------------------------------------------------------------
// shape
// ---------------------------------------------------------------------------

/** obj 槽标志位（顺序固定：?, r, i, h, s）。键名由 JSON 引号自定界。 */
type SlotFlagFields = {
  optional?: boolean;
  readonly?: boolean;
  internal?: boolean;
  inherited?: boolean;
  symbolKey?: boolean;
};

function slotFlags(slot: SlotFlagFields): string {
  return `${slot.optional ? "?" : ""}${slot.readonly ? "r" : ""}${
    slot.internal ? "i" : ""
  }${slot.inherited ? "h" : ""}${slot.symbolKey ? "s" : ""}`;
}

/**
 * Shape 结构键。
 *
 * 覆盖字段（与 abs.ts::Shape 一一对应）：
 * - obj：slots（value + optional/readonly/internal/inherited/symbolKey）、
 *   index{key,value}、open
 * - tuple：elements、rest、**holes**（[1,,3] ≠ [1, undefined, 3]）
 * - fn：params、name、paramTypes、returnType、slots（value + optional/
 *   readonly）、**optionalParams**、**ctor**
 * - brand：name、shape、ctor、tv
 * - eff：eff、inner、rejected、unsettled
 * - arr：element；sum：members（保序——联合语义等价，但保序避免结果面漂移）
 */
export function shapeKey(
  s: Shape,
  seen: Set<object>,
  rename?: VarRename,
): string {
  switch (s.k) {
    case "never":
    case "any":
    case "unknown":
      return s.k;
    case "prim":
      return `p:${s.type}`;
    case "brand": {
      const ctor = s.ctor ? ";ctor" : "";
      const tv = s.tv === undefined ? "" : `;tv:${s.tv}`;
      return `b:${JSON.stringify(s.name)}(${absKey(s.shape, seen, rename)})${ctor}${tv}`;
    }
    case "eff": {
      const rejected = s.rejected
        ? `;rej(${absKey(s.rejected, seen, rename)})`
        : "";
      const unsettled = s.unsettled ? ";unsettled" : "";
      return `e:${s.eff}<${absKey(s.inner, seen, rename)}>${rejected}${unsettled}`;
    }
    case "arr":
      return `arr(${absKey(s.element, seen, rename)})`;
    case "tuple": {
      const els = s.elements
        .map((e) => absKey(e, seen, rename))
        .join(",");
      const rest = s.rest ? `...${absKey(s.rest, seen, rename)}` : "";
      // holes 必须进键：[1,,3] 与 [1, undefined, 3] 可观察不同
      const holes =
        s.holes && s.holes.length > 0
          ? `;holes:${[...s.holes].sort((a, b) => a - b).join(",")}`
          : "";
      return `tup[${els}${rest}${holes}]`;
    }
    case "fn": {
      const pts = (s.paramTypes ?? [])
        .map((t) => absKey(t, seen, rename))
        .join(",");
      const ret = s.returnType ? absKey(s.returnType, seen, rename) : "?";
      const name = s.name === undefined ? "" : `#${JSON.stringify(s.name)}`;
      const params = s.params.map((p) => JSON.stringify(p)).join(",");
      // expando 槽 / 可省略位 / 可构造性都是**可观察**面：
      // - `g.x = 1` vs `g.x = 2` 的 g 不能因同名同参同键；
      // - optionalParams 影响必选元数；ctor 影响 `new` 的可构造性。
      const slots = s.slots
        ? `{${Object.keys(s.slots)
            .sort()
            .map((k) => {
              const slot = s.slots![k]!;
              return `${JSON.stringify(k)}${slotFlags(slot)}:${absKey(
                slot.value,
                seen,
                rename,
              )}`;
            })
            .join(",")}}`
        : "";
      const opt = s.optionalParams
        ? `;opt:${s.optionalParams.map((b) => (b ? "1" : "0")).join("")}`
        : "";
      const ctor = s.ctor === undefined ? "" : `;ctor:${s.ctor}`;
      return `fn${name}(${params}|${pts})=>${ret}${slots}${opt}${ctor}`;
    }
    case "sum":
      return `sum(${s.members
        .map((m) => absKey(m, seen, rename))
        .join("|")})`;
    case "obj": {
      const slots = Object.keys(s.slots)
        .sort()
        .map((k) => {
          const slot = s.slots[k]!;
          return `${JSON.stringify(k)}${slotFlags(slot)}:${absKey(
            slot.value,
            seen,
            rename,
          )}`;
        })
        .join(",");
      const idx = s.index
        ? `idx(${absKey(s.index.key, seen, rename)}→${absKey(
            s.index.value,
            seen,
            rename,
          )})`
        : "";
      const open = s.open ? ";open" : "";
      return `obj{${slots}}${idx}${open}`;
    }
  }
}

// ---------------------------------------------------------------------------
// Abs 键
// ---------------------------------------------------------------------------

/**
 * Abs 结构键 = shape + term + pred（不含 conf / pathNote）。
 *
 * term 是值身份：`lit(undefined)` 与「无 term」可观察不同，字面量 -0/0
 * 也不同（litKeyString）。pred 即使为 `true` 也保留——显式 `@true` 与
 * 无约束在部分算术/窄化路径依赖 pred 存在性，保守区分（只减少命中，
 * 不会合并不同值）。
 */
export function absKey(
  a: Abs,
  seen: Set<object> = new Set(),
  rename?: VarRename,
): string {
  if (seen.has(a)) return "cycle";
  seen.add(a);
  try {
    const t = a.term ? `=${termKey(a.term, rename)}` : "";
    const p = a.pred ? `@${predKey(a.pred, rename)}` : "";
    return `${shapeKey(a.shape, seen, rename)}${t}${p}`;
  } finally {
    seen.delete(a);
  }
}
