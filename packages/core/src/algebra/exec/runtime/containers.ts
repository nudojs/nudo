/**
 * 数组 / 对象运行时：$arr/$idx/$len/$arrMutContainer 与 $obj/$get/$set/$spread。
 */
import type { Abs } from "../../abs.ts";
import { abs, bool, boolLit, confJoin, litValue, numLit, str, strLit, unknown, type Confidence } from "../../abs.ts";
import { lit, type Term } from "../../term.ts";
import type { Phi } from "../../pred.ts";
import { pTrue, and, predEquals, ge } from "../../pred.ts";
import { absFunction, getFnImpl, hostFnCtorFacet } from "../../abs-fn.ts";
import {
  joinAbs, objOf, isObj, spread as spreadObj, type ObjShape, type Slot,
  isNullProtoObj, migrateNullProto, getSlot, setSlot, setProtoAbs,
  canonicalArrayIndex, propertyKeyOf,
} from "../../objects.ts";
import {
  isMapAbs, isSetAbs, setElementsAbs, collectionExactLen,
  mapEntriesAbs, mapSizeAbs, setSizeAbs,
} from "../../collections.ts";
import { shouldWidenArrayLiteral, widenedArrayConf, TUPLE_MATERIALIZE_CAP } from "../../containers.ts";
import { registerMatchIter, registerTplElements, matchIterElements } from "../match-iter.ts";
import {
  evalNamespaceCall, extStateOf, getPropFlags, migrateInvariants, enumOwnKeys,
  regexBrandAbsFrom, evalObjectProtoMethod, objectProtoMethodAbs,
  isObjectProtoBrand, OBJECT_PROTO_METHOD_NAMES, isSymbolAbs,
  symbolDescriptionAbs, objectProtoBrand, builtinCtorAbs, ctorNameOfRecv,
  protoBrandAbs, notePromiseExecutorFork,
} from "../../builtins.ts";
import { arrayMethodAbs } from "../../builtins/array.ts";
import { validateCallableArg, validateIndexArg } from "../../hof.ts";
import {
  noteUnknownMemberMissing, noteObjSlotMissing,
  noteAnyMemberMayThrow, noteNullishMemberThrows, isNullishAbs, anyMemberResult,
  STRING_METHODS,
  NUMBER_PROTO_METHODS,
  BOOLEAN_PROTO_METHODS,
  SYMBOL_PROTO_METHODS,
  BIGINT_PROTO_METHODS,
} from "../member-diag.ts";
import { errorTypeAbs, recordMayThrow, type MayThrowEffect } from "../may-throw.ts";
import { getEvalClass } from "../class-registry.ts";
import { classNameOfValue, markClassValue } from "../../class-mark.ts";
import {
  NudoThrow, undef, oobUndef, isOobUndef, throwStrictWrite, writeInPlace, clearStaleTermPred,
  asAbsVal, $lit, litTruth, isDefinitelyTrue, isDefinitelyFalse, currentExecPhi,
  isNudoReturn, isNudoBreak, isNudoContinue, $fnVal, $rawThis, noBody, confPartialPacked,
} from "./state.ts";
import { $unknown, $toNumber, $eq, $ne, $typeof, $add, $sub } from "./ops.ts";
import { lookupObjAccessor, migrateAccessors, $objAccessor, findClassAccessor, findStaticClassAccessor, $in, $instanceof, $del, accessorTable, BUILTIN_BRAND_METHODS, evalClassChain } from "./members.ts";
import { DEFAULT_MAX_LOOP_ITERS, MAX_CONCRETE_LOOP_ITERS, LOOP_TRUNCATION_LABEL } from "./loop-budget.ts";
import { makeLoopWidener } from "./loop-widen.ts";
import { noteAbsTruncation } from "../../call-budget.ts";
import { isNudoThrow, callAtFunctionBoundary } from "./state.ts";
import { $call } from "../call.ts";

// 数组
// --- 数组 ---

/**
 * 私有名接收者校验（Bug 78 "#" 混淆键设计）：原生
 * PrivateFieldGet/Set/PrivateCall 要求接收者是**声明该私有名的
 * 类**的实例，否则 TypeError。私有名是类作用域——不经继承链
 * （子类实例不含父类私有名）。
 * - brand：自有槽（私有字段/静态字段）/ 私有访问器 / 私有方法
 *   命中即声明类实例；否则确定 foreign receiver → 硬抛。
 * - prim/eff/fn/tuple/arr：绝非类实例 → 硬抛。
 * - obj/any/sum：抽象对象可能是声明类实例 → may TypeError。
 * 公有名零开销（首字符前缀判定）。
 */
export function privateNameGuard(o: unknown, key: string): void {
  if (key.charCodeAt(0) !== 35 /* # */) return;
  if (!o || typeof o !== "object" || !("shape" in (o as object))) {
    // 宿主值作私有名接收者：原生 TypeError（私有名语法只可达
    // 类实例；泄漏宿主值时 fail-closed 硬抛）
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  const s = (o as Abs).shape;
  if (s.k === "brand") {
    const inner = s.shape;
    if (inner?.shape.k === "obj") {
      const slot = getSlot(inner.shape.slots, key);
      if (slot && !slot.optional) return; // 声明的私有字段
    }
    const spec = getEvalClass(s.name);
    if (!spec) throw new NudoThrow(errorTypeAbs("TypeError"));
    if (classNameOfValue(o as object) === s.name) {
      // 类值接收者：私有静态成员（静态槽/静态访问器/静态方法；
      // 声明的静态字段——$staticInit 初始化期槽尚未存在）
      if (
        spec.staticAccessors?.[key] ||
        spec.staticMethods?.[key] ||
        (spec.statics !== undefined && key in spec.statics)
      ) {
        return;
      }
    } else {
      // 实例接收者：私有实例成员。私有名沿构造链安装到子类
      // 实例（InitializeInstanceElements 逐类执行——父类私有
      // 字段/方法会物化到子类实例）——声明检查沿类链；槽上
      // 已物化字段在上方命中，此处补覆盖初始化期尚未物化的
      // 声明字段/访问器/方法（applyInstanceFields 写父类字段
      // 时接收者品牌是子类名）
      for (const n of evalClassChain(s.name)) {
        const sup = getEvalClass(n);
        if (
          sup?.accessors?.[key] ||
          sup?.methods?.[key] ||
          sup?.instanceFields?.some((f) => f.name === key)
        ) {
          return;
        }
      }
    }
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  if (
    s.k === "prim" ||
    s.k === "eff" ||
    s.k === "fn" ||
    s.k === "tuple" ||
    s.k === "arr"
  ) {
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  if (s.k === "obj" || s.k === "any" || s.k === "sum") {
    recordMayThrow({
      kind: "TypeError",
      cause: `private member ${key} on receiver that may not declare it`,
    });
  }
  // unknown：fail-closed 令牌，不记（与 $call/$in 口径一致）
}

/** 容器策略单点（containers.ts）：≤cap → tuple；>cap → arr（元素 join，path） */
export function tupleOrWiden(els: Abs[], conf: Confidence): Abs {
  if (shouldWidenArrayLiteral(els.length)) {
    return abs(
      { k: "arr", element: els.reduce((x, y) => joinAbs(x, y)) },
      undefined,
      undefined,
      widenedArrayConf(),
    );
  }
  return abs({ k: "tuple", elements: els }, undefined, undefined, conf);
}

/** 数组字面量 → ≤cap tuple（逐元素精确）/ >cap arr；策略与 containers.ts 同源 */
export function $arr(items: Abs[]): Abs {
  return tupleOrWiden(items.map(asAbsVal), "exact");
}

/**
 * `arguments` 对象 → 类数组 tuple（$len/$idx 投影 length/下标；typeof 为 "object"）。
 * strict/ESM 与形参**独立映射**：写 `arguments[i]` 不改形参，写形参不改 `arguments`。
 * （sloppy 非严格是 mapped arguments object，二者互相写回——Nudo 分析按 ESM/strict。）
 * 与 rest 绑定解耦：rest 仍从真实 `arguments`/rest 形参收集，本对象只服务用户写的 `arguments`。
 */
export function $arguments(items: ArrayLike<unknown>): Abs {
  const n = typeof items?.length === "number" && items.length > 0 ? items.length : 0;
  const els: Abs[] = new Array(n);
  for (let i = 0; i < n; i++) els[i] = asAbsVal((items as ArrayLike<unknown>)[i]);
  return abs({ k: "tuple", elements: els }, undefined, undefined, "exact");
}

/**
 * 带空洞的数组字面量（[1,,3]）：hole 槽位置为 undefined 值但 `in` 判定 false。
 * 超 cap 退化 arr 时丢弃 hole 精度（元素 join，长度语义已由 arr 承接）。
 */
export function $arrWithHoles(items: Abs[], holes: number[]): Abs {
  const base = $arr(items);
  if (holes.length === 0 || base.shape.k !== "tuple") return base;
  return abs({ k: "tuple", elements: base.shape.elements, holes }, undefined, undefined, base.conf);
}

export const ARR_MUTATORS = new Set([
  "push",
  "unshift",
  "pop",
  "shift",
  "splice",
  "reverse",
  "sort",
  "copyWithin",
  "fill",
]);

export function isArrMutator(name: string): boolean {
  return ARR_MUTATORS.has(name);
}

/**
 * Bug 44：签名符号执行的 rest 形参注入哨兵。generalize 的零实参符号调用
 * 对每个形参恰好注入 1 个合成实参——rest 形参会塌缩成固定 1 元组（假
 * 具体值：`sigLen(...r) => 1`）。签名面注入开放数组 Abs（arr(any)、
 * 长度无上界），rest 绑定（$restBind）识别哨兵直通；真实调用永不携带
 * （保留字 var term id——用户面/α 空间（"A1" 标签系）不可构造，且经
 * $copy 快照存活——Symbol 键标记会被 callTranspiledExportFull 的 D1
 * 副本剥掉）。
 */
const SYMBOLIC_REST_VAR = "Ωnudo-symbolic-restΩ";

export function makeSymbolicRestAbs(): Abs {
  return abs(
    { k: "arr", element: abs({ k: "any" }, undefined, undefined, "path") },
    { op: "var", id: SYMBOLIC_REST_VAR },
    pTrue,
    "partial",
  );
}

export function isSymbolicRestAbs(a: unknown): boolean {
  if (!a || typeof a !== "object" || !("shape" in (a as object))) return false;
  const t = (a as Abs).term;
  return (
    (a as Abs).shape.k === "arr" &&
    t !== undefined &&
    t.op === "var" &&
    t.id === SYMBOLIC_REST_VAR
  );
}

/**
 * rest 形参绑定（Bug 44）：收集 namedCount 之后的实参包 $arr（长度保持
 * 原生——真调用面）；唯一元素是符号注入哨兵时直通开放数组（签名面）。
 */
export function $restBind(list: ArrayLike<unknown>, namedCount: number): Abs {
  const rest = Array.prototype.slice.call(list, namedCount) as unknown[];
  if (rest.length === 1 && isSymbolicRestAbs(rest[0])) return rest[0] as Abs;
  return $arr(rest as Abs[]);
}

/**
 * C1.4 语句重绑：返回**变更后容器** Abs（不是 JS 返回值）。
 * `a.pop()` 语句应把 `a` 绑成去掉末元的 tuple，而不是被移除的元素。
 */
/** ToIntegerOrInfinity（±Infinity 保持）；返回：数字=可折叠 / null=实参不可判定 / undefined=缺省或显式 undefined（取默认值） */
export function toIOI(v: Abs | undefined): number | null | undefined {
  if (v === undefined) return undefined; // 实参缺省（数组越界）
  const lvR = litValue(v);
  const lv = lvR.ok ? lvR.value : undefined;
  if (lv === undefined) {
    // 显式 undefined 字面量 → 按缺省（copyWithin/fill 规范：undefined end 取 len）
    return v.term?.op === "lit" ? undefined : null;
  }
  if (lv === null) return 0;
  if (typeof lv === "number") {
    if (Number.isNaN(lv)) return 0;
    return Math.trunc(lv);
  }
  if (typeof lv === "string" || typeof lv === "boolean") {
    // ToIntegerOrInfinity：ToNumber 后 NaN→0（'abc'/'-' 等非数字字符串）
    const n = Number(lv);
    if (Number.isNaN(n)) return 0;
    return Math.trunc(n);
  }
  return null; // bigint/symbol/抽象 → 不可判定
}

/** 规范窗口（len 相对化 + clamp）；target≥len 或空窗 → null（no-op） */
export function clampWindow(
  len: number,
  target: number,
  start: number,
  end: number,
): { t: number; s: number; e: number } | null {
  const t = target < 0 ? Math.max(len + target, 0) : Math.min(target, len);
  const s = start < 0 ? Math.max(len + start, 0) : Math.min(start, len);
  const e = end < 0 ? Math.max(len + end, 0) : Math.min(end, len);
  if (t >= len || s >= len) return null;
  const count = Math.min(e - s, len - t);
  if (count <= 0) return null;
  return { t, s, e: s + count };
}

export function copyWithinTuple(
  shape: { k: "tuple"; elements: Abs[]; holes?: number[] } | { k: "arr"; element: Abs },
  vals: Abs[],
): Abs {
  // Bug 56：target/start/end 三个下标位经 ToIntegerOrInfinity——symbol/bigint
  // 确定 TypeError；抽象 → may（空接收者同样先校验，再进窗口投影）
  validateIndexArg(vals[0], "copyWithin target may not be convertible to a number");
  validateIndexArg(vals[1], "copyWithin start may not be convertible to a number");
  validateIndexArg(vals[2], "copyWithin end may not be convertible to a number");
  const t = toIOI(vals[0]);
  const s = toIOI(vals[1]);
  const e = toIOI(vals[2]);
  if (shape.k === "tuple") {
    if (t === null || s === null || e === null) {
      // 不可判定边界：任一槽可能被写 → 元素 join 回退（sound）
      const joined = shape.elements.length
        ? shape.elements.reduce((x, y) => joinAbs(x, y))
        : unknown;
      return abs({ k: "arr", element: joined }, undefined, undefined, "partial");
    }
    const len = shape.elements.length;
    const win = clampWindow(len, t ?? 0, s ?? 0, e ?? len);
    const origHoles = shape.holes ?? [];
    if (win) {
      const els = [...shape.elements];
      const holesSet = new Set(origHoles);
      // 重叠且源在目标之后：按规范倒序复制。
      // ES copyWithin step 11 用**相对解析后**的 from/to（win.s/win.t）比较
      // （from < to && from+count > to）。此前用原始 toIOI 的 s/t，负下标会翻方向：
      //   [0,1,2,3,4].copyWithin(1,-3) 原生 [0,2,3,4,4]（from=2>to=1 正序）。
      const backwards = win.s < win.t && win.s + (win.e - win.s) > win.t;
      const count = win.e - win.s;
      // 源存在性按**原始** holes 快照判定（集合在循环中会变）
      for (let kk = 0; kk < count; kk++) {
        const k = backwards ? count - 1 - kk : kk;
        const from = win.s + k;
        const to = win.t + k;
        const present = from < len && !origHoles.includes(from);
        if (present) {
          els[to] = els[from]!;
          holesSet.delete(to);
        } else {
          // 源 hole/越界：删除目标槽（ES2023 DeletePropertyOrThrow）
          els[to] = $lit(undefined);
          holesSet.add(to);
        }
      }
      const holes = [...holesSet];
      return abs(
        { k: "tuple", elements: els, holes: holes.length > 0 ? holes : undefined },
        undefined,
        undefined,
        "path",
      );
    }
    // 合法边界但 no-op（如 target≥len）：保持 tuple 与 holes
    return abs(
      {
        k: "tuple",
        elements: [...shape.elements],
        holes: origHoles.length > 0 ? [...origHoles] : undefined,
      },
      undefined,
      undefined,
      "path",
    );
  }
  // 抽象 arr：copyWithin 保持元素类型（sound）
  return abs({ k: "arr", element: shape.element }, undefined, undefined, "partial");
}

export function fillTuple(
  shape: { k: "tuple"; elements: Abs[]; holes?: number[] } | { k: "arr"; element: Abs },
  vals: Abs[],
  arr: Abs,
): Abs {
  // Bug 56：start/end 下标位经 ToIntegerOrInfinity 校验；vals[0]（value 实参）
  // 不校验——原生存储不转换（fill(Symbol()) 合法）
  validateIndexArg(vals[1], "fill start may not be convertible to a number");
  validateIndexArg(vals[2], "fill end may not be convertible to a number");
  const v = vals[0] ?? unknown;
  const s = toIOI(vals[1]);
  const e = toIOI(vals[2]);
  if (shape.k === "tuple") {
    const len = shape.elements.length;
    if (s === null || e === null) {
      // 不可判定边界：任一槽可能被写 → 元素 join 回退；hole 可能被写实，
      // 保守清空 holes（`in` 不得折 false 而原生已写实）
      return abs(
        { k: "tuple", elements: shape.elements.map((el) => joinAbs(el, v)) },
        undefined,
        undefined,
        "partial",
      );
    }
    const start = Math.max(Math.min((s ?? 0) < 0 ? len + (s ?? 0) : (s ?? 0), len), 0);
    const end = Math.max(Math.min((e ?? len) < 0 ? len + (e ?? len) : (e ?? len), len), 0);
    const holes = (shape.holes ?? []).filter((h) => h < start || h >= end);
    if (end <= start) {
      return abs(
        { k: "tuple", elements: [...shape.elements], holes: holes.length > 0 ? holes : undefined },
        undefined,
        undefined,
        "path",
      );
    }
    const els = shape.elements.map((el, i) => (i >= start && i < end ? v : el));
    return abs(
      { k: "tuple", elements: els, holes: holes.length > 0 ? holes : undefined },
      undefined,
      undefined,
      "path",
    );
  }
  // arr（长度未知）：默认窗口 [0, len) 覆盖全数组 → 元素整体替换为 v
  //（`new Array(n).fill(0)` 的元素是精确 0，不是 unknown|0——DP 表
  // `d[i-1][j] + 1` 的算术臂不再带 unknown，issue #98）。start 必须显式
  // 0 或缺省——负 start 是长度相对的（[1,2,3].fill(0,-1) 只写末元素），
  // 未知长度下无法折整窗（review Blocker 2：负 start 折全替换丢元素域）；
  // end 非缺省同理保守 join。
  const coversAll = (s === undefined || s === 0) && e === undefined;
  return abs(
    { k: "arr", element: coversAll ? v : joinAbs(shape.element, v) },
    undefined,
    undefined,
    confJoin(arr.conf, coversAll ? arr.conf : "path"),
  );
}

/**
 * 深拷贝可变容器（fork/switch 快照与循环 pack 用）。
 * 容器写就地进行后（引用语义），分析分支/迭代的状态分离必须靠拷贝——
 * 浅引用快照会让臂间/迭代间互相污染。
 */
export function $copy(a: Abs): Abs {
  const s = a.shape;
  // 所有可能挂 extState/propFlags 的形状都必须迁移不变性侧表：
  // fork/switch 用 $copy 做快照，副本丢失 frozen/sealed 会让臂内写不再硬抛
  if (s.k === "tuple") {
    const next = abs(
      {
        k: "tuple",
        elements: s.elements.map($copy),
        // rest 槽必须随快照迁移（与 hof snapshotAbs 同口径），否则副本丢尾段
        ...(s.rest ? { rest: $copy(s.rest) } : {}),
        holes: s.holes ? [...s.holes] : undefined,
      },
      a.term,
      a.pred,
      a.conf,
    );
    migrateInvariants(a, next);
    return next;
  }
  if (s.k === "arr") {
    const next = abs({ k: "arr", element: $copy(s.element) }, a.term, a.pred, a.conf);
    migrateInvariants(a, next);
    return next;
  }
  if (s.k === "obj") {
    const slots: Record<string, Slot> = {};
    for (const [k, v] of Object.entries(s.slots)) {
      setSlot(slots, k, { ...v, value: $copy(v.value) });
    }
    const next = objOf(slots, {
      index: s.index ? { key: $copy(s.index.key), value: $copy(s.index.value) } : undefined,
      open: s.open,
    });
    next.conf = a.conf;
    // term/pred 随快照迁移（与 tuple/arr/sum/eff 分支及 snapshotAbs 同口径；
    // objOf 不带项位——此前 obj 副本丢项，导出桥 $copy 实参后递归各层的
    // callBudgetKey 指纹全坍缩成同键，父帧/子帧误判 cycle 截断 → unknown
    // 污染（issue #120 的 lazy 递归模板实测暴露）。
    next.term = a.term;
    next.pred = a.pred;
    migrateAccessors(a, next);
    migrateInvariants(a, next);
    migrateNullProto(a, next);
    return next;
  }
  if (s.k === "brand") {
    const inner = $copy(s.shape);
    const next = abs({ k: "brand", name: s.name, shape: inner }, a.term, a.pred, a.conf);
    const clsName = classNameOfValue(a as object);
    if (clsName) markClassValue(next as object, clsName);
    migrateInvariants(a, next);
    return next;
  }
  if (s.k === "eff") {
    const next = abs({ k: "eff", eff: s.eff, inner: $copy(s.inner) }, a.term, a.pred, a.conf);
    migrateInvariants(a, next);
    return next;
  }
  if (s.k === "sum") {
    return abs({ k: "sum", members: s.members.map($copy) }, a.term, a.pred, a.conf);
  }
  return a;
}

/** 数组/元组方法（push/pop/shift/unshift/splice/reverse/sort/copyWithin/fill）
 *  的就地 mutator：Abs 身份不变（JS 引用语义——`const b = a; b.push(4)` 对 a
 *  可见）；transpile 重绑 `a = $arrMutContainer(a, …)` 仍写回同一对象。 */
export function $arrMutContainer(arr: Abs, method: string, args: Abs[]): Abs {
  const shape = arr.shape;
  if (shape.k !== "tuple" && shape.k !== "arr") return arr;
  const st = extStateOf(arr);
  // frozen：任何 mutator 原生 TypeError（strict 硬抛）；
  // sealed/nonext：结构性扩展（push/unshift/splice 加元素）TypeError
  if (st === "frozen") throwStrictWrite();
  if (
    (st === "sealed" || st === "nonext") &&
    (method === "push" || method === "unshift" || method === "splice")
  ) {
    throwStrictWrite();
  }
  const vals = args.map((a) => asAbsVal(a));
  const asArrEl = (els: Abs[]): Abs =>
    els.length > 0 ? els.reduce((x, y) => joinAbs(x, y)) : unknown;
  // 就地写回：shape/conf 替换但 Abs 身份不变 → 别名（const b=a / 实参）同步；
  // 旧 term/pred 不再描述新 shape，一并清除
  const writeBack = (next: Abs): Abs => writeInPlace(arr, next);

  if (method === "push" || method === "unshift") {
    if (shape.k === "tuple") {
      const els =
        method === "push"
          ? [...shape.elements, ...vals]
          : [...vals, ...shape.elements];
      // holes 迁移：push 原下标不变；unshift 整体右移 vals.length
      const holes = shape.holes
        ? shape.holes.map((h) => (method === "push" ? h : h + vals.length))
        : undefined;
      const conf = vals.reduce(
        (acc, v) => confJoin(acc, v.conf),
        arr.conf as Confidence,
      );
      return writeBack(
        abs({ k: "tuple", elements: els, holes }, undefined, undefined, conf),
      );
    }
    const el = vals.reduce((acc, v) => joinAbs(acc, v), shape.element);
    return writeBack(
      abs({ k: "arr", element: el }, undefined, undefined, confJoin(arr.conf, "path")),
    );
  }
  if (method === "pop") {
    if (shape.k === "tuple") {
      if (shape.elements.length === 0) return arr;
      const newLen = shape.elements.length - 1;
      // 弹出末槽：holes 截断到新长度（末位是 hole 则随之消失）
      const holes = shape.holes
        ? shape.holes.filter((h) => h < newLen)
        : undefined;
      return writeBack(
        abs(
          { k: "tuple", elements: shape.elements.slice(0, -1), holes: holes && holes.length > 0 ? holes : undefined },
          undefined,
          undefined,
          arr.conf,
        ),
      );
    }
    return arr;
  }
  if (method === "shift") {
    if (shape.k === "tuple") {
      if (shape.elements.length === 0) return arr;
      // 移除首槽：holes 整体左移 1（0 号 hole 随之消失）
      const holes = shape.holes
        ? shape.holes.map((h) => h - 1).filter((h) => h >= 0)
        : undefined;
      return writeBack(
        abs(
          { k: "tuple", elements: shape.elements.slice(1), holes: holes && holes.length > 0 ? holes : undefined },
          undefined,
          undefined,
          arr.conf,
        ),
      );
    }
    return arr;
  }
  if (method === "splice") {
    // Bug 56：start/deleteCount 经 ToIntegerOrInfinity——symbol/bigint 下标
    // 确定 TypeError（空接收者同样先校验）；抽象 → may。values 实参不校验
    //（原生存储不转换）。此前分支完全不读实参。
    validateIndexArg(vals[0], "splice start may not be convertible to a number");
    validateIndexArg(vals[1], "splice deleteCount may not be convertible to a number");
    if (shape.k === "tuple") {
      return writeBack(
        abs(
          { k: "arr", element: asArrEl(shape.elements) },
          undefined,
          undefined,
          confJoin(arr.conf, "path"),
        ),
      );
    }
    return arr;
  }
  if (method === "reverse") {
    if (shape.k === "tuple") {
      // holes 随元素镜像翻转：新下标 = len - 1 - 原下标
      const len = shape.elements.length;
      const holes = shape.holes
        ? shape.holes.map((h) => len - 1 - h)
        : undefined;
      return writeBack(
        abs(
          { k: "tuple", elements: [...shape.elements].reverse(), holes },
          undefined,
          undefined,
          arr.conf,
        ),
      );
    }
    return arr;
  }
  if (method === "copyWithin") {
    return writeBack(copyWithinTuple(shape, vals));
  }
  if (method === "fill") {
    return writeBack(fillTuple(shape, vals, arr));
  }
  if (method === "sort") {
    // Bug 51：GetSortComparator——缺省/严格 undefined → 默认比较器；
    // null/prim/非可调用（含 symbol）→ 确定 TypeError；any/抽象 → may
    //（此前比较器实参完全未读）
    validateCallableArg(vals[0], "sort comparator may not be callable", {
      undefinedOk: true,
    });
    // 顺序未建模：位次不可信，tuple 降为 arr（元素 join），避免 a[0] 假精确
    if (shape.k === "tuple") {
      return writeBack(
        abs(
          { k: "arr", element: asArrEl(shape.elements) },
          undefined,
          undefined,
          confJoin(arr.conf, "path"),
        ),
      );
    }
    return arr;
  }
  return arr;
}

/** TypedArray brand 名 → 元素 prim（BigInt64/BigUint64 是 bigint，其余 number） */
const TYPED_ARRAY_ELEMENT: Record<string, "number" | "bigint"> = {
  Int8Array: "number",
  Uint8Array: "number",
  Uint8ClampedArray: "number",
  Int16Array: "number",
  Uint16Array: "number",
  Int32Array: "number",
  Uint32Array: "number",
  Float32Array: "number",
  Float64Array: "number",
  BigInt64Array: "bigint",
  BigUint64Array: "bigint",
};

/** 下标读 a[i]；规范数组下标走精确投影，确定非下标键 → undefined，否则并所有元素；string[i] → 单字符 */
export function $idx(
  a: Abs,
  i: Abs,
  opts?: { /** 调用方已排除 nullish 臂（可选链守卫跳）——不记 may-throw */ silent?: boolean },
): Abs {
  // DEC-006 B/C：非 Abs 目标 fail-closed unknown（禁止读 .shape 炸宿主 TypeError）
  if (!a || typeof a !== "object" || !("shape" in (a as object))) {
    return unknown;
  }
  // 计算成员读与 $get 同源的 throws 域守卫（Bug 12）：
  // nullish 接收者 → 原生 definite TypeError（ToObject）→ hard NudoThrow；
  // any 接收者 → may TypeError → 结果保持 any。silent 供可选链首跳
  //（`x?.[k]` 的非 nullish 臂已由 ?. 排除 nullish，访问非 nullish 值不抛）。
  if (isOobUndef(a)) return a; // OOB 合成 undefined：引擎精度产物，不记 may-throw（issue #98）
  if (noteNullishMemberThrows(a, "<computed>", "property")) {
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  // any 下标：无约束读（any ≠ unknown）
  if (a?.shape?.k === "any") {
    if (!opts?.silent) noteAnyMemberMayThrow(a, "<computed>", "property");
    return anyMemberResult();
  }
  // ToPropertyKey：null/undefined/boolean 字面量 → "null"/"undefined"/"true"…
  //（litValue 哨兵会把 lit(undefined) 吞成「无 lit」，不得走抽象下标）
  // 非字面量下标（var/app term）：键不可判定 → iv 保持 undefined（走抽象
  // 下标投影）——此前误用 litValue 的 {ok:false} 包装对象当「确定非下标键」，
  // 把 d[抽象i] 折成 exact undefined（issue #98 的嵌套读假抛根源）。
  const keyStr = propertyKeyOf(i);
  const iv = keyStr;
  const idx = iv !== undefined ? canonicalArrayIndex(iv) : undefined;
  if (a.shape.k === "tuple") {
    const els = a.shape.elements;
    // 确定非下标键（"foo"、1.5…）：缺失属性 → undefined
    if (iv !== undefined && idx === undefined) return undef();
    if (idx !== undefined) {
      if (idx < els.length) return els[idx]!;
      return undef();
    }
    // 抽象下标：可能命中任一元素，也可能越界/非下标 → 必须并入 undefined
    //（OOB marker——越界是抽象精度产物，下游嵌套读写不记 may-throw）
    if (els.length === 0) return oobUndef();
    return joinAbs(els.reduce((x, y) => joinAbs(x, y)), oobUndef());
  }
  if (a.shape.k === "arr") {
    if (iv !== undefined && idx === undefined) return undef();
    // 抽象下标可能 miss → 元素 ∪ undefined（与对象未知键同口径）；
    // 已知规范下标仍按元素投影（split()[0] 等非空序列链不断）
    if (idx === undefined) {
      return joinAbs(a.shape.element, oobUndef());
    }
    return a.shape.element;
  }
  // TypedArray brand：元素域 = 元素 prim ∪ undefined（长度未建模，下标可能
  // 越界；此前落 brand 内层空 obj → exact undefined，经 + 折 exact NaN）
  if (a.shape.k === "brand") {
    const elem = TYPED_ARRAY_ELEMENT[(a.shape as { name?: string }).name ?? ""];
    if (elem) {
      return joinAbs(
        abs({ k: "prim", type: elem }, undefined, undefined, "exact"),
        undef(),
      );
    }
  }
  if (a.shape.k === "sum") {
    // DEC-006：空 sum 成员 join 无单位元——不得裸 reduce。
    // sum 含 nullish 成员（exec 的 null|match 等）：整体不是 definite throw
    //（`if (!m) return` 守卫后的非空臂只读非空侧）→ 该成员记 may-throw
    // 且原样返回；silent（?. 守卫跳）不记效果。OOB marker 臂（抽象下标
    // 可能 miss 的合成 undefined）不记软记录——透传是有意的召回权衡：
    // 越界读本身不抛、读到的 undefined 再被计算读原生必抛 TypeError，
    // 而 marker 无法区分「循环不变量保证在界内」（#98 循环 DP 表，要零
    // 误报）与「真实无约束下标」（d[i][0] 原生 h(5) 必抛，穿门不报）——
    // 按类压制换 #98 零误报；理想收窄 = Φ 导出下标在界 pred（issue #98）。
    const parts = a.shape.members.map((m) => {
      if (isNullishAbs(m)) {
        if (!isOobUndef(m)) {
          if (!opts?.silent) {
            recordMayThrow({
              kind: "TypeError",
              cause: "computed member on nullish (union arm)",
            });
          }
        }
        // 原样返回（原折 undef()）：isOobUndef 臂需透传 marker 供下游嵌套
        // 读写识别；其余 nullish 臂保持用户域——无守卫 `X|null` 的计算
        // 访问结果域随之从 …|undefined 变 …|null。
        return m;
      }
      return $idx(m, i, opts);
    });
    return parts.length ? parts.reduce((x, y) => joinAbs(x, y)) : unknown;
  }
  // C1.3：对象 + key 投影；闭 shape miss / 未知 key 必须并入 undefined
  if (a.shape.k === "obj" || (a.shape.k === "brand" && a.shape.shape.shape.k === "obj")) {
    const objShape = (a.shape.k === "obj" ? a.shape : a.shape.shape.shape) as ObjShape;
    const slots = Object.values(objShape.slots).map((s) => s.value);
    if (slots.length === 0) return objShape.open ? unknown : undef();
    const joinSlotsWithUndef = (): Abs =>
      joinAbs(slots.reduce((x, y) => joinAbs(x, y)), undef());
    if (typeof iv === "string" || typeof iv === "number" || typeof iv === "boolean") {
      // getSlot：字面量键为 toString 等 Object.prototype 名时裸读踩原型链
      const slot = getSlot(objShape.slots, String(iv));
      if (slot) return slot.value;
      if (objShape.open) return unknown;
      // 闭 shape 字面量 key miss：键确定不存在 → 仅 undefined（与 $get / Map miss 一致）
      return undef();
    }
    if (objShape.open && slots.length > 0) {
      // open shape：已知槽 ∪ unknown
      return joinAbs(slots.reduce((x, y) => joinAbs(x, y)), unknown);
    }
    // 闭 shape 未知 key：已知槽 ∪ undefined（键可能不存在）
    return joinSlotsWithUndef();
  }
  // 字符串下标：s[i] → 第 i 个字符（字面量精确）。
  // 与元组同口径走 canonicalArrayIndex：s["1"] ≡ s[1]；s["foo"]/s[1.5]/s["01"]
  // 为缺失属性 → undefined（不得 unknown 掩掉）。
  const svR = litValue(a);
  const sv = svR.ok && typeof svR.value === "string" ? svR.value : undefined;
  if (typeof sv === "string") {
    if (i.term?.op !== "lit") return unknown;
    const idx = canonicalArrayIndex(i.term.value);
    if (idx === undefined) return undef();
    if (idx < sv.length) return $lit(sv[idx]!);
    return undef();
  }
  // Bug 3：抽象字符串接收者——s[n] 值域 = 单字符 | 越界 undefined（与
  // s.at(n)/s.charAt(n) 同域），此前落末尾 unknown。
  if (a.shape.k === "prim" && (a.shape as { type?: string }).type === "string") {
    return joinAbs(str(), undef());
  }
  return unknown;
}

/** 巨下标/巨 length 写入：不物化稀疏段（原生稀疏数组），就地降 arr 形状。
 *  元素域 = 已知元素 ∪ undefined（hole/延长槽读 undefined）∪ 写入值。 */
export function widenTupleToArr(
  els: Abs[],
  holes: number[] | undefined,
  value: Abs | undefined,
): { k: "arr"; element: Abs } {
  let joined: Abs = els.length > 0 ? els.reduce((x, y) => joinAbs(x, y)) : unknown;
  if (holes && holes.length > 0) joined = joinAbs(joined, undef());
  if (value !== undefined) joined = joinAbs(joined, value);
  return { k: "arr", element: joined };
}

/** 下标写 a[i]=v → 新 tuple（越界写按 JS 语义增长，空洞为 undefined） */
export function $idxSet(a: Abs, i: Abs, value: Abs): Abs {
  // DEC-006 B/C：非 Abs 目标 fail-closed（与 $set 同口径）
  if (!a || typeof a !== "object" || !("shape" in (a as object))) {
    return a;
  }
  // ToPropertyKey + 数值下标分流：
  // 数组写走数值 iv（1 / 1n / "1" 都是下标 1）；对象写走字符串键。
  // 不得只用 propertyKeyOf —— 那会把 1 变成 "1"，tuple 数值门失效（洞写丢失）。
  const pk = propertyKeyOf(i);
  const raw = i.term?.op === "lit" ? i.term.value : undefined;
  let numIdx: number | undefined;
  if (typeof raw === "number") numIdx = raw;
  else if (typeof raw === "bigint") numIdx = Number(raw);
  else if (pk !== undefined) numIdx = canonicalArrayIndex(pk);
  // 非字面量键（var/app term）→ iv undefined（对象走抽象键 open 路径）；
  // 此前误用 litValue 的 {ok:false} 包装对象，String(iv) 变 "[object Object]"
  const iv = pk;
  if (a.shape.k === "tuple" && numIdx !== undefined && Number.isInteger(numIdx) && numIdx >= 0) {
    const st = extStateOf(a);
    if (st === "frozen") throwStrictWrite(); // frozen 数组：下标写 TypeError
    if (
      (st === "sealed" || st === "nonext") &&
      numIdx >= a.shape.elements.length
    ) {
      throwStrictWrite(); // 不可扩展：越界写（新下标）TypeError
    }
    // i ≥ 2^32-1：非数组下标，原生是 expando 属性（length 不变、`i in a` 可见）。
    // 数组模型无 expando 槽：就地降 arr（读/keys/in 全保守），不得假精确
    if (numIdx >= 4294967295) {
      a.shape = widenTupleToArr(a.shape.elements, a.shape.holes, value);
      a.conf = confJoin(a.conf, "path");
      clearStaleTermPred(a);
      return a;
    }
    // 巨大合法下标：原生 length 增长到 iv+1 的稀疏数组；
    // 分析不物化巨 tuple（OOM/DoS），就地降 arr
    if (numIdx + 1 > TUPLE_MATERIALIZE_CAP) {
      a.shape = widenTupleToArr(a.shape.elements, a.shape.holes, value);
      a.conf = confJoin(a.conf, "path");
      clearStaleTermPred(a);
      return a;
    }
    const els = [...a.shape.elements];
    const holes = [...(a.shape.holes ?? [])];
    while (els.length < numIdx) {
      holes.push(els.length); // 越界写增长段是 hole（原生 [1].x=3 中间槽不存在）
      els.push(undef());
    }
    els[numIdx] = asAbsVal(value);
    // 写 hole 位置：槽被填实，清除 hole 标记
    const hi = holes.indexOf(numIdx);
    if (hi >= 0) holes.splice(hi, 1);
    // 就地写回：别名（const b=a）同步（JS 引用语义）
    a.shape = { k: "tuple", elements: els, holes: holes.length > 0 ? holes : undefined };
    clearStaleTermPred(a);
    return a;
  }
  // 非（整数下标 tuple）目标：按目标种类分派（strict/ESM 语义；此前一律
  // `return a` 静默——o[k]=v 计算键写对象假精确 no-op、空值/prim 不抛）
  const sk = a.shape.k;
  // OOB 合成 undefined 目标（抽象下标可能 miss 后的嵌套写，如 DP 表
  // `d[i][j] = v`）：越界是引擎精度产物，不据此硬抛 TypeError（issue #98）
  if (isOobUndef(a)) return a;
  if (sk === "prim" || sk === "never" || isNullishAbs(a)) throwStrictWrite();
  if (sk === "any") {
    noteAnyMemberMayThrow(a, iv === undefined ? "<computed>" : String(iv), "property");
    return a;
  }
  if (sk === "obj") {
    if (iv === undefined) {
      // 抽象键：无槽位模型——标记 open（缺失键读不再折 undefined 假精确）
      a.shape = { ...a.shape, open: true };
      a.conf = confJoin(a.conf, "path");
      clearStaleTermPred(a);
      return a;
    }
    return $set(a, String(iv), value);
  }
  if (sk === "brand") {
    if (iv === undefined) return a;
    // 仅用户类（注册表）委派 $set——内建 brand（TypedArray/String 包装等）
    // 下标写语义未建模，保持保守不写（差分抓到：Uint8Array 截断被写穿假精确）
    if (getEvalClass(a.shape.name)) return $set(a, String(iv), value);
    return a;
  }
  if (sk === "tuple") {
    // 非整数/抽象下标（expando 属性）：就地降 arr（长度/元素保持）
    a.shape = widenTupleToArr(a.shape.elements, a.shape.holes, value);
    a.conf = confJoin(a.conf, "path");
    clearStaleTermPred(a);
    return a;
  }
  return a;
}

/** $len 的非负 term/pred 备忘（同一接收者对象 → 同一 var，跨迭代稳定） */
const lenTermMemo = new WeakMap<Abs, Term>();
let lenVarSeq = 0;
/** 抽象长度：number + var term + pred ≥0（字符串/数组长度恒非负）。
 *  供 `new Array(len + 1)` 等消费（add 的 addPred 平移界 → ctor 证非负
 *  不再记 RangeError，issue #98）。 */
function abstractLen(a: Abs): Abs {
  let t = lenTermMemo.get(a);
  if (!t) {
    t = { op: "var", id: `len#${lenVarSeq++}` };
    lenTermMemo.set(a, t);
  }
  return abs({ k: "prim", type: "number" }, t, ge(t, lit(0)), "path");
}

/** 数组/字符串长度 */
export function $len(a: Abs): Abs {
  // DEC-006 B/C：形参/回调可能漏出 JS undefined（rest 未包 $arr、map 缺第 3 参）——
  // 非 Abs 入参 fail-closed unknown，禁止读 .shape 炸宿主 TypeError
  if (!a || typeof a !== "object" || !("shape" in (a as object))) {
    // Bug 9：transpile 泄漏的宿主函数（函数声明绑定等）——v.length 是宿主
    // 真值（首个默认值/rest 形参前的形参数），exact 折叠
    if (typeof a === "function") {
      return numLit((a as { length: number }).length);
    }
    return unknown;
  }
  // any 上的 .length：无约束成员（any ≠ unknown——不得报引擎债）
  if (a?.shape?.k === "any") return anyMemberResult();
  if (a.shape.k === "tuple") {
    return abs(
      { k: "prim", type: "number" },
      { op: "lit", value: a.shape.elements.length },
      pTrue,
      "exact",
    );
  }
  if (a.shape.k === "arr") {
    return abstractLen(a);
  }
  if (a.shape.k === "sum") {
    // 全成员长度同字面量 → 折叠（fork join 后 a.length 常见场景）；
    // 否则 number（成员长度可能不同）
    const lens = a.shape.members.map((m) => $len(m));
    const lits = lens.map(litValue);
    if (
      lits.length > 0 &&
      lits.every((v) => v.ok && lits[0]!.ok && Object.is(v.value, lits[0]!.value))
    ) {
      return lens[0]!;
    }
    return abstractLen(a);
  }
  // Bug 9：函数值 length（f.length = 首个默认值/rest 形参前的形参数）。
  // impl.length 静态已知（宿主函数 v.length / 全 Identifier 形参）→ exact；
  // 否则（默认值/嵌套默认模式不可判）保守 number≥0（与抽象数组同口径）。
  if (a.shape.k === "fn") {
    const implLen = getFnImpl(a)?.length;
    if (typeof implLen === "number") {
      return numLit(implLen);
    }
    return abstractLen(a);
  }
  const svR = litValue(a);
  const sv = svR.ok && typeof svR.value === "string" ? svR.value : undefined;
  if (typeof sv === "string") {
    return abs(
      { k: "prim", type: "number" },
      { op: "lit", value: sv.length },
      pTrue,
      "exact",
    );
  }
  // obj 自有 length 槽（Bug 34：$tpl 模板对象的 quasis 数；也覆盖
  // {length: n} 字面量）——成员读取语义，闭槽精确
  if (a.shape.k === "obj") {
    const slot = getSlot(a.shape.slots, "length");
    if (slot && !slot.optional) return slot.value;
  }
  // 抽象 string prim（含模板串、拼接结果）：内容未知但 .length 恒为 number。
  // 此前落到末尾 unknown —— `String(x).length` / `${x}.length` 被污染成
  // unknown 并误报 nudo:unknown-inference（类型上不可能不是 number）。
  if (a.shape.k === "prim" && a.shape.type === "string") {
    return abstractLen(a);
  }
  // String 包装对象（Object('ab') / new String）：内层 length 槽
  if (a.shape.k === "brand" && a.shape.name === "String") {
    const inner = a.shape.shape;
    if (inner.shape.k === "obj") {
      const lenSlot = inner.shape.slots["length"];
      if (lenSlot && !lenSlot.optional) return lenSlot.value;
    }
  }
  // RegExpStringIterator（matchAll 结果）：无 length 属性 → undefined
  if (a.shape.k === "brand" && a.shape.name === "RegExpMatchIterator") {
    return undef();
  }
  return unknown;
}

// 对象 / 成员
// --- 对象 / 成员 ---

/** 对象字面量 → Abs obj（槽位写走 setSlot，`__proto__` 不踩宿主 setter） */
export function $obj(slots: Record<string, Abs>): Abs {
  const s: Record<string, { value: Abs }> = Object.create(null);
  for (const k of Object.keys(slots)) {
    setSlot(s, k, { value: asAbsVal(slots[k]!) });
  }
  return objOf(s);
}

/**
 * 对象字面量非计算 `__proto__: v` 的特殊原型设定（ES PropertyDefinition）。
 * - v 为 null → null-proto（无 Object.prototype 回退）
 * - v 为 object → 保守 open（继承读不折 exact undefined；细节不建模）
 * - v 为 primitive → 原生忽略（无自有键、不改原型）
 */
export function $setProto(o: Abs, proto: Abs): Abs {
  const next = setProtoAbs(o, proto);
  if (next !== o) clearStaleTermPred(o);
  return next;
}

/** 对象展开 { ...a, b } */
export function $spread(a: Abs, b: Abs): Abs {
  let bb = asAbsVal(b);
  // 原生展开会**调用**源对象 getter 并把结果作为数据槽拷入
  const acc = bb && typeof bb === "object" ? accessorTable.get(bb as object) : undefined;
  if (acc && bb.shape.k === "obj") {
    let changed = false;
    const slots = { ...(bb.shape as ObjShape).slots };
    for (const [k, fn] of acc) {
      // 纯 getter（无同名数据槽）也要求值拷入——{ get x(){return 5} } 展开后 .x===5
      if (fn.get) {
        setSlot(slots, k, { value: fn.get(bb) });
        changed = true;
      }
    }
    if (changed) {
      bb = abs({ k: "obj", slots }, undefined, undefined, bb.conf);
    }
  }
  // any 展开：无约束键 → open obj（不是空 {} / unknown）
  const aa = asAbsVal(a);
  // 必须用 getter 求值后的 bb（不是原始 b0）——否则展开丢掉访问器结果
  const b0 = bb;
  if (aa?.shape?.k === "any" || b0?.shape?.k === "any") {
    const base = spreadObj(
      aa?.shape?.k === "any" ? abs({ k: "obj", slots: {}, open: true }, undefined, undefined, "partial") : aa,
      b0?.shape?.k === "any" ? abs({ k: "obj", slots: {}, open: true }, undefined, undefined, "partial") : b0,
    );
    return base;
  }
  return spreadObj(aa, b0);
}

/** 对象解构接收者守卫（Bug 32）：原生对象解构 = ToObject(receiver) +
 *  CopyDataProperties——null/undefined 接收者在任何键读/排除之前就抛
 *  TypeError（"Cannot destructure 'null' as it is null"）。rest-only 模式
 *  （`const {...r} = X`）此前只发 $objRest 不发 $get，接收者从不校验。
 *  - nullish 字面量 → hard NudoThrow（tier 1；键路径经 $get 同口径）
 *  - any / sum 含 nullish 或 any 臂 → may TypeError（tier 2；值域投影不变）
 *  - 非 nullish prim（含字符串/number/symbol/bigint）→ 原生 ToObject 装箱，
 *    CopyDataProperties 全量（node 实测 `const {...r} = "ab"` → {"0":"a","1":"b"}）
 *  unknown 是引擎 fail-closed 令牌，不记（与 $call 同口径，避免 L2 假报）。 */
function objRestGuard(o: Abs): void {
  const arm = (x: Abs): "nullish" | "may" | "total" => {
    if (isNullishAbs(x)) return "nullish";
    const k = x.shape.k;
    if (k === "any") return "may";
    return "total";
  };
  if (o.shape.k === "sum") {
    let may = false;
    for (const m of o.shape.members) {
      const a = arm(m);
      if (a === "nullish" || a === "may") may = true;
    }
    if (may) {
      recordMayThrow({
        kind: "TypeError",
        cause: "object rest destructuring of possibly nullish receiver",
      });
    }
    return;
  }
  const a = arm(o);
  if (a === "nullish") throw new NudoThrow(errorTypeAbs("TypeError"));
  if (a === "may") {
    recordMayThrow({
      kind: "TypeError",
      cause: "object rest destructuring of possibly nullish receiver",
    });
  }
}

/**
 * 解构 rest：`const { a, ...rest } = o` → rest = o 去掉 named keys。
 * closed obj：剩余槽 closed；open / optional 键：rest 仍 open（可能有未知键）。
 */
export function $objRest(o: Abs, keys: string[]): Abs {
  o = asAbsVal(o);
  objRestGuard(o);
  if (o.shape.k === "sum") {
    // DEC-006：空 sum 成员 join 无单位元——不得裸 reduce
    const parts = o.shape.members.map((m) => $objRest(m, keys));
    return parts.length ? parts.reduce((a, b) => joinAbs(a, b)) : unknown;
  }
  if (!isObj(o)) {
    // any 解构 rest：无约束对象面（open），不是 unknown
    if (o.shape.k === "any") {
      const shape: Abs["shape"] = { k: "obj", slots: {}, open: true };
      return { shape, conf: "partial" };
    }
    return unknown;
  }
  const drop = new Set(keys);
  const slots: Record<string, { value: Abs; optional?: boolean; readonly?: boolean }> = {};
  let openRest = o.shape.open === true;
  for (const [k, s] of Object.entries(o.shape.slots)) {
    if (drop.has(k)) continue;
    setSlot(slots, k, s);
    // optional 源键可能仍以 undefined 出现在 rest 的动态面；闭槽无需 open
  }
  // 提取的 optional 键：JS rest 会排除该键，但 open 对象上未知键仍可能进 rest
  if (o.shape.open) openRest = true;
  const shape: Abs["shape"] = { k: "obj", slots };
  if (openRest) (shape as { open?: boolean }).open = true;
  return { shape, conf: o.conf === "exact" ? "exact" : confJoin(o.conf, "partial") };
}

/** 数组 rest：`const [a, ...rest] = arr` → rest = 从 start 起的尾段 */
export function $arrRest(a: Abs, start: number): Abs {
  // Bug 22：侧表迭代物（生成器对象）rest 解构按元素切片（原 tuple 路径）
  const mi = matchIterElements(a);
  if (mi) {
    const sliced = mi.slice(start);
    if (sliced.length === 0) return abs({ k: "arr", element: unknown }, undefined, undefined, "path");
    if (shouldWidenArrayLiteral(sliced.length)) {
      const element = sliced.reduce((x, y) => joinAbs(x, y));
      return abs({ k: "arr", element }, undefined, undefined, widenedArrayConf());
    }
    return abs({ k: "tuple", elements: sliced }, undefined, undefined, a.conf);
  }
  a = asAbsVal(a);
  if (a.shape.k === "sum") {
    // DEC-006：空 sum 成员 join 无单位元——不得裸 reduce
    const parts = a.shape.members.map((m) => $arrRest(m, start));
    return parts.length ? parts.reduce((x, y) => joinAbs(x, y)) : unknown;
  }
  if (a.shape.k === "tuple") {
    // 源带 rest 槽：尾段含 rest 的未知长度元素，不得只切固定位前缀
    if (a.shape.rest) {
      const sliced = a.shape.elements.slice(start);
      if (start < a.shape.elements.length && !shouldWidenArrayLiteral(sliced.length + 1)) {
        return abs(
          { k: "tuple", elements: sliced, rest: a.shape.rest },
          undefined,
          undefined,
          a.conf,
        );
      }
      // 起点落在 rest 段 / 切片超 cap：尾段退化为 rest 元素数组（join 固定前缀）
      const restEl = a.shape.rest.shape.k === "arr" ? a.shape.rest.shape.element : a.shape.rest;
      const el = sliced.reduce((x, y) => joinAbs(x, y), restEl);
      return abs({ k: "arr", element: el }, undefined, undefined, a.conf);
    }
    return tupleOrWiden(a.shape.elements.slice(start), a.conf);
  }
  if (a.shape.k === "arr") return a;
  if (a.shape.k === "any") return abs({ k: "arr", element: anyMemberResult() }, undefined, undefined, "path");
  return unknown;
}

/** 数组连接 [...a, ...b] / [...a, x]；结果超 cap 时与字面量同策略降 arr */
export function $concat(a: Abs, b: Abs): Abs {
  a = asAbsVal(a);
  b = asAbsVal(b);
  // 字符串 spread：按 code points 拆（surrogate pair 合并；原生迭代语义）
  const avR = litValue(a);
  const av = avR.ok ? avR.value : undefined;
  if (typeof av === "string") {
    return $concat($arr([...av].map((c) => $lit(c))), b);
  }
  const bvR = litValue(b);
  const bv = bvR.ok ? bvR.value : undefined;
  if (typeof bv === "string") {
    return $concat(a, $arr([...bv].map((c) => $lit(c))));
  }
  const as = a.shape;
  const bs = b.shape;
  if (as.k === "tuple" && bs.k === "tuple") {
    return tupleOrWiden([...as.elements, ...bs.elements], confJoin(a.conf, b.conf));
  }
  // 一侧是抽象数组（arr）：spread 语义按元素并入（元素 join），
  // 不得整体嵌为单元素——字面量链超 cap 降级为 arr 后继续吸收后续元素也走此分支
  if (as.k === "arr" || bs.k === "arr") {
    // 空 tuple 元素 join 无单位元——不得裸 reduce（DEC-006: Reduce of empty array）；
    // 单位元是 bottom（never）而非 unknown（top）——空 tuple spread 不贡献
    // 元素，join(never, x) = x（与下方 sideEl 同口径，Bug 4：[...xs] 元素域
    // 被 unknown 污染成 number | unknown 的根因）
    const ea: Abs = as.k === "tuple"
      ? (as.elements.length ? as.elements.reduce((x, y) => joinAbs(x, y)) : abs({ k: "never" }, undefined, undefined, "exact"))
      : as.k === "arr"
        ? as.element
        : a;
    const eb: Abs = bs.k === "tuple"
      ? (bs.elements.length ? bs.elements.reduce((x, y) => joinAbs(x, y)) : abs({ k: "never" }, undefined, undefined, "exact"))
      : bs.k === "arr"
        ? bs.element
        : b;
    return abs({ k: "arr", element: joinAbs(ea, eb) }, undefined, undefined, "path");
  }
  // 剩余：至少一侧非 tuple/arr/string 字面量。
  // 迭代性守卫对齐共享分类器（iterabilityKind/guardIterable，与 $elems /
  // $iterCheck 同口径）：非字符串 prim（字面量或抽象 prim 面）与闭 obj
  // （无 @@iterator 槽）→ definite TypeError；any/unknown/open obj/brand/
  // fn → may TypeError。此前 throwIfNonIterable 只查 lit term——`[...x]`
  // （x:any）静默不记，而 `Math.max(...x)` 经 $elems 记 may，同面不同判
  // （wave 2 残留）。字符串/元组/Set/Map 等可迭代面与字面量行为不变。
  guardIterable(a, "spread element");
  guardIterable(b, "spread element");
  // Set/Map/matchAll 迭代器：条目精确展开（Map 是 entry 元组）；其余非容器
  // （unknown/any/brand/obj/抽象字符串）长度未知——必须 arr join，不得折单元素
  // tuple（[...x].length 假精确 1 的根因）
  const expand = (x: Abs): Abs[] | null => {
    if (isSetAbs(x)) return setElementsAbs(x);
    if (isMapAbs(x)) return mapEntriesAbs(x);
    const mi = matchIterElements(x);
    if (mi) return mi;
    return null;
  };
  if (as.k === "tuple") {
    const be = expand(b);
    if (be) {
      return tupleOrWiden([...as.elements, ...be], confJoin(a.conf, b.conf));
    }
    // b 可能可迭代：spread 并入的是 b 的元素而非 b 本身。
    // any 的元素域是 any（无约束），不是 unknown（引擎债）。
    const bEl = b?.shape?.k === "any" ? anyMemberResult() : unknown;
    return abs(
      { k: "arr", element: [...as.elements, bEl].reduce((x, y) => joinAbs(x, y)) },
      undefined,
      undefined,
      "path",
    );
  }
  const ae = expand(a);
  if (ae && bs.k === "tuple") {
    return tupleOrWiden([...ae, ...bs.elements], confJoin(a.conf, b.conf));
  }
  // 双侧皆非精确容器：元素 join（any → any；空 tuple 不贡献元素）
  const sideEl = (x: Abs, expanded: Abs[] | null): Abs => {
    // DEC-006：空 Set/Map/match-iter 展开无元素——不得裸 reduce
    if (expanded) {
      return expanded.length
        ? expanded.reduce((u, y) => joinAbs(u, y))
        : abs({ k: "never" }, undefined, undefined, "exact");
    }
    if (x?.shape?.k === "any") return anyMemberResult();
    if (x?.shape?.k === "tuple") {
      const els = x.shape.elements;
      // 空 tuple spread 不贡献元素 → never；join(never, any) = any
      return els.length ? els.reduce((u, y) => joinAbs(u, y)) : abs({ k: "never" }, undefined, undefined, "exact");
    }
    // 抽象字符串按 code point 可迭代是 total 面（iterabilityKind 同口径；
    // 字面量字符串在 $concat 顶部已特判展开）——元素域恒 string（Bug 4：
    // [...s] 折 unknown[] 的缺口）
    if (x?.shape?.k === "prim" && x.shape.type === "string") {
      return abs({ k: "prim", type: "string" }, undefined, undefined, "path");
    }
    return unknown;
  };
  return abs(
    { k: "arr", element: joinAbs(sideEl(a, ae), sideEl(b, expand(b))) },
    undefined,
    undefined,
    "path",
  );
}

/** 迭代消费（原生 GetIterator）的可迭代性分类：
 *  - total：string prim（任意取值恒可迭代）/ tuple / arr / Set / Map /
 *    matchAll 迭代器 / generator eff / never —— 原生全量
 *  - definite：非 string prim（num/bool/bigint/symbol/null/undefined——这些
 *    prim 的任何取值都没有 @@iterator，含字面量与抽象 prim）与闭 obj
 *    （无 @@iterator 槽；Object.prototype 原型链亦无）
 *  - may：any / unknown / open obj（未知键可能含 @@iterator）/ fn / brand /
 *    promise eff —— 抽象面可能不可迭代
 *  sum：逐臂归约（全臂 definite → definite；任一臂非 total → may） */
type IterabilityKind = "total" | "may" | "definite";

function iterabilityKind(a: Abs): IterabilityKind {
  const s = a.shape;
  if (s.k === "sum") {
    let sawNonTotal = false;
    let allDefinite = true;
    for (const m of s.members) {
      const k = iterabilityKind(m);
      if (k !== "definite") allDefinite = false;
      if (k !== "total") sawNonTotal = true;
    }
    return s.members.length > 0 && allDefinite
      ? "definite"
      : sawNonTotal
        ? "may"
        : "total";
  }
  // lit 字面量精确判定（与 $concat 的 throwIfNonIterable 同口径）：非字符串
  // prim 字面量恒不可迭代 → definite。nullish lit 的形状是 unknown（无独立
  // nullish shape），必须先看 term 再看形状。
  if (a.term?.op === "lit") {
    const v: unknown = (a.term as { value: unknown }).value;
    if (
      v === null ||
      v === undefined ||
      typeof v === "number" ||
      typeof v === "boolean" ||
      typeof v === "bigint" ||
      typeof v === "symbol"
    ) {
      return "definite";
    }
  }
  if (s.k === "tuple" || s.k === "arr" || s.k === "never") return "total";
  if (isSetAbs(a) || isMapAbs(a) || matchIterElements(a)) return "total";
  if (s.k === "eff") return s.eff === "generator" ? "total" : "may";
  if (s.k === "prim") return s.type === "string" ? "total" : "definite";
  if (s.k === "obj") {
    if (s.slots["@@iterator"]) return "total";
    return s.open ? "may" : "definite";
  }
  return "may";
}

/** for await（GetIterator hint=async）：@@asyncIterator 槽即全量（异步可迭代）；
 *  其余口径与同步迭代一致（数字等 prim definite、闭 obj 无任何迭代器槽
 *  definite、any/unknown/open obj may；数组/字符串走同步回退故仍 total）。 */
function asyncIterabilityKind(a: Abs): IterabilityKind {
  const s = a.shape;
  if (s.k === "sum") {
    let sawNonTotal = false;
    let allDefinite = true;
    for (const m of s.members) {
      const k = asyncIterabilityKind(m);
      if (k !== "definite") allDefinite = false;
      if (k !== "total") sawNonTotal = true;
    }
    return s.members.length > 0 && allDefinite
      ? "definite"
      : sawNonTotal
        ? "may"
        : "total";
  }
  if (
    s.k === "obj" &&
    !s.slots["@@iterator"] &&
    s.slots["@@asyncIterator"]
  ) {
    return "total";
  }
  return iterabilityKind(a);
}

/** 迭代消费守卫：definite 非可迭代 → 原生 TypeError（hard NudoThrow）；
 *  抽象面可能非可迭代 → recordMayThrow（值域投影不变）。
 *  $elems（for-of / spread 实参）与 $iterCheck（数组解构）共用。 */
function guardIterable(a: Abs, ctx: string): void {
  const kind = iterabilityKind(a);
  if (kind === "definite") throw new NudoThrow(errorTypeAbs("TypeError"));
  if (kind === "may") {
    recordMayThrow({
      kind: "TypeError",
      cause: `${ctx} over possibly non-iterable value`,
    });
  }
}

/** 数组解构模式接收者守卫：原生数组解构 = GetIterator + IteratorNext，
 *  非可迭代接收者抛 TypeError。emitDestructure 的 ArrayPattern 分支在逐项
 *  $idx / $arrRest 投影前调用；值域投影不变（字符串/元组等可迭代接收者
 *  不受影响）。 */
export function $iterCheck(a: unknown): void {
  guardIterable(asAbsVal(a), "array destructuring");
}

/** 元素列表（tuple 展开；arr 抽象；C1 Set/Map 逐条目；matchAll 迭代器逐匹配项；
 *  字符串按 code points）。Map 迭代语义是 entry `[key, value]` 元组，不是裸 value。
 *  消费前先过可迭代性守卫（Bug 6）：prim 字面量接收者 → 原生 definite
 *  TypeError；any/unknown → may。$forOf 与 call/new spread 实参路径继承。 */
export function $elems(a: Abs): Abs[] {
  guardIterable(a, "iteration");
  return elemsOf(a);
}

/** yield* 委托展开（Bug 82）：迭代性守卫与元素列表同 $elems，另报长度
 *  可知性——tuple / 字符串 prim / Set / Map / match-iter 是全量精确展开
 *  （元素个数确定）；arr / any / obj / brand / sum 等给单代表元素，
 *  长度不可判（收集器不得以 exact 元组出货）。 */
export function $yieldStarElems(a: Abs): { els: Abs[]; lengthKnown: boolean } {
  // any 接收者的元素域是 any（无约束），不是 unknown（引擎债）——与
  // $concat sideEl 同口径（`[...x]`（x:any）→ any[]）
  if (a.shape.k === "any") return { els: [anyMemberResult()], lengthKnown: false };
  const els = $elems(a);
  const s = a.shape;
  const lengthKnown =
    s.k === "tuple" ||
    s.k === "never" ||
    (s.k === "prim" && s.type === "string") ||
    isSetAbs(a) ||
    isMapAbs(a) ||
    matchIterElements(a) !== undefined;
  return { els, lengthKnown };
}

/** 模板标签对象（GetTemplateObject，Bug 34）：冻结的类数组 obj——数字槽
 *  为 cooked 字符串（无效转义序列时 cooked 是 undefined，原生实测）、
 *  length 精确、.raw 为 raw 字符串数组；@@iterator 槽给函数形状
 * （`[...s]` / `for..of` / `Symbol.iterator in s` 均按可迭代面判定，
 *  不得把冻结数组误判 definite 不可迭代）。 */
export function $tpl(cooked: Array<string | undefined>, raw: string[]): Abs {
  const slots: Record<string, { value: Abs }> = Object.create(null);
  const els: Abs[] = [];
  for (let i = 0; i < cooked.length; i++) {
    const c = cooked[i]!;
    const v = typeof c === "string" ? $lit(c) : $lit(undefined);
    els.push(v);
    setSlot(slots, String(i), { value: v });
  }
  setSlot(slots, "length", { value: numLit(cooked.length) });
  setSlot(slots, "raw", { value: $arr(raw.map((r) => $lit(r))) });
  setSlot(slots, "@@iterator", {
    value: absFunction([], { body: noBody }, { ctor: false }),
  });
  const t = abs({ k: "obj", slots }, undefined, undefined, "exact");
  // 元素侧表：spread / for-of / join 按 cooked 精确展开
  registerTplElements(t, els);
  return t;
}

function elemsOf(a: Abs): Abs[] {
  if (a.shape.k === "tuple") return [...a.shape.elements];
  if (a.shape.k === "arr") return [a.shape.element];
  if (isSetAbs(a)) return setElementsAbs(a);
  if (isMapAbs(a)) return mapEntriesAbs(a);
  const mi = matchIterElements(a);
  if (mi) return mi;
  const svR = litValue(a);
  const sv = svR.ok ? svR.value : undefined;
  // 字面量字符串：code points 精确展开（必须先于抽象 prim 臂——lit 也是
  // prim string shape）
  if (typeof sv === "string") return [...sv].map((c) => $lit(c));
  // 抽象字符串 prim：code point 迭代，元素域恒 string（Bug 19：for-of /
  // yield* 循环变量折 unknown → 算术/成员读级联污染）——单代表元素，与
  // arr 臂 [element] 同口径（长度不可知由 $forOf unbounded 出口 join 承接）
  if (a.shape.k === "prim" && a.shape.type === "string") {
    return [abs({ k: "prim", type: "string" }, undefined, undefined, "path")];
  }
  return [unknown];
}

/**
 * for-of：对 iterable 每个元素跑 body；有界展开。
 * body(item, i) 可返回 void；状态由外部 JS 变量承接。
 * - 具体空 tuple：体 0 次（不得用 `length || maxIters` 展开成 maxIters）
 * - 抽象 arr / 未知长度：0..maxIters 出口与 pack 状态 join
 */
/**
 * for-in 键序列：原生顺序为整数键升序 → 其余键按插入序；
 * 数组 hole 槽不出键（读值为 undefined 但不可枚举）。仅自有可枚举键。
 */
export function $forInKeys(o: Abs): Abs {
  const shape = o.shape;
  if (shape.k === "sum") {
    // DEC-006：空 sum 成员 join 无单位元——不得裸 reduce
    const members = shape.members.map((m) => $forInKeys(m));
    return members.length ? members.reduce((a, b) => joinAbs(a, b)) : unknown;
  }
  const isArrayIndexKey = (k: string): boolean => {
    const n = Number(k);
    return (
      k !== "" &&
      String(n) === k &&
      Number.isInteger(n) &&
      n >= 0 &&
      n < 4294967295
    );
  };
  if (shape.k === "obj") {
    // 仅自有可枚举键——与 Object.keys 的 enumKeys 同口径
    // （getPropFlags().enumerable === false 的 defineProperty 键剔除）
    const keys = enumOwnKeys(o, shape.slots);
    const intKeys = keys.filter(isArrayIndexKey).sort((a, b) => Number(a) - Number(b));
    const strKeys = keys.filter((k) => !isArrayIndexKey(k));
    return $arr([...intKeys, ...strKeys].map((k) => $lit(k)));
  }
  if (shape.k === "tuple") {
    const idxs: number[] = [];
    for (let i = 0; i < shape.elements.length; i++) {
      if (shape.holes?.includes(i)) continue;
      idxs.push(i);
    }
    return $arr(idxs.map((i) => $lit(String(i))));
  }
  if (shape.k === "arr") {
    // 抽象数组：索引域未知，单代表元素迭代（与 $forOf 抽象近似同口径）
    return abs({ k: "arr", element: $lit("0") }, undefined, undefined, "partial");
  }
  const svR = litValue(o);
  const sv = svR.ok && typeof svR.value === "string" ? svR.value : undefined;
  if (typeof sv === "string") {
    return $arr(Array.from({ length: sv.length }, (_, i) => $lit(String(i))));
  }
  // 键域未知 ≠ 键域为空（Bug 68）：any/unknown 接收者可能携带任意可枚举键，
  // 体必须至少跑一次（抽象字符串键），否则体内的 may-throw 丢失、计数器
  // 折成假精确 0。抽象 string prim 同理（索引键 0..len-1 域未知）。
  // 例外：nullish lit 的形状就是 unknown（无独立 nullish shape），原生
  // ToObject 后零可枚举键——先看 term 排除，键域确定为空。
  const isNullishLit =
    o.term?.op === "lit" &&
    ((o.term as { value: unknown }).value === null ||
      (o.term as { value: unknown }).value === undefined);
  if (
    !isNullishLit &&
    (shape.k === "any" ||
      shape.k === "unknown" ||
      (shape.k === "prim" && shape.type === "string"))
  ) {
    return abs({ k: "arr", element: str() }, undefined, undefined, "partial");
  }
  // brand：内层 obj 槽的可枚举键（类实例字段等）；内建（Date/Map/Promise）
  // 零自有可枚举键 → 空键序列。
  if (shape.k === "brand") {
    const inner = shape.shape;
    if (inner.shape.k === "obj") {
      // boxed String brand（Bug 57 附带，T2 移交）：length 不可枚举——原生
      // for (k in new String("ab")) 只枚举 ["0","1"]（内部槽已标 enumerable:false）
      const keys = enumOwnKeys(inner, inner.shape.slots).filter(
        (k) => !(shape.name === "String" && k === "length"),
      );
      return $arr(keys.map((k) => $lit(k)));
    }
    return $arr([]);
  }
  // 其余（num/bool/bigint/symbol/null/undefined prim 字面量或抽象、fn、eff）：
  // 原生 ToObject 后零可枚举键 → 键域确定为空，体 0 次。
  return $arr([]);
}

/** 侧表迭代物（生成器对象 / 模板标签 / matchAll 迭代器，Bug 22）的精确
 *  长度——matchIterElements 命中即长度已知（for-of 精确展开用）。 */
function sideIterLen(a: Abs): number | undefined {
  const mi = matchIterElements(a);
  return mi ? mi.length : undefined;
}

export function $forOf(
  iterable: Abs,
  body: (item: Abs, index: Abs) => void,
  maxIters: number = DEFAULT_MAX_LOOP_ITERS,
  opts?: {
    pack?: () => Abs;
    unpack?: (s: Abs) => void;
    /** 标签循环：仅吸收同标签 break/continue 信号 */
    label?: string;
    /** for await：接收者按 GetIterator(hint=async) 校验（@@asyncIterator 槽
     *  即全量）；仅异步可迭代（无 @@iterator 槽）的接收者不折同步槽位投影，
     *  元素取抽象 unknown（原生由 next() 链驱动）。 */
    forAwait?: boolean;
  },
): void {
  const pack = opts?.pack;
  const unpack = opts?.unpack;
  // 循环携带绑定宽化器（Bug 47）：unbounded 单代表迭代的出口 join 是
  // {0 次, 1 次} 两个打包态——常步长累加器（n++ / n += 2）跨迭代增长，
  // 1 次代表不能覆盖任意迭代次数（原生 xs.length 任意）；增长槽位宽化
  // 到无上界域（sound），join-幂等绑定不动（行为不变）
  const widen = pack ? makeLoopWidener() : undefined;
  let exitJoin: Abs | undefined;
  const snapExit = (): void => {
    if (!pack) return;
    const s = pack();
    widen?.observe(s);
    exitJoin = exitJoin ? joinAbs(exitJoin, s) : s;
  };
  const applyExitJoin = (): void => {
    if (!exitJoin || !pack || !unpack) return;
    unpack(widen ? widen.widenFinal(joinAbs(exitJoin, pack())) : joinAbs(exitJoin, pack()));
  };

  const shape = iterable.shape;
  // for await：异步可迭代性校验 + 元素域。仅异步可迭代接收者（只有
  // @@asyncIterator 槽）元素取抽象 unknown——不得折同步 $elems 投影
  //（对象槽位不是迭代产出，Bug 13 值域）；同步可迭代接收者走同步元素
  //（规范回退：同步迭代器逐项 await，promise 元素解包内层）。
  const forAwait = opts?.forAwait === true;
  const asyncOnly =
    forAwait &&
    shape.k === "obj" &&
    !shape.slots["@@iterator"] &&
    !!shape.slots["@@asyncIterator"];
  if (forAwait) {
    const kind = asyncIterabilityKind(iterable);
    if (kind === "definite") throw new NudoThrow(errorTypeAbs("TypeError"));
    if (kind === "may") {
      recordMayThrow({
        kind: "TypeError",
        cause: "for-await iteration over possibly non-iterable value",
      });
    }
  }
  const awaitElem = (x: Abs): Abs =>
    x.shape.k === "eff" && x.shape.eff === "promise" ? x.shape.inner : x;
  const items = asyncOnly
    ? [unknown]
    : forAwait
      ? elemsOf(iterable).map(awaitElem)
      : $elems(iterable);
  const svR = litValue(iterable);
  const sv = svR.ok ? svR.value : undefined;
  // tuple / 确切 Set·Map 条目数 / 字符串字面量 code points → 有界展开；
  // 抽象 arr 与 maybeAbsent 仍 0..max join
  // Bug 22：生成器对象（obj + 元素侧表）按侧表长度精确展开（原 tuple
  // 直接读 elements；表示改 obj 后经 matchIterElements 取数）
  const knownLen =
    shape.k === "tuple"
      ? shape.elements.length
      : typeof sv === "string"
        ? [...sv].length
        : collectionExactLen(iterable) ?? sideIterLen(iterable);
  // 非具体容器：长度未知（可能空、可能更长）→ 单代表元素只跑一次
  // （同一元素重复 join 幂等，maxIters 次展开只会让索引假精确 + 大数组
  // 反复深拷贝把分析拖死）；0 次出口由下方 snapExit join，保持 sound。
  const unbounded = knownLen === undefined;

  if (unbounded) snapExit();

  // 具体迭代空间（tuple / 字符串 code points / Set·Map 精确条目数）：展开到
  // 具体硬上限——maxIters 截断具体迭代会产出错误 #exact（countChars 对
  // 12 字符串只跑 8 轮得 8 #exact，原生是 12）。超硬上限 → 截断观测 +
  // 绑定 conf 降级（有界、可观测）。调用方显式给更大预算时以其为准
  // （maxLoopIters 是对外契约）。抽象 arr（maybeAbsent / 长度未知）仍走
  // maxIters 单代表元素 + 出口 join（抽象预算语义不变）。
  const concreteCap = Math.max(maxIters, MAX_CONCRETE_LOOP_ITERS);
  const n =
    knownLen !== undefined
      ? Math.min(knownLen, concreteCap)
      : items.length > 0
        ? 1
        : 0;
  const concreteOverrun = knownLen !== undefined && knownLen > concreteCap;

  for (let i = 0; i < n; i++) {
    const item =
      items.length > 0 ? items[Math.min(i, items.length - 1)]! : unknown;
    try {
      body(
        item,
        unbounded
          ? abs({ k: "prim", type: "number" }, undefined, undefined, "partial")
          : abs(
              { k: "prim", type: "number" },
              { op: "lit", value: i },
              pTrue,
              "exact",
            ),
      );
    } catch (e) {
      if (isNudoBreak(e, opts?.label)) {
        // break 打断代表体（fork 的 break 臂冒泡，后续语句丢失）——完整
        // 迭代效应不可观测，「先跑任意次再 break」的累加器域必须整体宽化
        if (unbounded && e.abstract) widen?.markInterrupted();
        applyExitJoin();
        return;
      }
      if (isNudoContinue(e, opts?.label)) {
        // continue 同款：本迭代剩余语句丢失（单代表迭代后循环即结束）
        if (unbounded && e.abstract) widen?.markInterrupted();
        continue; // 下一个元素；已发生副作用保留
      }
      if (isNudoReturn(e) || isNudoThrow(e)) throw e;
      throw e;
    }
    if (unbounded) snapExit();
  }
  if (unbounded && n === 0) snapExit();
  if (concreteOverrun) {
    noteAbsTruncation(LOOP_TRUNCATION_LABEL);
    if (pack && unpack) unpack(confPartialPacked(pack()));
    return;
  }
  applyExitJoin();
}

/**
 * 命名空间身份表：transpile 后 `Math.max(0, x)` 的接收者是宿主 JS 全局对象
 * （非 Abs）。按对象身份识别命名空间，路由到 Abs builtin 表。
 *
 * 表内名字与 transpile/intrinsics.ts 的 ENV_SHADOW_SKIP_GLOBALS（去
 * HOST_INTRINSIC_NAMES 后）1:1 手工同步：路由名必须 env-skip（否则注入遮蔽
 * 身份路由，issue #87），skip 名必须有路由收益（否则用户代码退化）。
 * parity 由 __tests__/env-shadow-parity.test.ts 钉住。
 */
export const NAMESPACE_GLOBALS: ReadonlyArray<readonly [string, unknown]> = [
  ["Math", Math],
  ["Number", Number],
  ["JSON", JSON],
  ["Object", Object],
  ["Array", Array],
  ["String", String],
  ["Date", Date],
  ["Promise", Promise],
  ["BigInt", BigInt],
  // Bug 19/43：此前缺项 → Reflect.get(1,"a") / Symbol.for(Symbol()) 折
  // unknown + throws=never（原生 TypeError 定抛被吞）
  ["Reflect", Reflect],
  ["Symbol", Symbol],
  // Bug 24：URL 静态面（canParse）派发——URL.canParse 折 unknown 的根因
  // 是 URL 不在身份路由表（构造面 new URL 经 clsName 派发不受影响）
  ["URL", URL],
  // Bug 56：X.prototype.<method> 值读——Map/Set/WeakMap/WeakSet/Boolean 的
  // prototype 成员读此前落宿主 unknown（.method 级联假 undefined + .call
  // 假 TypeError）；入表后 $get(ns, "prototype") → protoBrandAbs，
  // 原型方法表派发（Map.prototype.has.call(m, k) 等）
  ["Map", Map],
  ["Set", Set],
  ["WeakMap", WeakMap],
  ["WeakSet", WeakSet],
  ["Boolean", Boolean],
  ["RegExp", RegExp],
  ["Error", Error],
];

export function namespaceNameOf(v: unknown): string | undefined {
  if (typeof v !== "object" && typeof v !== "function") return undefined;
  for (const [name, host] of NAMESPACE_GLOBALS) {
    if (v === host) return name;
  }
  return undefined;
}

/** 正则字面量 → RegExp brand（source/flags/lastIndex 进 slots，供 exec/test 精确执行） */
export function $regex(pattern: string, flags = ""): Abs {
  return regexBrandAbsFrom(pattern, flags);
}

/** Array.prototype 自有可读键（push/map/keys/… 与 Symbol.iterator 投影名） */
const ARRAY_PROTO_METHOD_NAMES = new Set([
  "at", "concat", "copyWithin", "entries", "every", "fill", "filter", "find",
  "findIndex", "findLast", "findLastIndex", "flat", "flatMap", "forEach",
  "includes", "indexOf", "join", "keys", "lastIndexOf", "map", "pop", "push",
  "reduce", "reduceRight", "reverse", "shift", "slice", "some", "sort", "splice",
  "toSorted", "toReversed", "toSpliced", "with",
  "toLocaleString", "toString", "unshift", "values", "@@iterator",
]);

function isPossiblyProtoMemberKey(key: string): boolean {
  return (
    OBJECT_PROTO_METHOD_NAMES.has(key) ||
    ARRAY_PROTO_METHOD_NAMES.has(key) ||
    key === "constructor" ||
    key.startsWith("@@")
  );
}

/** Bug 49/56：prim 原型专有方法表（值读投影用；String 用 STRING_METHODS
 *  ——与「确定缺失」诊断同源，漏列会误 undef 合法方法值读） */
const PRIM_PROTO_METHOD_NAMES: Record<string, ReadonlySet<string>> = {
  string: STRING_METHODS,
  number: NUMBER_PROTO_METHODS,
  boolean: BOOLEAN_PROTO_METHODS,
  symbol: SYMBOL_PROTO_METHODS,
  bigint: BIGINT_PROTO_METHODS,
};

/** Bug 56：X.prototype.<method> 值读的构造器→方法表（prim 包装构造器 +
 *  内建 brand；用户/未知构造器不在此列——保守落内层 miss）。
 *  brand 臂延迟解析：BUILTIN_BRAND_METHODS 经 members.ts 循环 import，
 *  模块加载期该绑定可能尚未初始化（首用时已必然就绪）。 */
const PROTO_PRIM_METHOD_NAMES: Record<string, ReadonlySet<string>> = {
  Array: ARRAY_PROTO_METHOD_NAMES,
  String: STRING_METHODS,
  Number: NUMBER_PROTO_METHODS,
  Boolean: BOOLEAN_PROTO_METHODS,
  Symbol: SYMBOL_PROTO_METHODS,
  BigInt: BIGINT_PROTO_METHODS,
};

function protoBrandMethodNames(ctorName: string): ReadonlySet<string> | undefined {
  return (
    PROTO_PRIM_METHOD_NAMES[ctorName] ??
    BUILTIN_BRAND_METHODS[ctorName as keyof typeof BUILTIN_BRAND_METHODS]
  );
}

/**
 * Bug 49/56「方法值读」统一通道：原型方法的一等函数值。
 * - 值面：fn shape（typeof === "function"、=== undefined 折 false）；
 * - 调用面：apply 钩子把借用调用（v() / v.call(recv, …) / v.apply /
 *   v.bind）按 home 派发回**既有**方法调用机器（callAbsMethod 的 prim 面 /
 *   $invoke 的 brand·数组面）——不复制任何派发逻辑。
 * 与数组臂「不得挂空 body impl」的告诫不冲突：挂的是真 apply（转发派发），
 * $call 不会把 noBody 折成 undefined。
 */
/* var（非 let）：exec/class.ts 模块加载期经循环 import 回调本 setter 时，
 * let 声明仍在 TDZ（eval-empty-sum-reduce / env-shadow-parity 加载序崩溃）；
 * var 提升初始化为 undefined，注册先于本模块体完成也安全。 */
var protoMethodDispatch:
  | ((home: string, name: string, thisVal: Abs | undefined, args: Abs[]) => Abs)
  | undefined;

/** exec/class.ts 模块加载时注册（调用派发实现；与 state.ts 的
 *  setHostGlobalFnCall 桥同款注册式注入，避免 containers↔class import 环） */
export function setProtoMethodDispatch(
  d: (home: string, name: string, thisVal: Abs | undefined, args: Abs[]) => Abs,
): void {
  protoMethodDispatch = d;
}

export function protoMethodValueAbs(home: string, name: string): Abs {
  return absFunction([], {
    body: noBody,
    // 内建原型方法是内建函数，原生不可 new（Bug 9 口径）
    apply: (args, thisVal) =>
      protoMethodDispatch?.(home, name, thisVal, args) ?? unknown,
    // kind 标记：$invokeInner 的「属性上的可调用值」回退不得经此再入
    //（$invoke(recv, m) 未命中派发表时 $get 命中本值，$call 无 receiver
    // 回环成 $invoke(undefined, m)——copyWithin/splice 等未接管方法假定抛）
    kind: "protoMethod",
  }, { ctor: false });
}

/** 成员读：obj.slots[key]；缺失 → undefined 字面量；brand 解包内层 */
export function $get(
  o: Abs,
  key: string,
  opts?: { /** 调用方已负责诊断（如 $invoke） */ silent?: boolean },
): Abs {
  // 私有名（"#" 键）：foreign-receiver brand check——原生
  // PrivateFieldGet 要求接收者是声明类实例，否则 TypeError
  privateNameGuard(o, key);
  // 宿主 JS 对象（Math/JSON…）：属性按命名空间/真值投影
  if (!o || typeof o !== "object" || !("shape" in (o as object))) {
    // Object.prototype / Object.prototype.X（含 host 身份）
    if (o === Object.prototype) {
      if (OBJECT_PROTO_METHOD_NAMES.has(key)) return objectProtoMethodAbs(key);
      return unknown;
    }
    const ns = namespaceNameOf(o);
    if (key === "prototype") {
      if (ns === "Object") return objectProtoBrand();
      if (ns) return protoBrandAbs(ns);
    }
    if (ns) {
      try {
        const raw = (o as Record<string, unknown>)[key];
        if (typeof raw === "function") {
          return absFunction([`${ns}.${key}`], {
            body: noBody,
            apply: (args) => evalNamespaceCall(ns, key, args) ?? unknown,
          });
        }
        return $lit(raw);
      } catch {
        return unknown;
      }
    }
    // Bug 9：非命名空间宿主函数（transpile 编译的函数声明绑定等）——
    // name/length/prototype 是宿主真值（v.name / v.length / v.prototype）；
    // call/apply/bind 一等读取（$invoke 转发面既有）
    if (typeof o === "function") {
      const fn = o as { name?: unknown; length?: unknown; prototype?: unknown };
      if (key === "name") {
        return typeof fn.name === "string" && fn.name ? strLit(fn.name) : str();
      }
      if (key === "length") {
        return numLit(typeof fn.length === "number" ? fn.length : 0);
      }
      if (key === "prototype") {
        // 箭头/async/generator（去种类化宿主函数）原生无 prototype → undefined
        if (fn.prototype === undefined || hostFnCtorFacet(o as never) === false) {
          return undef();
        }
        return abs({ k: "obj", slots: {} }, undefined, undefined, "path");
      }
      if (key === "call" || key === "apply" || key === "bind") {
        return absFunction([], { body: noBody }, { ctor: false });
      }
      // Bug 9：Object.prototype 方法（f.toString / f.hasOwnProperty …）——
      // 宿主函数经原型链恒可用，一等 fn 读取（此前落 unknown）
      if (OBJECT_PROTO_METHOD_NAMES.has(key)) {
        return objectProtoMethodAbs(key);
      }
    }
    return unknown;
  }
  // Object.prototype 品牌：方法读取
  if (isObjectProtoBrand(o) && OBJECT_PROTO_METHOD_NAMES.has(key)) {
    return objectProtoMethodAbs(key);
  }
  // Symbol：.description（字面量或 undefined）
  if (isSymbolAbs(o) && key === "description") {
    return symbolDescriptionAbs(o) ?? unknown;
  }
  // Promise 实例方法一等读取（typeof p.then）
  if (o.shape.k === "eff" && o.shape.eff === "promise" && (key === "then" || key === "catch" || key === "finally")) {
    return absFunction([key === "then" ? "onFulfilled" : key === "catch" ? "onRejected" : "onFinally"], {
      body: noBody,
      // Bug 9：内建实例方法是内建函数，原生不可 new
    }, { ctor: false });
  }
  if (o.shape.k === "brand") {
    if (o.shape.name.endsWith(".prototype")) {
      const ctorName = o.shape.name.slice(0, -".prototype".length);
      // Array 三键维持既有精确面（arrayMethodAbs：bindThis 注入 receiver）
      if (ctorName === "Array" && (key === "toString" || key === "toLocaleString" || key === "join")) {
        return arrayMethodAbs(key === "join" ? "join" : key);
      }
      // Bug 56：X.prototype.<method> 值读泛化——按构造器查原型方法表，产
      // 带 apply 钩子的一等 fn（.call(recv,…) 借用调用转发既有方法派发）；
      // 表外键沿旧路径（内层仅 constructor 槽 → miss）。
      const protoMethods = protoBrandMethodNames(ctorName);
      if (protoMethods?.has(key)) {
        return protoMethodValueAbs(ctorName, key);
      }
    }
    const isClassVal = classNameOfValue(o as object) === o.shape.name;
    // 内建 brand 原型方法读取（typeof m.forEach / m[Symbol.iterator]）：
    // 方法实现由 $invoke 派发，此处给可 typeof 的 fn 形状
    // （class 声明值同名内建时不误伤：类方法走 registry）
    const builtinM = BUILTIN_BRAND_METHODS[o.shape.name];
    if (builtinM && !isClassVal && (key === "@@iterator" || builtinM.has(key))) {
      return absFunction([], { body: noBody }, { ctor: false });
    }
    // JS Map/Set 的 size 是属性不是方法；brand 内层为空 obj，须在 $get 委托
    if (key === "size" && o.shape.name === "Map") return mapSizeAbs(o);
    if (key === "size" && o.shape.name === "Set") return setSizeAbs(o);
    const inner = o.shape.shape;
    // 自有数据属性优先于原型访问器（原生属性查找：own → prototype）
    // 必须 getSlot：constructor/toString 等键裸读会踩宿主 Object.prototype
    if (inner?.shape.k === "obj") {
      const slot = getSlot(inner.shape.slots, key);
      if (slot && !slot.optional) return slot.value;
    }
    if (isClassVal) {
      const sacc = findStaticClassAccessor(o.shape.name, key);
      if (sacc) return sacc.get ? sacc.get(o) : undef();
      // 类值上读实例访问器键 → 原生 undefined
      if (findClassAccessor(o.shape.name, key)) return undef();
      // 静态方法一等读取（typeof A.m / 高阶传递）：沿继承链在 registry 找
      // 未调用方法槽带 AST 形参展示名（不再假零参）
      for (const n of evalClassChain(o.shape.name)) {
        const spec = getEvalClass(n);
        if (spec?.staticMethods?.[key]) {
          return absFunction(spec.staticMethodParams?.[key] ?? [], { body: noBody }, { ctor: false });
        }
      }
      // 类值是 constructor 函数：prototype 对象与 Function.prototype 成员
      if (key === "prototype") {
        return abs({ k: "obj", slots: {} }, undefined, undefined, "path");
      }
      if (key === "call" || key === "apply" || key === "bind") {
        return absFunction([], { body: noBody }, { ctor: false });
      }
    } else {
      const acc = findClassAccessor(o.shape.name, key);
      if (acc) return acc.get ? acc.get(o) : undef();
      // 实例上读静态访问器键 → 原生 undefined（属性在构造器上）
      if (findStaticClassAccessor(o.shape.name, key)) return undef();
      // 实例方法读取（typeof a.m / 一等值）：沿继承链在 registry 找方法
      // 未调用方法槽带 AST 形参展示名（不再假零参）
      for (const n of evalClassChain(o.shape.name)) {
        const spec = getEvalClass(n);
        if (spec?.methods?.[key]) {
          return absFunction(spec.methodParams?.[key] ?? [], { body: noBody }, { ctor: false });
        }
      }
    }
    // 原型链 constructor：内建 brand（Error/Date/…）→ 对应构造器 Abs
    if (key === "constructor") {
      const cn = ctorNameOfRecv(o);
      if (cn) return builtinCtorAbs(cn);
    }
    return $get(inner, key, opts);
  }
  // dual-facet fn 静态槽（Number.isFinite / Array.isArray）：自有槽优先
  if (o.shape.k === "fn" && o.shape.slots) {
    const slot = getSlot(o.shape.slots, key);
    if (slot) {
      if (slot.optional) return joinAbs(slot.value, undef());
      return slot.value;
    }
  }
  // Bug 9：函数值属性 name / length / prototype——值域恒可判定
  //（name：shape.name 声明名（asAbsVal / $fnVal 透传）有则 exact，否则
  //  string；length：$len 的 fn 分支；prototype：非箭头恒对象 / 箭头 undefined）
  if (o.shape.k === "fn") {
    if (key === "name") {
      const nm = (o.shape as { name?: string }).name;
      return typeof nm === "string" && nm ? strLit(nm) : str();
    }
    if (key === "length") return $len(o);
    if (key === "prototype") {
      return o.shape.ctor === false
        ? undef()
        : abs({ k: "obj", slots: {} }, undefined, undefined, "path");
    }
  }
  // 数组 length：成员路径（a.length += 1 等复合写）与 a.length 读同源
  if ((o.shape.k === "tuple" || o.shape.k === "arr") && key === "length") {
    return $len(o);
  }
  // 元组下标字符串键（a["0"] ≡ a[0]）；确定非下标自有键 → undefined
  // （原型方法 / Symbol.iterator 不在此列，继续走下方方法投影）
  if (o.shape.k === "tuple") {
    const idx = canonicalArrayIndex(key);
    const els = o.shape.elements;
    if (idx !== undefined) return idx < els.length ? els[idx]! : undef();
    if (!isPossiblyProtoMemberKey(key)) return undef();
  }
  // 字符串下标字符串键（s["1"] ≡ s[1]）；确定非下标自有键 → undefined
  // （与元组同口径 canonicalArrayIndex；length/原型方法继续走下方投影）
  if (o.shape.k === "prim" && (o.shape as { type?: string }).type === "string") {
    const idx = canonicalArrayIndex(key);
    const svR = litValue(o);
    const sv = svR.ok && typeof svR.value === "string" ? svR.value : undefined;
    if (idx !== undefined) {
      if (typeof sv === "string") return idx < sv.length ? $lit(sv[idx]!) : undef();
      return abs({ k: "prim", type: "string" }, undefined, undefined, "path");
    }
    if (key === "length" && typeof sv === "string") return numLit(sv.length);
    // Bug 49：String.prototype 专有方法（trim/charAt/padStart/bold/…）是
    // 可能的原型成员——不折 undef（否则 typeof "ab".trim === "undefined"
    // 错误具体值）；其余确定非下标非方法键仍 undefined（原生 s.foo）
    if (!isPossiblyProtoMemberKey(key) && !STRING_METHODS.has(key) && key !== "length") {
      return undef();
    }
  }
  // 元组/数组/prim 上的 Object.prototype / Array.prototype / prim 原型方法读取
  const primProtoMethods =
    o.shape.k === "prim"
      ? PRIM_PROTO_METHOD_NAMES[(o.shape as { type?: string }).type ?? ""]
      : undefined;
  if (
    (o.shape.k === "tuple" || o.shape.k === "arr" || o.shape.k === "prim") &&
    (OBJECT_PROTO_METHOD_NAMES.has(key) ||
      (o.shape.k !== "prim" && ARRAY_PROTO_METHOD_NAMES.has(key)) ||
      primProtoMethods?.has(key) === true)
  ) {
    if ((o.shape.k === "tuple" || o.shape.k === "arr") && (key === "toString" || key === "toLocaleString" || key === "join")) {
      return arrayMethodAbs(key === "join" ? "join" : key);
    }
    // Array.prototype 方法 / Symbol.iterator：一等函数（typeof a.push === "function"）。
    // Bug 56：具名方法升级为方法值读通道（apply 钩子转发借用调用
    // [].push.call(a, v)；@@iterator 维持无 impl 形状——迭代协议派发另走）。
    if (o.shape.k !== "prim" && (ARRAY_PROTO_METHOD_NAMES.has(key) || key === "@@iterator")) {
      if (key !== "@@iterator") return protoMethodValueAbs("Array", key);
      return { shape: { k: "fn", params: [], ctor: false }, conf: "path" };
    }
    // string.toString/valueOf 由 callAbsMethod 处理调用；一等读取仍给 OP 函数
    if (
      primProtoMethods?.has(key) === true &&
      (!OBJECT_PROTO_METHOD_NAMES.has(key) ||
        // 唯一例外：string prim 的 toString（此前被显式排除落 unknown，
        // Bug 49 值读面）——OP 泛型 toString 会折 "[object String]"，走
        // prim 通道才有 String.prototype.toString 域
        ((o.shape as { type?: string }).type === "string" && key === "toString"))
    ) {
      // Bug 49：prim 专有原型方法（trim/toFixed/…）——方法值读通道：
      // apply 钩子转发 callAbsMethod 既有派发
      return protoMethodValueAbs((o.shape as { type: string }).type, key);
    }
    return objectProtoMethodAbs(key);
  }
  // OOB 合成 undefined 接收者（抽象下标可能 miss 后的成员读）：引擎精度
  // 产物，不记 may-throw / 不硬抛；marker 透传（issue #98）。透传是有意
  // 的召回权衡：越界读本身不抛、读到的 undefined 再被成员读原生必抛
  // TypeError，而 marker 无法区分「循环不变量保证在界内」（#98 循环 DP
  // 表，要零误报）与「真实无约束下标」（如 d[i][0] 原生 h(5) 必抛，此处
  // 穿门不报）——按类压制换 #98 零误报；理想收窄 = Φ 导出下标在界 pred。
  if (isOobUndef(o)) return o;
  // any / nullish：throws 域（design-cli-semantics §3.3）
  if (noteNullishMemberThrows(o, key, "property")) {
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  if (o.shape.k === "any") {
    if (!opts?.silent) noteAnyMemberMayThrow(o, key, "property");
    return anyMemberResult();
  }
  if (isObj(o)) {
    const acc = lookupObjAccessor(o, key);
    if (acc) return acc.get ? acc.get(o) : undef();
    const slot = getSlot((o.shape as ObjShape).slots, key);
    if (slot) {
      // optional 槽在 JS 中可能缺席 → 读到 undefined，不能报 definite presence
      if (slot.optional) return joinAbs(slot.value, undef());
      return slot.value;
    }
    // Object.prototype 方法（非 null-proto）：一等函数读取
    if (!isNullProtoObj(o) && OBJECT_PROTO_METHOD_NAMES.has(key)) {
      return objectProtoMethodAbs(key);
    }
    if ((o.shape as ObjShape).open) return unknown;
    // Object.prototype.constructor（null-proto 无 → undef）
    if (key === "constructor" && !isNullProtoObj(o)) {
      return builtinCtorAbs("Object");
    }
    // C0.5：闭 shape 缺槽且求值命中 → 可选 nudo:missing-slot（默认 off）
    noteObjSlotMissing(o, key);
    return undef();
  }
  if (o.shape.k === "sum") {
    // DEC-006：空 sum 成员 join 无单位元——不得裸 reduce
    const parts = o.shape.members.map((m) => $get(m, key, opts));
    return parts.length ? parts.reduce((a, b) => joinAbs(a, b)) : unknown;
  }
  // prim / tuple / arr / fn / eff 的原型 constructor（上文未命中自有槽）
  if (key === "constructor") {
    const cn = ctorNameOfRecv(o);
    if (cn) return builtinCtorAbs(cn);
  }
  if (!opts?.silent) {
    // nullish → may-throw TypeError（soft，不中断求值）
    if (noteNullishMemberThrows(o, key, "property")) {
      return unknown;
    }
    // any（无约束）→ may-throw TypeError；结果保持 any
    if (noteAnyMemberMayThrow(o, key, "property")) {
      return anyMemberResult();
    }
    // unknown（推导失败）→ unknown-recv 引擎债（$invoke 自己报 method）
    noteUnknownMemberMissing(o, key, "property");
    noteObjSlotMissing(o, key);
  }
  return unknown;
}

/**
 * Map/Set forEach：条目表逐条调用回调（value, key, recv）。
 * 回调是 求值引擎 JS 函数（transpile 内联箭头）直接调用；Abs fn 走 $call。
 * 回调返回值丢弃；forEach 表达式值恒 undefined。
 */
export function $collectionForEach(recv: Abs, cb: unknown): Abs | undefined {
  const invokeCb = (args: Abs[]): void => {
    if (typeof cb === "function") {
      callAtFunctionBoundary(() => {
        (cb as (...a: Abs[]) => unknown)(...args);
      });
      return;
    }
    if (cb && typeof cb === "object" && "shape" in (cb as object)) {
      $call(cb as Abs, args);
    }
  };
  if (isMapAbs(recv)) {
    for (const entry of mapEntriesAbs(recv)) {
      if (entry.shape.k === "tuple" && entry.shape.elements.length >= 2) {
        const key = entry.shape.elements[0]!;
        const value = entry.shape.elements[1]!;
        invokeCb([value, key, recv]);
      }
    }
    return undef();
  }
  if (isSetAbs(recv)) {
    for (const el of setElementsAbs(recv)) {
      invokeCb([el, el, recv]);
    }
    return undef();
  }
  return undefined;
}

/** 成员写：返回新 obj/brand（不可变更新）；frozen/sealed/只读目标按 sloppy 静默失败 */
export function $set(o: Abs, key: string, value: Abs): Abs {
  // 私有名（"#" 键）：foreign-receiver brand check（PrivateFieldSet）
  privateNameGuard(o, key);
  // DEC-006 B/C：free identifier 可能把宿主值（globalThis…）漏进来——
  // 非 Abs 目标 fail-closed 返回原接收者（调用点 `root = $set(root, …)` 重绑
  // 为自赋值 no-op），禁止读 .shape 炸宿主 TypeError（$get 同口径）
  if (!o || typeof o !== "object" || !("shape" in (o as object))) {
    return o;
  }
  if (o.shape.k === "brand") {
    if (extStateOf(o) === "frozen") throwStrictWrite();
    const isClassVal = classNameOfValue(o as object) === o.shape.name;
    if (isClassVal) {
      const sacc = findStaticClassAccessor(o.shape.name, key);
      if (sacc) return sacc.set ? sacc.set(o, value) : o;
      if (findClassAccessor(o.shape.name, key)) return o;
    } else {
      const acc = findClassAccessor(o.shape.name, key);
      if (acc) {
        if (acc.set) return acc.set(o, value);
        // getter-only：strict → TypeError（硬抛，catch 可吸收）
        throwStrictWrite();
      }
      // 类实例字段就地突变：原生引用共享语义——方法内 this.n = v 对
      // 调用点持有的同一实例 Abs 可见（不可变更新会只改局部绑定）
      const inner = o.shape.shape;
      if (inner.shape.k === "obj") {
        const st = extStateOf(o);
        if ((st === "sealed" || st === "nonext") && !getSlot(inner.shape.slots, key)) {
          throwStrictWrite(); // 不可扩展：新键写 TypeError
        }
        if (getPropFlags(o)?.get(key)?.writable === false) throwStrictWrite();
        setSlot(inner.shape.slots, key, { value: asAbsVal(value) });
        clearStaleTermPred(o);
        return o;
      }
    }
    const inner = $set(o.shape.shape, key, value);
    const next = abs(
      { k: "brand", name: o.shape.name, shape: inner },
      o.term,
      o.pred,
      confJoin(o.conf, value.conf),
    );
    // 类 Abs 不可变更新后仍是类值（静态访问器派发依赖身份）
    const clsName = classNameOfValue(o as object);
    if (clsName) markClassValue(next as object, clsName);
    return next;
  }
  // a.length = n：合法域是非负整数 ≤ 2^32-1（4294967295），其余原生 RangeError；
  // 合法且巨大（原生稀疏数组）不物化——就地降 arr（元素 ∪ undefined、长度未知）。
  // 抽象值按 sound 回退：元素与 undefined 取并、长度未知
  if (o.shape.k === "tuple" && key === "length") {
    if (extStateOf(o) === "frozen") throwStrictWrite();
    const vR = litValue(value);
    const v = vR.ok ? vR.value : undefined;
    if (typeof v === "number") {
      // 负数/小数/NaN/Infinity/≥2^32：原生 hard RangeError（catch 可吸收）
      if (!Number.isInteger(v) || v < 0 || v > 4294967295) {
        throw new NudoThrow(errorTypeAbs("RangeError"));
      }
      if (v > TUPLE_MATERIALIZE_CAP) {
        // 合法但巨大：不物化巨 tuple
        o.shape = widenTupleToArr(o.shape.elements, o.shape.holes, undefined);
        o.conf = confJoin(o.conf, "path");
        clearStaleTermPred(o);
        return o;
      }
      const els = o.shape.elements.slice(0, v);
      while (els.length < v) els.push($lit(undefined));
      // 截断过滤 + 延长新增：延长部分（[oldLen, v)）全是 hole
      const oldLen = o.shape.elements.length;
      const holes = (o.shape.holes ?? []).filter((h) => h < v);
      for (let h = oldLen; h < v; h++) holes.push(h);
      // 就地写回（引用语义：别名同步）
      o.shape = {
        k: "tuple",
        elements: els,
        holes: holes.length > 0 ? holes : undefined,
      };
      clearStaleTermPred(o);
      return o;
    }
    const joined =
      o.shape.elements.length > 0
        ? o.shape.elements.reduce((a, b) => joinAbs(a, b))
        : unknown;
    o.shape = { k: "arr", element: joinAbs(joined, $lit(undefined)) };
    o.conf = "partial";
    clearStaleTermPred(o);
    return o;
  }
  if (o.shape.k === "arr" && key === "length") {
    const vR = litValue(value);
    const v = vR.ok ? vR.value : undefined;
    // 抽象数组也是数组：非法 length 字面量同样原生 RangeError
    if (typeof v === "number" && (!Number.isInteger(v) || v < 0 || v > 4294967295)) {
      throw new NudoThrow(errorTypeAbs("RangeError"));
    }
    o.conf = "partial";
    clearStaleTermPred(o);
    return o;
  }
  if (!isObj(o)) {
    // strict/ESM 写语义：确定非对象目标原生 TypeError（硬抛，catch 可吸收）。
    // 此前一律 `return $obj({...})` 伪造对象——prim/空值静默成功（L2 漏报）、
    // 数组目标被整体替换为对象（最坏假精确）。
    const sk = o.shape.k;
    // nullish 字面量（$lit(null/undefined) 是 unknown+lit term）与 prim：原生必抛
    if (sk === "prim" || sk === "never" || isNullishAbs(o)) throwStrictWrite();
    // any：可能成功（对象）也可能 TypeError——软 may-throw，目标不变
    if (sk === "any") {
      noteAnyMemberMayThrow(o, key, "property");
      return o;
    }
    if (sk === "unknown") {
      noteUnknownMemberMissing(o, key, "property");
      return o;
    }
    // 数组 expando 属性（a.x = 1）：无槽位模型——tuple 就地降 arr（长度/元素保持）
    if (sk === "tuple") {
      o.shape = widenTupleToArr(o.shape.elements, o.shape.holes, value);
      o.conf = confJoin(o.conf, "path");
      clearStaleTermPred(o);
      return o;
    }
    // sum：成员含确定非对象 → 写可能 TypeError（软）；否则写成功但无槽位模型
    if (sk === "sum" && o.shape.members.some((m) => m.shape.k === "prim" || m.shape.k === "never")) {
      recordMayThrow({
        kind: "TypeError",
        cause: `property '${key}' write on sum (non-object member)`,
        recv: "sum",
        name: key,
      });
    }
    return o;
  }
  const shape = o.shape as ObjShape;
  const st = extStateOf(o);
  const hasKey = Object.prototype.hasOwnProperty.call(shape.slots, key);
  // frozen：全写 TypeError；sealed/nonext：新键 TypeError（strict 硬抛）
  if (st === "frozen") throwStrictWrite();
  if ((st === "sealed" || st === "nonext") && !hasKey) throwStrictWrite();
  // defineProperty writable:false：写 TypeError
  if (getPropFlags(o)?.get(key)?.writable === false) throwStrictWrite();
  const acc = lookupObjAccessor(o, key);
  if (acc) {
    if (!acc.set) throwStrictWrite(); // getter-only：写 TypeError
    return acc.set(o, value);
  }
  // `o.__proto__ = v` 走 Object.prototype setter（设原型）；null-proto 无 setter
  // → 自有数据属性。不得 slots[key]=（宿主 __proto__ setter 丢键）。
  if (key === "__proto__" && !isNullProtoObj(o)) {
    return $setProto(o, value);
  }
  // 就地写槽（引用语义：const b = o; b.x = v 对 o 可见）——Abs 身份不变
  setSlot(shape.slots, key, { value: asAbsVal(value) });
  o.conf = confJoin(o.conf, value.conf);
  clearStaleTermPred(o);
  return o;
}
