/**
 * Object.assign 语义（运行时 `= Object.assign(target, ...src)` 展开）。
 *
 * Invariants:
 * - 确定非对象目标（prim/nullish）原生 TypeError → throwStrictAssign 硬抛；
 *   抽象目标 may-throw 软记录（值域投影不变）。
 * - getter 源成员按源接收者求值后拷为数据槽（原生 [[Get]] 语义）。
 */
import type { Abs } from "../../abs.ts";
import { abs, unknown, confJoin, bool, str } from "../../abs.ts";
import { joinAbs, canonicalArrayIndex, setProtoAbs, setSlot } from "../../objects.ts";
import { $set, asAbsVal, lookupObjAccessor, clearStaleTermPred } from "../runtime.ts";
import { extStateOf, isEnumerableView, assignSourceSlots, primTargetAssignThrows, isSymbolAbs } from "../../builtins.ts";
import { classifyAssignSet } from "../../builtins/object/descriptor.ts";
import { TUPLE_MATERIALIZE_CAP } from "../../containers.ts";
// 直连 member.ts（不经 containers barrel）：本模块体加载期即回调本 setter，
// vite SSR 下 barrel 的 re-export 不是实例化期可用绑定（原单文件拓扑中
// setter 是本模块提升函数声明）。barrel 间接层会在此处拿到 undefined。
import { errorTypeAbs, recordMayThrow } from "../may-throw.ts";
import { NudoThrow } from "../runtime.ts";


function throwStrictAssign(): never {
  throw new NudoThrow(errorTypeAbs("TypeError"));
}

export function runtimeAssignObject(args: Abs[]): Abs {
  if (!args.length) return unknown;
  // target 字面量：null/undefined → TypeError 硬抛；装箱 prim → M5 抛错域
  //（与 builtins/object.ts evalObjectMethod "assign" 同口径：bigint 恒抛 /
  // string 下标写定抛 / number·bool 安全返原值）
  const t0 = asAbsVal(args[0]!);
  if (t0.term?.op === "lit") {
    if (t0.term.value === null || t0.term.value === undefined) {
      throw new NudoThrow(errorTypeAbs("TypeError"));
    }
    const dom = primTargetAssignThrows(t0, args.slice(1));
    if (dom === "definite") throw new NudoThrow(errorTypeAbs("TypeError"));
    if (dom === "may") {
      recordMayThrow({
        kind: "TypeError",
        cause: "Object.assign boxed target index write may be read-only",
      });
      return t0;
    }
    if (dom === "never") {
      // string → 折原始串（同 evalObjectMethod 口径）；number/bool →
      // 原生返回带 expando 的 wrapper → 有源时降级
      const type = (t0.shape as { k: "prim"; type: string }).type;
      if (args.length === 1 || type === "string") return t0;
    }
    return unknown;
  }
  // Bug 76：symbol prim target（无 lit 项——Symbol() 调用产物）→ 宿主
  // ToObject 定抛「Cannot convert a Symbol value to a string」（node 实测
  // assign(Symbol()) 无源也抛；number/string/boolean/bigint target 装箱合法）
  if (isSymbolAbs(t0)) {
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  // Bug 50：抽象 target（无 lit 项）可能 nullish → ToObject may TypeError
  //（与 builtins/object.ts evalObjectMethod "assign" 同口径；仅补 throws 效果）
  {
    const tk = t0.shape.k;
    const memberMayNullish = (m: Abs): boolean =>
      m.shape.k === "any" ||
      m.shape.k === "unknown" ||
      (m.term?.op === "lit" && (m.term.value === null || m.term.value === undefined));
    if (
      tk === "any" ||
      tk === "unknown" ||
      (tk === "sum" && (t0.shape as unknown as { members: Abs[] }).members.some(memberMayNullish))
    ) {
      recordMayThrow({
        kind: "TypeError",
        cause: "Object.assign target may be nullish (ToObject throws)",
      });
    }
  }
  const mergeObj = (accObj: Abs, srcAbs: Abs, st: "nonext" | "sealed" | "frozen" | undefined): void => {
    // 就地写槽（同 $set 引用语义：语句位置无需重绑、别名同步、Abs 身份不变）
    const base = (accObj.shape as Extract<Abs["shape"], { k: "obj" }>).slots;
    for (const [k, s] of Object.entries((srcAbs.shape as Extract<Abs["shape"], { k: "obj" }>).slots)) {
      // Object.assign 走 [[OwnPropertyKeys]] + EnumerableOwnProperties：
      // enumerable:false 自有键不拷贝（与 Object.keys 同口径）
      if (!isEnumerableView(srcAbs, k)) continue;
      // sealed/nonext 目标新键：strict [[Set]] 建键失败 → TypeError
      if (
        (st === "sealed" || st === "nonext") &&
        !Object.prototype.hasOwnProperty.call(base, k)
      ) {
        throwStrictAssign();
      }
      const a = lookupObjAccessor(srcAbs, k);
      const v = a?.get ? a.get(srcAbs) : s.value; // 源值走 [[Get]]
      // Bug 128：逐键 [[Set]]（OrdinarySet）语义——此前直写自有槽：
      // "__proto__" 继承访问器不触发（原型污染面：JSON.parse 源键被折成
      // 自有数据键、原型静默改写）、自有访问器 setter 被数据覆写、自有/
      // 继承非可写数据属性不拦截不抛。分类共享 classifyAssignSet
      //（builtins/object/methods.ts 的 assign 臂同源）。
      const plan = classifyAssignSet(accObj, k, v);
      if (plan.act === "throw") throwStrictAssign();
      if (plan.act === "write") setSlot(base, k, { value: v }); // "__proto__" 自有键经 setSlot（普通赋值触发宿主原型 setter，键静默丢失）
      else if (plan.act === "open") {
        (accObj.shape as Extract<Abs["shape"], { k: "obj" }>).open = true;
      } else if (plan.act === "proto") {
        setProtoAbs(accObj, plan.proto);
      } else if (plan.act === "setter") {
        plan.set(accObj, v);
      }
      // "ignore"：__proto__ setter 对原始值静默忽略
    }
    if ((srcAbs.shape as Extract<Abs["shape"], { k: "obj" }>).open) {
      (accObj.shape as Extract<Abs["shape"], { k: "obj" }>).open = true;
    }
  };
  let acc = args[0]!;
  for (let i = 1; i < args.length; i++) {
    acc = asAbsVal(acc);
    const st = extStateOf(acc);
    if (st === "frozen") throwStrictAssign(); // strict：assign 到 frozen 目标 TypeError
    const src = asAbsVal(args[i]!);
    if (src.shape.k === "obj") {
      if (acc.shape.k === "obj") {
        mergeObj(acc, src, st);
        acc.conf = confJoin(acc.conf, src.conf);
        clearStaleTermPred(acc);
      } else if (acc.shape.k === "tuple") {
        // 数组 target：数字键按下标写（扩展 length）、"length" 键截断/延长
        // （延长段 hole；非法 length 原生 RangeError）、非规范键 expando 忽略。
        // 源键序 = 原生 [[OwnPropertyKeys]] 序（整数键升序 → 字符串插入序）。
        assignArrayTarget(acc, src, st);
      }
      continue;
    }
    const srcSlots = assignSourceSlots(src);
    if (srcSlots === undefined) {
      // 键集未知（strPrim 非字面量 / arr / brand / sum / fn…）：保守降级，
      // 不得折「无变化」假精确
      if (acc.shape.k === "obj") {
        acc.shape.open = true;
      } else if (acc.shape.k === "tuple") {
        const els = acc.shape.elements;
        const joined = els.length ? els.reduce((x, y) => joinAbs(x, y)) : str();
        acc.shape = { k: "arr", element: joinAbs(joined, str()) };
        acc.conf = "partial";
        clearStaleTermPred(acc);
      }
      continue;
    }
    if (acc.shape.k === "obj" || acc.shape.k === "tuple") {
      // tuple / 字符串字面量源：合成 obj 源走同一逐键写链（无 getter/length 键）
      const srcObj = abs({ k: "obj", slots: srcSlots }, undefined, undefined, "exact");
      if (acc.shape.k === "obj") {
        mergeObj(acc, srcObj, st);
        acc.conf = confJoin(acc.conf, src.conf);
        clearStaleTermPred(acc);
      } else {
        assignArrayTarget(acc, srcObj, st);
      }
    }
  }
  return acc;
}

/**
 * Object.assign 数组 target 的逐键写（evaluator）：
 * 与原生同序处理 length 键与下标键（先写后截断可抹掉写入）。
 * getter 源键调用 getter；frozen/sealed 新下标 strict TypeError。
 */
function assignArrayTarget(target: Abs, src: Abs, st: "nonext" | "sealed" | "frozen" | undefined): void {
  const ts = target.shape as Extract<Abs["shape"], { k: "tuple" }>;
  const ss = src.shape as Extract<Abs["shape"], { k: "obj" }>;
  // 就地改槽（同 $set 引用语义：语句位置无需重绑、别名同步）
  const elements = ts.elements;
  let holes = ts.holes ?? [];
  let len = elements.length;
  const origLen = len;
  for (const [k, s] of Object.entries(ss.slots)) {
    if (k === "length") {
      const a = lookupObjAccessor(src, k);
      const vAbs = a?.get ? a.get(src) : s.value;
      const lv = vAbs.term?.op === "lit" ? vAbs.term.value : undefined;
      if (typeof lv !== "number" || !Number.isInteger(lv) || lv < 0) {
        // 非法/非字面量 length 写：原生 RangeError（"Invalid array length"）
        throw new NudoThrow(errorTypeAbs("RangeError"));
      }
      if (lv > TUPLE_MATERIALIZE_CAP) {
        // 合法但巨大：不物化巨 tuple，就地降 arr
        const el = elements.length ? elements.reduce((x, y) => joinAbs(x, y)) : unknown;
        target.shape = { k: "arr", element: el };
        target.conf = "partial";
        clearStaleTermPred(target);
        return;
      }
      if (lv < len) {
        elements.length = lv;
        holes = holes.filter((h) => h < lv);
      } else {
        for (let j = len; j < lv; j++) holes.push(j);
      }
      len = lv;
      continue;
    }
    const idx = canonicalArrayIndex(k);
    if (idx === undefined) continue; // expando：Abs 数组不存（length 不受影响）
    if (idx >= origLen && (st === "sealed" || st === "nonext")) {
      throwStrictAssign();
    }
    const a = lookupObjAccessor(src, k);
    const vAbs = a?.get ? a.get(src) : s.value;
    if (idx >= len) len = idx + 1;
    if (idx >= elements.length) elements.length = idx + 1;
    elements[idx] = vAbs;
    holes = holes.filter((h) => h !== idx);
  }
  elements.length = len;
  target.shape = { k: "tuple", elements, holes: holes.length > 0 ? holes : undefined };
  clearStaleTermPred(target);
}
