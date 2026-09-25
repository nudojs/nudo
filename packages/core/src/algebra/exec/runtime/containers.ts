/**
 * 数组 / 对象运行时：$arr/$idx/$len/$arrMutContainer 与 $obj/$get/$set/$spread。
 */
import type { Abs } from "../../abs.ts";
import { abs, bool, boolLit, confJoin, litValue, numLit, unknown, type Confidence } from "../../abs.ts";
import { lit } from "../../term.ts";
import type { Phi } from "../../pred.ts";
import { pTrue, and, predEquals } from "../../pred.ts";
import { absFunction, getFnImpl } from "../../abs-fn.ts";
import {
  joinAbs, objOf, isObj, spread as spreadObj, type ObjShape, type Slot,
  isNullProtoObj, migrateNullProto, getSlot, canonicalArrayIndex,
} from "../../objects.ts";
import {
  isMapAbs, isSetAbs, setElementsAbs, collectionExactLen,
  mapEntriesAbs, mapSizeAbs, setSizeAbs,
} from "../../collections.ts";
import { shouldWidenArrayLiteral, widenedArrayConf, TUPLE_MATERIALIZE_CAP } from "../../containers.ts";
import { registerMatchIter, matchIterElements } from "../match-iter.ts";
import {
  evalNamespaceCall, extStateOf, getPropFlags, migrateInvariants,
  regexBrandAbsFrom, evalObjectProtoMethod, objectProtoMethodAbs,
  isObjectProtoBrand, OBJECT_PROTO_METHOD_NAMES, isSymbolAbs,
  symbolDescriptionAbs, objectProtoBrand, builtinCtorAbs, ctorNameOfRecv,
  protoBrandAbs, notePromiseExecutorFork,
} from "../../builtins.ts";
import { arrayMethodAbs } from "../../builtins/array.ts";
import {
  noteUnknownMemberMissing, noteObjSlotMissing,
  noteAnyMemberMayThrow, noteNullishMemberThrows, isNullishAbs, anyMemberResult,
} from "../member-diag.ts";
import { errorTypeAbs, recordMayThrow, type MayThrowEffect } from "../may-throw.ts";
import { getBClass } from "../class-registry.ts";
import { classNameOfValue, markClassValue } from "../../class-mark.ts";
import {
  NudoThrow, undef, throwStrictWrite, writeInPlace, clearStaleTermPred,
  asAbsVal, $lit, litTruth, isDefinitelyTrue, isDefinitelyFalse, currentExecPhi,
  isNudoReturn, isNudoBreak, isNudoContinue, $fnVal, $rawThis, noBody,
} from "./state.ts";
import { $unknown, $toNumber, $eq, $ne, $typeof, $add, $sub } from "./ops.ts";
import { lookupObjAccessor, migrateAccessors, $objAccessor, findClassAccessor, findStaticClassAccessor, $in, $instanceof, $del, accessorTable, BUILTIN_BRAND_METHODS, bClassChain } from "./members.ts";
import { DEFAULT_MAX_LOOP_ITERS } from "./control.ts";
import { isNudoThrow, callAtFunctionBoundary } from "./state.ts";
import { $call } from "../call.ts";

// 数组
// --- 数组 ---

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
 * C1.4 语句重绑：返回**变更后容器** Abs（不是 JS 返回值）。
 * `a.pop()` 语句应把 `a` 绑成去掉末元的 tuple，而不是被移除的元素。
 */
/** ToIntegerOrInfinity（±Infinity 保持）；返回：数字=可折叠 / null=实参不可判定 / undefined=缺省或显式 undefined（取默认值） */
export function toIOI(v: Abs | undefined): number | null | undefined {
  if (v === undefined) return undefined; // 实参缺省（数组越界）
  const lv = litValue(v);
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
    return Math.trunc(Number(lv));
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
      // 重叠且源在目标之后（s < t）：按规范倒序复制
      const backwards = (s ?? 0) < (t ?? 0) && win.s + (win.e - win.s) > win.t;
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
  return abs(
    { k: "arr", element: joinAbs(shape.element, v) },
    undefined,
    undefined,
    confJoin(arr.conf, "path"),
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
      slots[k] = { ...v, value: $copy(v.value) };
    }
    const next = objOf(slots, {
      index: s.index ? { key: $copy(s.index.key), value: $copy(s.index.value) } : undefined,
      open: s.open,
    });
    next.conf = a.conf;
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

/** 下标读 a[i]；字面量 i 走 tuple 精确投影，否则并所有元素；string[i] → 单字符 */
export function $idx(a: Abs, i: Abs): Abs {
  // any 下标：无约束读（any ≠ unknown）
  if (a?.shape?.k === "any") return anyMemberResult();
  const iv = litValue(i);
  if (a.shape.k === "tuple") {
    const els = a.shape.elements;
    if (typeof iv === "number" && Number.isInteger(iv)) {
      if (iv >= 0 && iv < els.length) return els[iv]!;
      return undef();
    }
    if (els.length === 0) return undef();
    return els.reduce((x, y) => joinAbs(x, y));
  }
  if (a.shape.k === "arr") return a.shape.element;
  if (a.shape.k === "sum") {
    return a.shape.members.map((m) => $idx(m, i)).reduce((x, y) => joinAbs(x, y));
  }
  // C1.3：对象 + key 投影；闭 shape miss / 未知 key 必须并入 undefined
  if (a.shape.k === "obj" || (a.shape.k === "brand" && a.shape.shape.shape.k === "obj")) {
    const objShape = (a.shape.k === "obj" ? a.shape : a.shape.shape.shape) as ObjShape;
    const slots = Object.values(objShape.slots).map((s) => s.value);
    if (slots.length === 0) return objShape.open ? unknown : undef();
    const joinSlotsWithUndef = (): Abs =>
      joinAbs(slots.reduce((x, y) => joinAbs(x, y)), undef());
    if (typeof iv === "string" || typeof iv === "number" || typeof iv === "boolean") {
      const slot = objShape.slots[String(iv)];
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
  // 字符串下标：s[i] → 第 i 个字符（字面量精确）
  const sv = litValue(a);
  if (typeof sv === "string") {
    if (typeof iv === "number" && Number.isInteger(iv)) {
      if (iv >= 0 && iv < sv.length) {
        return abs(
          { k: "prim", type: "string" },
          { op: "lit", value: sv[iv] as unknown as import("../../term.ts").LiteralValue },
          pTrue,
          "exact",
        );
      }
      return undef();
    }
    return unknown;
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
  const iv = litValue(i);
  if (a.shape.k === "tuple" && typeof iv === "number" && Number.isInteger(iv) && iv >= 0) {
    const st = extStateOf(a);
    if (st === "frozen") throwStrictWrite(); // frozen 数组：下标写 TypeError
    if (
      (st === "sealed" || st === "nonext") &&
      iv >= a.shape.elements.length
    ) {
      throwStrictWrite(); // 不可扩展：越界写（新下标）TypeError
    }
    // i ≥ 2^32-1：非数组下标，原生是 expando 属性（length 不变、`i in a` 可见）。
    // 数组模型无 expando 槽：就地降 arr（读/keys/in 全保守），不得假精确
    if (iv >= 4294967295) {
      a.shape = widenTupleToArr(a.shape.elements, a.shape.holes, value);
      a.conf = confJoin(a.conf, "path");
      clearStaleTermPred(a);
      return a;
    }
    // 巨大合法下标：原生 length 增长到 iv+1 的稀疏数组；
    // 分析不物化巨 tuple（OOM/DoS），就地降 arr
    if (iv + 1 > TUPLE_MATERIALIZE_CAP) {
      a.shape = widenTupleToArr(a.shape.elements, a.shape.holes, value);
      a.conf = confJoin(a.conf, "path");
      clearStaleTermPred(a);
      return a;
    }
    const els = [...a.shape.elements];
    const holes = [...(a.shape.holes ?? [])];
    while (els.length < iv) {
      holes.push(els.length); // 越界写增长段是 hole（原生 [1].x=3 中间槽不存在）
      els.push(undef());
    }
    els[iv] = asAbsVal(value);
    // 写 hole 位置：槽被填实，清除 hole 标记
    const hi = holes.indexOf(iv);
    if (hi >= 0) holes.splice(hi, 1);
    // 就地写回：别名（const b=a）同步（JS 引用语义）
    a.shape = { k: "tuple", elements: els, holes: holes.length > 0 ? holes : undefined };
    clearStaleTermPred(a);
    return a;
  }
  // 非（整数下标 tuple）目标：按目标种类分派（strict/ESM 语义；此前一律
  // `return a` 静默——o[k]=v 计算键写对象假精确 no-op、空值/prim 不抛）
  const sk = a.shape.k;
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
    if (getBClass(a.shape.name)) return $set(a, String(iv), value);
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

/** 数组/字符串长度 */
export function $len(a: Abs): Abs {
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
    return abs({ k: "prim", type: "number" }, undefined, undefined, "path");
  }
  if (a.shape.k === "sum") {
    // 全成员长度同字面量 → 折叠（fork join 后 a.length 常见场景）；
    // 否则 number（成员长度可能不同）
    const lens = a.shape.members.map((m) => $len(m));
    const lits = lens.map(litValue);
    if (lits.length > 0 && lits.every((v) => v !== undefined && v === lits[0])) {
      return lens[0]!;
    }
    return abs({ k: "prim", type: "number" }, undefined, undefined, "path");
  }
  const sv = litValue(a);
  if (typeof sv === "string") {
    return abs(
      { k: "prim", type: "number" },
      { op: "lit", value: sv.length },
      pTrue,
      "exact",
    );
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

/** 对象字面量 → Abs obj */
export function $obj(slots: Record<string, Abs>): Abs {
  const s: Record<string, { value: Abs }> = {};
  for (const [k, v] of Object.entries(slots)) s[k] = { value: asAbsVal(v) };
  return objOf(s);
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
        slots[k] = { value: fn.get(bb) };
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

/**
 * 解构 rest：`const { a, ...rest } = o` → rest = o 去掉 named keys。
 * closed obj：剩余槽 closed；open / optional 键：rest 仍 open（可能有未知键）。
 */
export function $objRest(o: Abs, keys: string[]): Abs {
  o = asAbsVal(o);
  if (o.shape.k === "sum") {
    return o.shape.members
      .map((m) => $objRest(m, keys))
      .reduce((a, b) => joinAbs(a, b));
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
    slots[k] = s;
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
  a = asAbsVal(a);
  if (a.shape.k === "sum") {
    return a.shape.members.map((m) => $arrRest(m, start)).reduce((x, y) => joinAbs(x, y));
  }
  if (a.shape.k === "tuple") {
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
  const av = litValue(a);
  if (typeof av === "string") {
    return $concat($arr([...av].map((c) => $lit(c))), b);
  }
  const bv = litValue(b);
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
    const ea: Abs = as.k === "tuple"
      ? as.elements.reduce((x, y) => joinAbs(x, y))
      : as.k === "arr"
        ? as.element
        : a;
    const eb: Abs = bs.k === "tuple"
      ? bs.elements.reduce((x, y) => joinAbs(x, y))
      : bs.k === "arr"
        ? bs.element
        : b;
    return abs({ k: "arr", element: joinAbs(ea, eb) }, undefined, undefined, "path");
  }
  // 剩余：至少一侧非 tuple/arr/string 字面量。
  // 字面量不可迭代值 spread → 原生 TypeError（[...5]/[...null]/[...true]）
  const throwIfNonIterable = (x: Abs): void => {
    if (x.term?.op !== "lit") return;
    const v = x.term.value;
    if (
      typeof v === "number" ||
      typeof v === "boolean" ||
      typeof v === "bigint" ||
      typeof v === "symbol" ||
      v === null ||
      v === undefined
    ) {
      throw new NudoThrow(errorTypeAbs("TypeError"));
    }
  };
  throwIfNonIterable(a);
  throwIfNonIterable(b);
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
    if (expanded) return expanded.reduce((u, y) => joinAbs(u, y));
    if (x?.shape?.k === "any") return anyMemberResult();
    if (x?.shape?.k === "tuple") {
      const els = x.shape.elements;
      // 空 tuple spread 不贡献元素 → never；join(never, any) = any
      return els.length ? els.reduce((u, y) => joinAbs(u, y)) : abs({ k: "never" }, undefined, undefined, "exact");
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

/** 元素列表（tuple 展开；arr 抽象；C1 Set/Map 逐条目；matchAll 迭代器逐匹配项；
 *  字符串按 code points）。Map 迭代语义是 entry `[key, value]` 元组，不是裸 value。 */
export function $elems(a: Abs): Abs[] {
  if (a.shape.k === "tuple") return [...a.shape.elements];
  if (a.shape.k === "arr") return [a.shape.element];
  if (isSetAbs(a)) return setElementsAbs(a);
  if (isMapAbs(a)) return mapEntriesAbs(a);
  const mi = matchIterElements(a);
  if (mi) return mi;
  const sv = litValue(a);
  if (typeof sv === "string") return [...sv].map((c) => $lit(c));
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
    const members = shape.members.map((m) => $forInKeys(m));
    return members.reduce((a, b) => joinAbs(a, b));
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
    const keys = Object.keys(shape.slots);
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
  const sv = litValue(o);
  if (typeof sv === "string") {
    return $arr(Array.from({ length: sv.length }, (_, i) => $lit(String(i))));
  }
  return $arr([]);
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
  },
): void {
  const pack = opts?.pack;
  const unpack = opts?.unpack;
  let exitJoin: Abs | undefined;
  const snapExit = (): void => {
    if (!pack) return;
    const s = pack();
    exitJoin = exitJoin ? joinAbs(exitJoin, s) : s;
  };
  const applyExitJoin = (): void => {
    if (!exitJoin || !pack || !unpack) return;
    unpack(joinAbs(exitJoin, pack()));
  };

  const shape = iterable.shape;
  const items = $elems(iterable);
  const sv = litValue(iterable);
  // tuple / 确切 Set·Map 条目数 / 字符串字面量 code points → 有界展开；
  // 抽象 arr 与 maybeAbsent 仍 0..max join
  const knownLen =
    shape.k === "tuple"
      ? shape.elements.length
      : typeof sv === "string"
        ? [...sv].length
        : collectionExactLen(iterable);
  // 非具体容器：长度未知（可能空、可能更长）→ 单代表元素只跑一次
  // （同一元素重复 join 幂等，maxIters 次展开只会让索引假精确 + 大数组
  // 反复深拷贝把分析拖死）；0 次出口由下方 snapExit join，保持 sound。
  const unbounded = knownLen === undefined;

  if (unbounded) snapExit();

  const n =
    knownLen !== undefined
      ? Math.min(knownLen, maxIters)
      : items.length > 0
        ? 1
        : 0;

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
        applyExitJoin();
        return;
      }
      if (isNudoContinue(e, opts?.label)) continue; // 下一个元素；已发生副作用保留
      if (isNudoReturn(e) || isNudoThrow(e)) throw e;
      throw e;
    }
    if (unbounded) snapExit();
  }
  if (unbounded && n === 0) snapExit();
  applyExitJoin();
}

/**
 * 命名空间身份表：transpile 后 `Math.max(0, x)` 的接收者是宿主 JS 全局对象
 * （非 Abs）。按对象身份识别命名空间，路由到 Abs builtin 表。
 */
export function namespaceNameOf(v: unknown): string | undefined {
  if (typeof v !== "object" && typeof v !== "function") return undefined;
  if (v === Math) return "Math";
  if (v === Number) return "Number";
  if (v === JSON) return "JSON";
  if (v === Object) return "Object";
  if (v === Array) return "Array";
  if (v === String) return "String";
  if (v === Date) return "Date";
  if (v === Promise) return "Promise";
  return undefined;
}

/** 正则字面量 → RegExp brand（source/flags/lastIndex 进 slots，供 exec/test 精确执行） */
export function $regex(pattern: string, flags = ""): Abs {
  return regexBrandAbsFrom(pattern, flags);
}

/** 成员读：obj.slots[key]；缺失 → undefined 字面量；brand 解包内层 */
export function $get(
  o: Abs,
  key: string,
  opts?: { /** 调用方已负责诊断（如 $invoke） */ silent?: boolean },
): Abs {
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
    });
  }
  if (o.shape.k === "brand") {
    if (o.shape.name.endsWith(".prototype") && (key === "toString" || key === "toLocaleString" || key === "join")) {
      const ctorName = o.shape.name.slice(0, -".prototype".length);
      if (ctorName === "Array") return arrayMethodAbs(key === "join" ? "join" : key);
    }
    const isClassVal = classNameOfValue(o as object) === o.shape.name;
    // 内建 brand 原型方法读取（typeof m.forEach / m[Symbol.iterator]）：
    // 方法实现由 $invoke 派发，此处给可 typeof 的 fn 形状
    // （class 声明值同名内建时不误伤：类方法走 registry）
    const builtinM = BUILTIN_BRAND_METHODS[o.shape.name];
    if (builtinM && !isClassVal && (key === "@@iterator" || builtinM.has(key))) {
      return absFunction([], { body: noBody });
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
      for (const n of bClassChain(o.shape.name)) {
        const spec = getBClass(n);
        if (spec?.staticMethods?.[key]) {
          return absFunction(spec.staticMethodParams?.[key] ?? [], { body: noBody });
        }
      }
      // 类值是 constructor 函数：prototype 对象与 Function.prototype 成员
      if (key === "prototype") {
        return abs({ k: "obj", slots: {} }, undefined, undefined, "path");
      }
      if (key === "call" || key === "apply" || key === "bind") {
        return absFunction([], { body: noBody });
      }
    } else {
      const acc = findClassAccessor(o.shape.name, key);
      if (acc) return acc.get ? acc.get(o) : undef();
      // 实例上读静态访问器键 → 原生 undefined（属性在构造器上）
      if (findStaticClassAccessor(o.shape.name, key)) return undef();
      // 实例方法读取（typeof a.m / 一等值）：沿继承链在 registry 找方法
      // 未调用方法槽带 AST 形参展示名（不再假零参）
      for (const n of bClassChain(o.shape.name)) {
        const spec = getBClass(n);
        if (spec?.methods?.[key]) {
          return absFunction(spec.methodParams?.[key] ?? [], { body: noBody });
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
  // 数组 length：成员路径（a.length += 1 等复合写）与 a.length 读同源
  if ((o.shape.k === "tuple" || o.shape.k === "arr") && key === "length") {
    return $len(o);
  }
  // 元组/数组/prim 上的 Object.prototype 方法读取
  if (
    (o.shape.k === "tuple" || o.shape.k === "arr" || o.shape.k === "prim") &&
    OBJECT_PROTO_METHOD_NAMES.has(key) &&
    !(o.shape.k === "prim" && o.shape.type === "string" && key === "toString")
  ) {
    if ((o.shape.k === "tuple" || o.shape.k === "arr") && (key === "toString" || key === "toLocaleString" || key === "join")) {
      return arrayMethodAbs(key === "join" ? "join" : key);
    }
    // string.toString/valueOf 由 callAbsMethod 处理调用；一等读取仍给 OP 函数
    return objectProtoMethodAbs(key);
  }
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
    const parts = o.shape.members.map((m) => $get(m, key, opts));
    return parts.reduce((a, b) => joinAbs(a, b));
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
 * 回调是 B 路径 JS 函数（transpile 内联箭头）直接调用；Abs fn 走 $call。
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
        inner.shape.slots[key] = { value: asAbsVal(value) };
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
    const v = litValue(value);
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
    const v = litValue(value);
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
  // 就地写槽（引用语义：const b = o; b.x = v 对 o 可见）——Abs 身份不变
  shape.slots[key] = { value: asAbsVal(value) };
  o.conf = confJoin(o.conf, value.conf);
  clearStaleTermPred(o);
  return o;
}
