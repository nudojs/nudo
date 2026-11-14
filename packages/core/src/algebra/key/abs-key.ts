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
 * - 只序列化**值语义**字段：shape（结构）、term（身份）、pred（约束），
 *   以及**非空**的 Abs 槽位容器（A2+A8 / A10 / A11，可观察面，同 A6 的
 *   overloads 纪律）。空容器 ≡ 缺省，不进键。
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
import type { Abs, AbsFacets, Shape } from "../abs.ts";
import type { Term } from "../term.ts";
import { litKeyString } from "../term.ts";
import type { Pred } from "../pred.ts";
import { FACET_KEY_VERSION, FACET_SPECS, facetKeys } from "./facet-specs.ts";

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
    case "app": {
      // 字符串累加代替 `args.map(...).join(",")`：**逐字节同输出**，每个 app 键
      // 少一次数组分配。`termKey` 是冷路径最热点（120 文件全量分析实测 6709 万次
      // 调用；CPU 栈 `termKey`/旧 `termToString` 约 37–41%、GC 约 24%），
      // 2026-11-12 干净 env 实测 cold 13.3s → 10.0s（≈−25%），RSS 不变。
      // ⚠ 曾试过 WeakMap 按 Term 身份缓存无 rename 的键（重复率 75% 看似诱人）：
      // 查找开销 + 常驻字符串反而让 cold 升到 21.6s / RSS 881 MiB ⇒ **不要回退
      // 到缓存路线**；等价性回归见 term-key-serialization.test.ts。
      let out = `A:${t.fn}(`;
      for (let i = 0; i < t.args.length; i++) {
        if (i > 0) out += ",";
        out += termKey(t.args[i]!, rename);
      }
      return `${out})`;
    }
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
      // A6：重载集是可观察的派发面——不同重载集不得共享 memo/fingerprint。
      const ovl = s.overloads
        ? `;ovl:[${s.overloads
            .map(
              (o) =>
                `${o.paramTypes.map((t) => absKey(t, seen, rename)).join(",")}=>${absKey(o.returnType, seen, rename)}`,
            )
            .join(";")}]`
        : "";
      return `fn${name}(${params}|${pts})=>${ret}${slots}${opt}${ctor}${ovl}`;
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
/**
 * 槽位容器的稳定键。字段顺序固定（不依赖对象属性顺序），键集数组按声明序
 * 保留（键集语义本身有序）；缺省不出现 ⇒ 旧键逐字节不变。
 * 与 A6 的 `overloads` 同纪律：槽位是**可观察面**，不同槽位不得共享 memo。
 *
 * ABS-15：逐槽位编码由 `key/facet-specs.ts::FACET_SPECS` 的 `kind` 决定
 * （新增槽位不登记即编译红）；本函数只保留「kind → 片段」的解释器，新增
 * kind 的打红点在这里的 `never` 兜底。
 */
export function facetKey(f: AbsFacets): string {
  const parts: string[] = [];
  for (const key of facetKeys()) {
    const spec = FACET_SPECS[key];
    const value = f[key];
    if (value === undefined) continue;
    switch (spec.kind) {
      case "flag":
        parts.push(`${spec.prefix}:${value ? 1 : 0}`);
        break;
      case "string":
        parts.push(`${spec.prefix}:${JSON.stringify(value)}`);
        break;
      case "string-array-record": {
        const rec = value as NonNullable<AbsFacets["protoOwnKeys"]>;
        parts.push(
          `${spec.prefix}:${JSON.stringify(rec.strings)}:${JSON.stringify(rec.symbols ?? [])}`,
        );
        break;
      }
      // A11 残余：TReturn / TNext / 静态元素域是 Abs ⇒ 必须走结构键
      // （JSON.stringify 会撞环且丢 term/pred），否则不同返回域 / 元素域的
      // 生成器共享 memo / 指纹。
      case "abs-ref":
        parts.push(`${spec.prefix}:${absKey(value as Abs)}`);
        break;
      case "abs-list":
        parts.push(`${spec.prefix}:${(value as Abs[]).map((e) => absKey(e)).join("|")}`);
        break;
      default: {
        // 新增 FacetSpec kind 未实现 ⇒ 编译期红（不得静默漏编槽位）。
        const unhandled: never = spec;
        throw new Error(`unregistered facet kind: ${String(unhandled)}`);
      }
    }
  }
  // 候选 3：版本前缀。空容器恒 ""（空 ≡ 缺省的既有不变量）。
  return parts.length === 0 ? "" : `v${FACET_KEY_VERSION}:${parts.join(",")}`;
}

/**
 * ABS-05：conf 摘要（与 `absKey` 同一遍历顺序的置信度序列）。
 *
 * 为什么键要**完整**包含嵌套 conf：缓存命中的结果继承了被缓存那一轮的
 * conf。只编码顶层会把「同一结构、不同嵌套置信度」的实参折成同一键 ⇒
 * 实际精度被另一份输入的置信度顶替（`#exact` 冒充 `#widened`）。
 */
function confDigest(a: Abs, out: string[], seen: Set<object>): void {
  if (seen.has(a)) {
    out.push("cycle");
    return;
  }
  seen.add(a);
  try {
    out.push(a.conf);
    const s = a.shape;
    switch (s.k) {
      case "brand":
        confDigest(s.shape, out, seen);
        break;
      case "eff":
        confDigest(s.inner, out, seen);
        if (s.rejected) confDigest(s.rejected, out, seen);
        break;
      case "arr":
        confDigest(s.element, out, seen);
        break;
      case "tuple":
        for (const e of s.elements) confDigest(e, out, seen);
        if (s.rest) confDigest(s.rest, out, seen);
        break;
      case "fn":
        for (const t of s.paramTypes ?? []) confDigest(t, out, seen);
        if (s.returnType) confDigest(s.returnType, out, seen);
        for (const k of Object.keys(s.slots ?? {}).sort()) {
          confDigest(s.slots![k]!.value, out, seen);
        }
        for (const o of s.overloads ?? []) {
          for (const t of o.paramTypes) confDigest(t, out, seen);
          confDigest(o.returnType, out, seen);
        }
        break;
      case "sum":
        for (const m of s.members) confDigest(m, out, seen);
        break;
      case "obj":
        for (const k of Object.keys(s.slots).sort()) {
          confDigest(s.slots[k]!.value, out, seen);
        }
        if (s.index) {
          confDigest(s.index.key, out, seen);
          confDigest(s.index.value, out, seen);
        }
        break;
      default:
        break;
    }
    if (a.facets) {
      if (a.facets.genReturn) confDigest(a.facets.genReturn, out, seen);
      if (a.facets.genNext) confDigest(a.facets.genNext, out, seen);
      for (const e of a.facets.genElements ?? []) confDigest(e, out, seen);
    }
  } finally {
    seen.delete(a);
  }
}

/**
 * ABS-05：带置信度的结构键——`absKey` + 结构化 conf 摘要。
 *
 * **不替换**默认 `absKey`：默认键的契约是不含 conf / pathNote（结构相等
 * 口径，`objects.ts` 的 join 去重 / env 去重依赖它）。只有确认「结果继承
 * 输入 conf」的缓存消费方（如 generalize 的 instantiate memo）才用本键，
 * 避免跨 conf 共享导致精度被顶替。
 */
export function absKeyWithConf(
  a: Abs,
  seen: Set<object> = new Set(),
  rename?: VarRename,
): string {
  const confs: string[] = [];
  confDigest(a, confs, new Set());
  return `${absKey(a, seen, rename)};c[${confs.join(",")}]`;
}

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
    // 空容器 ≡ 缺省：不进键，保证「无槽位」的旧键逐字节不变。
    const fk = a.facets ? facetKey(a.facets) : "";
    const f = fk ? `;f{${fk}}` : "";
    return `${shapeKey(a.shape, seen, rename)}${t}${p}${f}`;
  } finally {
    seen.delete(a);
  }
}
