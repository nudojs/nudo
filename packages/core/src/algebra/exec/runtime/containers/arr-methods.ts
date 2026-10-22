/**
 * 数组就地 mutator 族（push/unshift/pop/shift/splice/reverse/sort/
 * copyWithin/fill）。
 *
 * Invariants:
 * - 就地写回：shape/conf 替换但 Abs 身份不变（JS 引用语义——
 *   `const b = a; b.push(4)` 对 a 可见）；旧 term/pred 不再描述新
 *   shape，一并清除（writeInPlace/clearStaleTermPred）。
 * - 下标/边界实参经 ToIntegerOrInfinity：symbol/bigint 确定 TypeError；
 *   抽象 → may（空接收者同样先校验）；values 实参不校验（原生存储不转换）。
 * - mutator 降 arr（splice 等）的元素域 = 全部观测元素 join——不并入
 *   OOB undefined（issue #156 元素域约定）。
 * - 完整性门（Bug 223）：frozen 任何 mutator 抛；sealed 的**结构性扩展**
 *   （push/unshift/splice）与**删除既有自有属性**（pop/shift 命中自有元素）
 *   抛 TypeError；空数组 / 空洞位 / preventExtensions（nonext）不抛。
 */
import type { Abs } from "../../../abs.ts";
import { abs, confJoin, litValue, numLit, unknown, type Confidence } from "../../../abs.ts";
import { lit } from "../../../term.ts";
import { pTrue } from "../../../pred.ts";
import { getFnImpl } from "../../../abs-fn.ts";
import {
  getSlot,
  joinAbs,
  setSlot,
} from "../../../objects.ts";
import { accessorKeysOf } from "../../../accessors.ts";
import {
  extStateOf,
  isSymbolAbs,
} from "../../../builtins.ts";
import { validateCallableArg, validateIndexArg, applyCallbackAbs } from "../../../hof.ts";
import { emptyEnv } from "../../../ast-env.ts";
import { defaultLeakBudget } from "../../../leak.ts";
import { errorTypeAbs, recordMayThrow } from "../../may-throw.ts";
import {
  NudoThrow,
  undef,
  throwStrictWrite,
  writeInPlace,
  asAbsVal,
  $lit,
} from "../state.ts";

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

/**
 * Bug 270 / 1051：ToIntegerOrInfinity 实参的**四态**（缺省 / 显式 undefined /
 * 数值 / 不可判定）。
 *
 * `toIOI` 只回答「数值是多少」，把「实参缺省」与「显式 undefined 实参」都折成
 * undefined——但原生两者语义**不同**：
 * - `Array.prototype.lastIndexOf(x)` 起始下标 = `len-1`；`lastIndexOf(x, undefined)`
 *   = 0（`ToIntegerOrInfinity(undefined) = 0`）⇒ 前者扫全表、后者只扫第 0 位；
 * - `toSpliced()` 零实参 ⇒ start 缺省 ⇒ **不删**；`toSpliced(0, undefined)` ⇒
 *   skipCount 在场（undefined ⇒ 0）⇒ **不删**；`toSpliced(0)` ⇒ skipCount 缺省
 *   ⇒ 删到尾。
 *
 * 本函数在 `toIOI` 的数值判定之上只补「实参在不在 + 显式 undefined ⇒ 0」这一维
 * （`toIOI` 仍是数值判定的单一事实源，不重造 ToIntegerOrInfinity）。
 */
export type ToIOIArg =
  | { kind: "absent" }
  | { kind: "num"; n: number }
  | { kind: "unknown" };

export function toIOIArg(v: Abs | undefined): ToIOIArg {
  if (v === undefined) return { kind: "absent" };
  const ioi = toIOI(v);
  if (ioi === null) return { kind: "unknown" };
  // toIOI 对「显式 undefined 字面量」返回 undefined ⇒ ToIntegerOrInfinity(undefined) = 0
  if (ioi === undefined) return { kind: "num", n: 0 };
  return { kind: "num", n: ioi };
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
  // Bug 255：value 实参**缺省** ⇒ 原生 `fill(undefined)`——填的是「确定
  // undefined」（lit undefined），**不是**裸 unknown：裸 unknown 的元素域
  // 含任意值 ⇒ 下游 join 会误报「元素可能是 symbol ⇒ ToString 抛」
  // （L2 entry-may-throw 假红）。
  const v = vals[0] ?? undef();
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
 * sort 的元组排序面（$arrMutContainer 与 invokeArrMethod 共用的单一事实源）：
 * 默认比较器（缺省 / 严格 undefined）+ 全字面量元素 → 精确排序
 * （undefined 恒排尾不参与比较；≥2 个可比较元素含 symbol → ToString
 * 比较，确定 TypeError）。
 * M4：比较器在场 → 仅 effectFree facet（transpile 保守静态判定）回调真
 * 执行——原生调用次数是引擎不可知的算法内部量，副作用回调多执行不可
 * 回滚（外层绑定 n++ 错定值），无 facet 一律降级不执行。effectFree 时：
 * - ≤24 个可比较元素：全有序对调用并缓存符号——全对抛 → 定抛（原生首
 *   调必为某有序对）；部分抛 → may + 降级；全数值 → 反对称/传递一致 →
 *   稳定插入排序精确折叠（一致比较器的稳定序唯一，ES2019 起原生保证
 *   稳定）；不一致 → 降级（原生序依赖算法细节）；
 * - >24：单探针（首对不可知）抛 → may + 降级，否则直接降级。
 * 调用方自行做 GetSortComparator 校验。
 *
 * **空洞（hole）语义**（Bug 222）——原生两种形态不同：
 * - 就地 `sort`：hole 位**不参与比较**、比较器看不到它、排序后**仍是
 *   hole**（Object.keys 不含它 / `in` 为 false / HOF 跳过）——V8 实测
 *   `[3,,1].sort()` → keys ["0","1"]、长度 3。
 * - `toSorted`：拷贝面走 Get（hole 读成 undefined 并**写实**为元素）→
 *   结果是**真实 undefined 元素**（keys ["0","1","2"]）。
 * opts.preserveHoles=true 即就地 sort 语义（默认 false = toSorted 语义）。
 */
const SORT_CMP_SWEEP_CAP = 24;

export function sortTupleAbs(
  arr: Abs,
  cmp: Abs | undefined,
  opts?: {
    /**
     * 原生**就地 sort** 保留空洞：hole 位不参与比较、末尾仍是 hole
     * （Object.keys 不含 / `in` false / HOF 跳过）。默认 false = toSorted
     * 语义（hole 按 Get 读成 undefined 并写实为元素）。
     */
    preserveHoles?: boolean;
  },
): Abs {
  const shape = arr.shape as { k: "tuple"; elements: Abs[]; holes?: number[] };
  const holes = shape.holes ?? [];
  const holeSet = new Set(holes);
  const preserveHoles = opts?.preserveHoles === true;
  // hole 位：sort 下保留（不参与比较、末尾仍是 hole）；toSorted 下按 Get
  // 语义读成 undefined 元素（原生拷贝面把 hole 写实）。
  const slots = preserveHoles
    ? [...shape.elements]
    : shape.elements.map((el, i) => (holeSet.has(i) ? undef() : el));
  const isUndefLit = (el: Abs): boolean =>
    el.term?.op === "lit" && el.term.value === undefined;
  // hole 位（仅 sort 语义）与真实 undefined 元素都**不参与比较**——原生
  // 比较器既看不到 hole 也看不到 undefined 元素（V8 实测：undefined 元素
  // 同样不传给比较器，只在末尾保留）。
  const isHoleAt = (i: number): boolean => preserveHoles && holeSet.has(i);
  const isComparable = (el: Abs, i: number): boolean =>
    !isUndefLit(el) && !isHoleAt(i);
  // 真实 undefined 元素（sort 语义下不含 hole；toSorted 语义下 hole 已并入）
  const undefEls = slots.filter((el, i) => isUndefLit(el) && !isHoleAt(i));
  const asAbsOrNull = (v: unknown): Abs | null => {
    const a = asAbsVal(v);
    return a && typeof a === "object" && "shape" in a ? a : null;
  };
  const cmpAbs = cmp === undefined ? undefined : asAbsOrNull(cmp);
  const isDefaultCmp =
    cmp === undefined ||
    (!!cmpAbs?.term &&
      cmpAbs.term.op === "lit" &&
      (cmpAbs.term as { value: unknown }).value === undefined);
  const degrade = (): Abs => {
    const el = shape.elements.length
      ? shape.elements.reduce((x, y) => joinAbs(x, y))
      : unknown;
    return abs({ k: "arr", element: el }, undefined, undefined, confJoin(arr.conf, "path"));
  };
  // 结果元组：排序后的可比元素 + 真实 undefined 元素 + （sort 保留的）空洞
  // （空洞位写 undef() 占位并登记 holes 下标——读面 Object.keys / `in` /
  // HOF 依 holes 跳过，与原生一致）。
  const buildResult = (ordered: Abs[]): Abs => {
    const holeEls = preserveHoles ? holes.map(() => undef()) : [];
    const els = [...ordered, ...undefEls, ...holeEls];
    const holeIdx =
      holeEls.length > 0
        ? Array.from({ length: holeEls.length }, (_, k) => els.length - holeEls.length + k)
        : undefined;
    return abs(
      { k: "tuple", elements: els, holes: holeIdx },
      undefined,
      undefined,
      confJoin(arr.conf, "path"),
    );
  };
  if (isDefaultCmp) {
    const comparable = slots.filter((el, i) => isComparable(el, i));
    if (comparable.length >= 2 && comparable.some((el) => isSymbolAbs(el))) {
      throw new NudoThrow(errorTypeAbs("TypeError"));
    }
    if (slots.every((el) => el.term?.op === "lit")) {
      const vals = slots.map((el) => {
        const r = litValue(el);
        return r.ok ? r.value : undefined;
      });
      if (vals.every((v) => v === undefined || typeof v !== "object")) {
        // 只有可比元素参与排序（hole 与 undefined 元素排尾、不参与比较）
        const sortedVals = vals.filter((_, i) => isComparable(slots[i]!, i)).sort();
        return buildResult(sortedVals.map((v) => $lit(v)));
      }
    }
    return degrade();
  }
  // M4：比较器在场
  if (cmpAbs && getFnImpl(cmpAbs)?.effectFree) {
    const comparableIdx = slots
      .map((el, i) => (isComparable(el, i) ? i : -1))
      .filter((i) => i >= 0);
    const n = comparableIdx.length;
    if (n < 2) return degrade(); // 比较器原生不会被调用
    if (n > SORT_CMP_SWEEP_CAP) {
      // 单探针：原生首调用对不可知 → 抛只能 may（不得定抛）
      try {
        applyCallbackAbs(
          cmpAbs, [slots[comparableIdx[0]]!, slots[comparableIdx[1]]!],
          emptyEnv(), pTrue, defaultLeakBudget,
        );
      } catch (e) {
        if (e instanceof NudoThrow) {
          recordMayThrow({
            kind: "Error",
            cause: "sort comparator may throw",
          });
        }
      }
      return degrade();
    }
    // 全有序对调用，缓存 ToNumber 符号（NaN → 0，与原生 sortCompare 折 +0 同语义）。
    // 「抛事件」= NudoThrow（比较器体抛）或 symbol/bigint 字面量返回（ToNumber
    // 确抛 TypeError，仅当该对真被比较）。全对事件 → 原生首调必抛 → 定抛
    //（载荷 = 全部事件 join：原生首对是哪一个不可知）；部分 → may + 降级。
    const signs: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    let invocations = 0;
    let throwEvents = 0;
    let throwPayload: Abs | undefined;
    const noteThrow = (payload: Abs): void => {
      throwEvents++;
      throwPayload = throwPayload === undefined ? payload : joinAbs(throwPayload, payload);
    };
    let nonNumeric = false;
    outer: for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        let r: Abs;
        try {
          r = applyCallbackAbs(
            cmpAbs, [slots[comparableIdx[i]!], slots[comparableIdx[j]!]],
            emptyEnv(), pTrue, defaultLeakBudget,
          );
        } catch (e) {
          if (e instanceof NudoThrow) {
            noteThrow(e.absValue);
            continue;
          }
          throw e;
        }
        invocations++;
        // ToNumber（字面量真折叠；symbol/bigint → 该对 ToNumber 确抛）
        const t = r.term;
        if (t?.op !== "lit") {
          nonNumeric = true; // 抽象返回值：可能 symbol/bigint（may）也可能 NaN
          recordMayThrow({
            kind: "TypeError",
            cause: "sort comparator return may not be convertible to a number",
          });
          break outer;
        }
        const v = (t as { value: unknown }).value;
        if (typeof v === "symbol" || typeof v === "bigint") {
          noteThrow(errorTypeAbs("TypeError"));
          continue;
        }
        const num =
          typeof v === "number" ? v
          : typeof v === "boolean" ? (v ? 1 : 0)
          : v === null ? 0
          : v === undefined ? NaN
          : Number(v); // string 字面量：宿主 ToNumber 精确
        signs[i]![j] = num > 0 ? 1 : num < 0 ? -1 : 0;
      }
    }
    if (invocations === 0 && throwPayload !== undefined) {
      // 全对抛：原生首调必抛 → 定抛（载荷 join，见上）
      throw new NudoThrow(throwPayload);
    }
    if (throwEvents > 0) {
      recordMayThrow({ kind: "Error", cause: "sort comparator may throw" });
      return degrade();
    }
    if (nonNumeric) return degrade();
    // 一致性：反对称 + 传递（含等价传递）——一致比较器的稳定序唯一
    let consistent = true;
    for (let i = 0; i < n && consistent; i++) {
      for (let j = i + 1; j < n && consistent; j++) {
        if (signs[i]![j]! !== -signs[j]![i]!) {
          consistent = false;
          break;
        }
      }
    }
    if (consistent) {
      check: for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          if (i === j) continue;
          for (let k = 0; k < n; k++) {
            if (k === i || k === j) continue;
            const sij = signs[i]![j]!;
            const sjk = signs[j]![k]!;
            const sik = signs[i]![k]!;
            if ((sij > 0 && sjk > 0 && sik <= 0) ||
                (sij < 0 && sjk < 0 && sik >= 0) ||
                (sij === 0 && sjk === 0 && sik !== 0)) {
              consistent = false;
              break check;
            }
          }
        }
      }
    }
    if (!consistent) return degrade(); // 原生序依赖算法细节
    // comparableIdx 原下标 → signs 矩阵行/列下标映射
    const rowOf = new Map(comparableIdx.map((idx, r) => [idx, r] as const));
    // 稳定插入排序（等值保序 = ES2019 稳定性；一致比较器下序唯一）
    const order = comparableIdx.slice();
    for (let i = 1; i < order.length; i++) {
      const cur = order[i]!;
      const curRow = rowOf.get(cur)!;
      let j = i - 1;
      while (j >= 0 && signs[rowOf.get(order[j]!)!]![curRow]! > 0) {
        order[j + 1] = order[j]!;
        j--;
      }
      order[j + 1] = cur;
    }
    // 结果：排序后的可比元素 + 真实 undefined 元素 + （sort 保留的）空洞
    return buildResult(order.map((idx) => slots[idx]!));
  }
  return degrade();
}

/**
 * Bug 254：mutator 家族的**泛型接收者**写面（数组样对象 `{length, 0: …}`）。
 *
 * 原生 `Array.prototype.push/pop/shift/unshift/splice` 只要求接收者
 * `ToObject(O)` 后有**可写的 length** 与索引属性——数组样对象（array-like）
 * 与字符串包装走同一条实现（规范：`Set(O, "length", n)` /
 * `CreateDataPropertyOrThrow(O, k, v)` / `DeletePropertyOrThrow(O, k)`）。
 * 此前 `$arrMutContainer` 对非 tuple/arr 形状**早退**（原样返回接收者）⇒ 写入
 * 被静默丢弃：长度不变、元素不变、不记 may-throw、不标 open（假绿）。
 *
 * 口径（可判定时精确，不可判定时诚实降级）：
 * - 接收者须是**闭 obj**（slots 可写；open obj / 抽象 index 槽 / 带访问器侧表
 *   ⇒ 写面不可建模 ⇒ 记 may-throw 后不写）；
 * - `length` 槽经 ToLength 折叠（number/string/bool/null/undefined；bigint/symbol
 *   → 确定 TypeError；抽象 length → 记 may-throw 后不写）；
 * - 索引槽按规范写/删（**就地改 slots**——Abs 身份与 shape 身份都不变 ⇒ 别名
 *   （`const b = o`）与成员槽同步可见）。
 */
function mutateArrayLike(arr: Abs, method: string, args: Abs[]): Abs {
  const shape = arr.shape as {
    k: string;
    slots?: Record<string, { value: Abs }>;
    open?: boolean;
    index?: unknown;
  };
  if (shape.k !== "obj" || !shape.slots || shape.open || shape.index) {
    // 形态不可判（open obj / 抽象 index 槽 / 非 obj）⇒ 记 may-throw + 不写
    recordMayThrow({
      kind: "TypeError",
      cause: `${method} on a non-array receiver may write an unknown length`,
    });
    return arr;
  }
  if (accessorKeysOf(arr).length > 0) {
    // 访问器侧表（getter/setter）——写面不可建模（setter 派发 / getter 语义）
    recordMayThrow({
      kind: "TypeError",
      cause: `${method} on an array-like receiver with accessors may write through a setter`,
    });
    return arr;
  }
  const slots = shape.slots;
  const len = arrayLikeLengthOf(slots);
  if (len === undefined) return arr;
  const vals = args.map((a) => asAbsVal(a));
  const readIdx = (i: number): Abs | undefined => getSlot(slots, String(i))?.value;
  const writeIdx = (i: number, v: Abs): void => {
    setSlot(slots, String(i), { value: v });
  };
  const delIdx = (i: number): void => {
    delete slots[String(i)];
  };
  const setLen = (n: number): void => {
    setSlot(slots, "length", { value: numLit(n) });
  };
  if (method === "push") {
    for (let i = 0; i < vals.length; i++) writeIdx(len + i, vals[i]!);
    setLen(len + vals.length);
    return arr;
  }
  if (method === "unshift") {
    const n = vals.length;
    for (let k = len - 1; k >= 0; k--) {
      const v = readIdx(k);
      if (v !== undefined) writeIdx(k + n, v);
      else delIdx(k + n);
    }
    for (let i = 0; i < n; i++) writeIdx(i, vals[i]!);
    setLen(len + n);
    return arr;
  }
  if (method === "pop") {
    if (len === 0) {
      setLen(0);
      return arr;
    }
    delIdx(len - 1);
    setLen(len - 1);
    return arr;
  }
  if (method === "shift") {
    if (len === 0) {
      setLen(0);
      return arr;
    }
    for (let k = 1; k < len; k++) {
      const v = readIdx(k);
      if (v !== undefined) writeIdx(k - 1, v);
      else delIdx(k - 1);
    }
    delIdx(len - 1);
    setLen(len - 1);
    return arr;
  }
  if (method === "splice") {
    // 规范 Array.prototype.splice（ES2023 22.1.3.26）：删 actualStart 起的
    // actualDeleteCount 个、items 插到 actualStart、length = len - del + items。
    validateIndexArg(args[0], "splice start may not be convertible to a number");
    validateIndexArg(args[1], "splice deleteCount may not be convertible to a number");
    const win = spliceWindow(len, toIOIArg(args[0]), toIOIArg(args[1]), args.length === 0);
    if (win === "unknown") {
      recordMayThrow({
        kind: "TypeError",
        cause: "splice on an array-like receiver with an abstract window",
      });
      return arr;
    }
    const { a, skip } = win;
    const items = vals.slice(2);
    // 规范 Array.prototype.splice（ES2023 22.1.3.26）：结果 = 头段 + items +
    // 尾段，写回接收者并把 length 设为 len - skip + items.length。
    // 逐位物化（头段 + items + 尾段）——避免搬移时互相覆盖。
    const next: (Abs | undefined)[] = [];
    for (let k = 0; k < a; k++) next.push(readIdx(k));
    for (const it of items) next.push(it);
    for (let k = a + skip; k < len; k++) next.push(readIdx(k));
    for (let k = 0; k < next.length; k++) {
      const v = next[k];
      if (v !== undefined) writeIdx(k, v);
      else delIdx(k);
    }
    for (let k = next.length; k < len; k++) delIdx(k);
    setLen(next.length);
    return arr;
  }
  // reverse / sort / copyWithin / fill：原地数组算法在泛型接收者上无对应写面
  // （规范要求可写 length + 索引属性，但算法语义依赖数组内部序）⇒ 记 may-throw
  recordMayThrow({
    kind: "TypeError",
    cause: `${method} on a non-array receiver has no modelled write surface`,
  });
  return arr;
}

/** 数组样接收者的 `length` 槽 → ToLength；undefined = 不可判定（已记 may-throw） */
function arrayLikeLengthOf(slots: Record<string, { value: Abs }>): number | undefined {
  const lenAbs = getSlot(slots, "length")?.value;
  if (lenAbs === undefined) return 0; // 无 length 槽 ⇒ ToLength(undefined) = 0
  const lvR = litValue(lenAbs);
  const lv = lvR.ok ? lvR.value : undefined;
  if (lv === undefined) {
    if (lenAbs.term?.op === "lit") return 0; // lit undefined ⇒ ToLength = 0
    recordMayThrow({
      kind: "TypeError",
      cause: "array-like length is not a concrete number",
    });
    return undefined;
  }
  if (typeof lv === "bigint" || typeof lv === "symbol") {
    // ToNumber(bigint/symbol) 确定 TypeError
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  const n = typeof lv === "number" ? lv : Number(lv); // string / boolean / null
  if (Number.isNaN(n)) return 0;
  return Math.min(Math.max(Math.trunc(n), 0), Number.MAX_SAFE_INTEGER);
}

/**
 * Bug 270：ES2023 `splice` / `toSpliced` 的**删除窗口**（同一 spec 规则的
 * 单一实现——两臂共用，杜绝分叉）。
 *
 * 原生规则（ES2023 Array.prototype.splice / toSpliced）：
 * - `splice()` **零实参** ⇒ 实际参数个数为 0 ⇒ `actualDeleteCount = 0`
 *   （**不删**）；`toSpliced()` **start 缺省** ⇒ `actualSkipCount = 0`
 *   （**不删**）；
 * - start 在场、skipCount **缺省** ⇒ 删到尾（`len - actualStart`）；
 * - skipCount **在场**（含显式 `undefined` ⇒ `ToIntegerOrInfinity(undefined) = 0`）
 *   ⇒ 夹到 `[0, len - actualStart]`。
 *
 * 此前两臂都把「skipCount 缺省」与「skipCount 显式 undefined」混为一谈
 * （`toIOI` 对两者都返回 undefined）⇒ `toSpliced()` / `toSpliced(0, undefined)`
 * 把整个数组删空（原生**原样保留**）。
 *
 * @param zeroArgs 实参个数为 0（仅 `splice()` 命中——toSpliced 的「start 缺省」
 *        由 `start.kind === "absent"` 表达）
 */
export function spliceWindow(
  len: number,
  start: ToIOIArg,
  skip: ToIOIArg,
  zeroArgs: boolean,
): { a: number; skip: number } | "unknown" {
  if (start.kind === "unknown" || skip.kind === "unknown") return "unknown";
  const s = start.kind === "absent" ? 0 : start.n;
  const a = s < 0 ? Math.max(len + s, 0) : Math.min(s, len);
  // start 缺省 ⇒ 不删（splice 零实参 / toSpliced 零实参）
  if (zeroArgs || start.kind === "absent") return { a, skip: 0 };
  const skipCount =
    skip.kind === "absent" ? len - a : Math.max(0, Math.min(skip.n, len - a));
  return { a, skip: skipCount };
}

/** 数组/元组方法（push/pop/shift/unshift/splice/reverse/sort/copyWithin/fill）
 *  的就地 mutator：Abs 身份不变（JS 引用语义——`const b = a; b.push(4)` 对 a
 *  可见）。$invoke 的 mutator 分支在**调用点**即刻执行本函数（表达式求值
 *  顺序正确，Bug 49/51），别名 / 成员槽 / Map 条目经共享 Abs 同步可见。 */
export function $arrMutContainer(arr: Abs, method: string, args: Abs[]): Abs {
  const shape = arr.shape;
  if (shape.k !== "tuple" && shape.k !== "arr") {
    // Bug 254：泛型接收者（数组样对象）——原生 mutator 家族只要求接收者有
    // 可写的 length 与索引属性 ⇒ 走同一写面（此前早退 ⇒ 写入被静默丢弃）。
    return mutateArrayLike(arr, method, args);
  }
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
  // Bug 223：sealed 数组的元素是**不可配置**自有属性 → pop/shift 的**删除**
  // 动作即 TypeError（原生硬抛："Cannot delete property 'N' of [object Array]"）。
  // 判定按原生逐步语义（node 实测）：
  // - 空数组原生**不抛**（不删任何属性）；
  // - 空洞（hole）不是自有属性 → 删它不抛：`Object.seal([1,,]).pop()` 原生不抛；
  // - 但 shift 会把后续元素**前移**到空洞位 → 在不可扩展（sealed）数组上新增
  //   自有属性 → 抛：`Object.seal([,,3]).shift()` 原生抛（Cannot add property）。
  //   即：shift 抛 ⟺ 下标 0 是自有属性 ∨ 存在下标 ≥ 1 的自有属性。
  // - preventExtensions（nonext）**不**冻结元素 → 截断**不**抛（node 实测：
  //   `Object.preventExtensions([1,2]).pop()` 不抛）——故 nonext 不入本门。
  if (st === "sealed" && (method === "pop" || method === "shift")) {
    if (shape.k === "tuple") {
      const holes = shape.holes;
      // 自有属性 ⟺ 该下标不是空洞
      const own = (i: number) => holes === undefined || !holes.includes(i);
      if (shape.elements.length > 0) {
        if (method === "pop") {
          if (own(shape.elements.length - 1)) throwStrictWrite();
        } else if (own(0) || shape.elements.some((_, i) => i > 0 && own(i))) {
          throwStrictWrite();
        }
      }
    } else {
      // 抽象数组长度不可知 → may（空数组不抛、非空抛）
      recordMayThrow({
        kind: "TypeError",
        cause: "pop/shift on a sealed array may delete a non-configurable element",
      });
    }
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
    //（此前比较器实参完全未读）。默认比较器 + 全字面量元组 → 精确排序
    //（sortTupleAbs，与表达式位同一事实源）；否则降 arr（元素 join）。
    validateCallableArg(vals[0], "sort comparator may not be callable", {
      undefinedOk: true,
    });
    if (shape.k === "tuple") {
      // 就地 sort：原生**保留空洞**（hole 不参与比较、末尾仍是 hole——
      // Object.keys 不含 / `in` false / HOF 跳过，Bug 222）。toSorted 走
      // Get 语义（hole → 真实 undefined 元素），由 invoke-arr 侧默认语义。
      return writeBack(sortTupleAbs(arr, vals[0], { preserveHoles: true }));
    }
    return arr;
  }
  return arr;
}
