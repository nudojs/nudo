/**
 * 下标读写与长度：$idx/$idxSet/$len + abstractLen。
 *
 * Invariants:
 * - 抽象下标可能 miss → 元素 ∪ oobUndef marker（越界是引擎精度产物，
 *   下游嵌套读写不记 may-throw，issue #98）；已知规范下标仍按元素投影
 *   （split()[0] 等非空序列链不断）。
 * - arr 的具体下标读是**域分发**（xs[0]/xs[1] 同一 element Abs、不同
 *   具体值）——markDomainShared 标记后 abstractLen 不 memo 共享 len#N
 *   （issue #175：否则 xs[0].length - xs[1].length 假折 0）。
 * - abstractLen memo 只对**绑定接收者**合法（跨读同 term sound）；
 *   lenVarSeq 单调递增，len#N term 全局唯一。
 * - Bug 209：Proxy **set 陷阱**返回值按规范 ToBoolean 判定——falsy（0 / "" /
 *   null / undefined / false）→ strict TypeError（只认字面量 false 会漏）。
 * - Bug 197：下标写查 defineProperty 的 writable:false → strict TypeError
 *   （此前下标臂只查 frozen / sealed，flags 面没查 → 写穿无声）。
 */
import type { Abs } from "../../../abs.ts";
import { abs, confJoin, litValue, numLit, str, strLit, unknown } from "../../../abs.ts";
import { lit, type Term } from "../../../term.ts";
import { pTrue, ge } from "../../../pred.ts";
import { getFnImpl } from "../../../abs-fn.ts";
import {
  joinAbs,
  type ObjShape,
  getSlot,
  canonicalArrayIndex,
  propertyKeyOf,
  markKeySetOpenAbs,
} from "../../../objects.ts";
import { TUPLE_MATERIALIZE_CAP } from "../../../containers.ts";
import { TYPED_ARRAY_ELEMENT } from "../../../builtins/shared.ts";
import { isSetAbs, isMapAbs, setElementsAbs, mapEntriesAbs } from "../../../collections.ts";
import { hasGenView, peekGenElement, peekAllGenElements, proxyPartsOf, proxyTrapOf } from "../../match-iter.ts";
import {
  extStateOf,
  getPropFlags,
} from "../../../builtins.ts";
import {
  noteAnyMemberMayThrow,
  noteNullishMemberThrows,
  isNullishAbs,
  anyMemberResult,
} from "../../member-diag.ts";
import { errorTypeAbs, recordMayThrow } from "../../may-throw.ts";
import { getEvalClass } from "../../class-registry.ts";
import { classNameOfValue } from "../../../class-mark.ts";
import {
  NudoThrow,
  undef,
  oobUndef,
  isOobUndef,
  throwStrictWrite,
  clearStaleTermPred,
  asAbsVal,
  $lit,
} from "../state.ts";
import { markDomainShared, isDomainShared } from "../../../len-sharing.ts";
import { $call } from "../../call.ts";
import { widenTupleToArr } from "./arr-make.ts";
import { $set, $get } from "./member.ts";

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
  // 族 57 · 外-02 ①：符号键的**槽寻址通道**（普通对象面）——propertyKeyOf
  // 对 symbol 返 undefined（symbol 不是字符串 PropertyKey）⇒ 此前符号键读
  // 落抽象下标投影（unknown）、写被丢弃（对象标 open）。symKey 是符号键的
  // 内部槽键（well-known → "@@X"；用户符号 → "@@sym#N"，见 symbol-slot.ts）
  // ——读写两侧同键 ⇒ 值可回读。
  const symKey = symbolSlotKeyOf(i);
  if (symKey !== undefined) {
    // Proxy 面按规范把**真 symbol** 传给 get 陷阱（Bug 149）⇒ 走下方 Proxy
    // 臂（不落槽寻址）。
    const isProxy = a.shape.k === "brand" && a.shape.name === "Proxy";
    if (!isProxy) {
      // 有槽表的面（普通对象 / 内层是 obj 的 brand——包装对象、类实例…）：
      // 符号槽寻址（写面同键 ⇒ 读回同值）。
      const objShape: ObjShape | undefined =
        a.shape.k === "obj"
          ? (a.shape as ObjShape)
          : a.shape.k === "brand" && a.shape.shape.shape.k === "obj"
            ? (a.shape.shape.shape as ObjShape)
            : undefined;
      if (objShape) {
        const slot = getSlot(objShape.slots, symKey);
        if (slot) return slot.value;
        // 闭 shape 符号键确定缺席 → undefined（原生同款）；open shape 键集
        // 不完备 → unknown（不得假精确）。
        return objShape.open ? unknown : undef();
      }
      // 无槽模型的容器面（tuple / arr / Set / Map / 生成器…）：符号键缺席
      // ——闭 tuple 恒缺席 → undefined；抽象 arr 的 expando 面不可判（写面
      // 丢弃 expando）→ unknown（同 arr 臂的确定非下标键口径）。
      if (a.shape.k === "arr") return unknown;
      return undef();
    }
  }
  // Bug 54：生成器对象下标读（数组解构逐项投影 `const [a] = it`）——按
  // 消费位 live 视图取数，不再从静态形状槽 0 重放已消费元素
  if (a.shape.k === "obj" && hasGenView(a)) {
    if (iv !== undefined && idx === undefined) return undef();
    if (idx !== undefined) return peekGenElement(a, idx) ?? undef();
    const liveEls = peekAllGenElements(a);
    if (liveEls.length === 0) return oobUndef();
    return joinAbs(liveEls.reduce((x, y) => joinAbs(x, y)), oobUndef());
  }
  // Bug 56：Arguments brand → 委托 tuple 内层（形参绑定/解构/arguments[i] 同走此）
  if (a.shape.k === "brand" && a.shape.name === "Arguments") {
    return $idx(a.shape.shape, i, opts);
  }
  // Bug 57/71：Proxy——get 陷阱优先（键走 ToPropertyKey 字符串）；无陷阱
  // 回退靶下标读（inner 即 target Abs）
  if (a.shape.k === "brand" && a.shape.name === "Proxy") {
    const parts = proxyPartsOf(a);
    if (parts) {
      const trap = proxyTrapOf(parts.handler, "get");
      if (trap.k === "fn") {
        return $call(
          trap.fn,
          [parts.target, iv !== undefined ? strLit(String(iv)) : i, a],
          parts.handler,
        );
      }
      if (trap.k === "dead" || trap.k === "opaque") {
        recordMayThrow({ kind: "TypeError", cause: "Proxy get trap not callable / unknown" });
        return unknown;
      }
      return $idx(parts.target, i, opts);
    }
  }
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
    // Bug 232：确定非下标键（"foo"、-1、1.5、≥2^32-1…）——arr 形**没有**
    // expando 槽模型（写面把 expando 写降级为 arr，值被丢弃），键**可能**
    // 存在（原生 a[-1]=9 后读回 9）⇒ 不得折 exact undefined（自信的错值，
    // 违反引擎自己的「不得假精确」不变式）。与字符串键路径同口径降级为
    // 抽象值（$get 的 arr 臂返回 unknown）。
    // 闭 tuple 无 expando（写面已就地降 arr）⇒ 仍折 exact undefined。
    if (iv !== undefined && idx === undefined) return unknown;
    // 抽象下标可能 miss → 元素 ∪ undefined（与对象未知键同口径）；
    // 已知规范下标仍按元素投影（split()[0] 等非空序列链不断）
    if (idx === undefined) {
      return joinAbs(a.shape.element, oobUndef());
    }
    // #175 残留：具体下标读的元素投影是域分发（xs[0]/xs[1] 同一 element
    // Abs、不同具体值）——标记后 abstractLen 不 memo 共享 len#N
    return markDomainShared(a.shape.element);
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
  // Bug 82：Set/Map brand 下标读（数组解构逐项投影 `const [a, b] = new Set(…)`）。
  // 消费与 elemsOf 同源的侧表（setElementsAbs / mapEntriesAbs——spread /
  // for-of / Array.from 的读法），解构与迭代口径一致；此前无 brand 臂落
  // inner obj 槽（size / 条目表）miss 折 undef——`a + b` 假 NaN、元素属性
  // 读假抛。Map 迭代语义是 entry [k, v] 元组。与 tuple 臂同口径：确定非
  // 下标键 → undefined；越界 → undefined；抽象下标 → 元素域 ∪ OOB undefined。
  if (isSetAbs(a)) {
    const els = setElementsAbs(a);
    if (iv !== undefined && idx === undefined) return undef();
    if (idx !== undefined) return idx < els.length ? els[idx]! : undef();
    if (els.length === 0) return oobUndef();
    return joinAbs(els.reduce((x, y) => joinAbs(x, y)), oobUndef());
  }
  if (isMapAbs(a)) {
    const entries = mapEntriesAbs(a);
    if (iv !== undefined && idx === undefined) return undef();
    if (idx !== undefined) return idx < entries.length ? entries[idx]! : undef();
    if (entries.length === 0) return oobUndef();
    return joinAbs(entries.reduce((x, y) => joinAbs(x, y)), oobUndef());
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
  // 族 57 · 外-02 ①：符号键的槽寻址键（读面同款：symbol-slot.ts）——
  // propertyKeyOf 对 symbol 返 undefined ⇒ 此前符号键写落抽象键分支
  // （写被丢弃 + 对象标 open ⇒ 键集面不保真）。
  const symKey = symbolSlotKeyOf(i);
  // Bug 56：Arguments brand → 委托 tuple 内层（原地写回，brand 身份保持）
  if (a.shape.k === "brand" && a.shape.name === "Arguments") {
    $idxSet(a.shape.shape, i, value);
    return a;
  }
  // Bug 71：Proxy——set 陷阱优先（键 ToPropertyKey；返回值按 ToBoolean 判定
  // falsy → strict TypeError）；无陷阱转发靶下标写（原地，brand 身份保持）
  if (a.shape.k === "brand" && a.shape.name === "Proxy") {
    const parts = proxyPartsOf(a);
    if (parts) {
      const trap = proxyTrapOf(parts.handler, "set");
      if (trap.k === "fn") {
        const keyAbs = iv !== undefined ? strLit(String(iv)) : i;
        const res = $call(trap.fn, [parts.target, keyAbs, value, a], parts.handler);
        const rv = litValue(res);
        // Bug 209：set 陷阱返回值按规范 **ToBoolean**——falsy（0 / "" / null /
        // undefined / false）→ strict TypeError；此前只认字面量 false。
        if (rv.ok && !rv.value) throwStrictWrite();
        return a;
      }
      if (trap.k === "dead" || trap.k === "opaque") {
        recordMayThrow({ kind: "TypeError", cause: "Proxy set trap not callable / unknown" });
        return a;
      }
      $idxSet(parts.target, i, value);
      return a;
    }
  }
  if (a.shape.k === "tuple" && numIdx !== undefined && Number.isInteger(numIdx) && numIdx >= 0) {
    const st = extStateOf(a);
    if (st === "frozen") throwStrictWrite(); // frozen 数组：下标写 TypeError
    if (
      (st === "sealed" || st === "nonext") &&
      numIdx >= a.shape.elements.length
    ) {
      throwStrictWrite(); // 不可扩展：越界写（新下标）TypeError
    }
    // Bug 197：下标位 defineProperty 的 **writable:false** → strict 写原生
    // TypeError；此前下标臂只查 frozen/sealed（flags 面完全没查）→ 写穿
    // 无声（门禁假绿）。
    if (getPropFlags(a)?.get(String(numIdx))?.writable === false) throwStrictWrite();
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
    if (symKey !== undefined) {
      // 族 57 · 外-02 ①：符号键写落**符号槽**（slotKey 标记 ⇒ JSON / 字符串
      // 枚举面不可见，Bug 73 口径）——键确定 ⇒ 无需标 open（键集面保真）。
      return $set(a, symKey, value, { symbolKey: true });
    }
    if (iv === undefined) {
      // 抽象键：无槽位模型——标记 open（缺失键读不再折 undefined 假精确）
      // Bug 383：键**不可判**（对象键的 ToString 结果不可判——如函数键的
      // 源码文本 / 抽象 var 键）⇒ 写被丢弃 ⇒ 该对象的**自有键集不完备**
      // （native 侧该键确实存在）⇒ 键家族（Object.keys / values / entries）
      // 据此折 partial，**不得**折 exact 空元组（自信的确切错值：native
      // `Object.keys(o).length` = 1 vs 引擎 0）。修前只标 open（键集面读
      // 不到该语义）⇒ 键家族仍折 exact 空元组。
      markKeySetOpenAbs(a);
      a.shape = { ...a.shape, open: true };
      a.conf = confJoin(a.conf, "path");
      clearStaleTermPred(a);
      return a;
    }
    return $set(a, String(iv), value);
  }
  if (sk === "brand") {
    if (symKey !== undefined) {
      // 族 57 · 外-02 ①：符号键写落内层 obj 的**符号槽**（$set 就地突变
      // 内层 ⇒ 读面同键可见）——索引写仍按既有口径保守（内建 brand 不写：
      // Uint8Array 截断被写穿假精确）。
      return $set(a, symKey, value, { symbolKey: true });
    }
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

/** 该 Abs 是否是「**确切的** undefined」（$len 的 undefined 臂：RegExp 匹配
 *  迭代器等）——shape 是 unknown 令牌 + term 是 lit undefined。 */
function isExactUndef(a: Abs): boolean {
  return (
    a.shape.k === "unknown" &&
    a.term?.op === "lit" &&
    (a.term as { value?: unknown }).value === undefined
  );
}

/** 该成员**确定没有** .length 属性（原生读出 undefined，Bug 239）：
 *  - prim 且非 string（number/boolean/bigint/symbol）
 *  - 闭 obj 且无 length 槽
 *  其余（unknown/any/brand/open obj/sum）长度**不可知**——不并 undefined 臂
 *  （把「不可知」误当「确定无」会制造 L1 假红）。 */
function memberHasNoLength(m: Abs): boolean {
  const k = m.shape.k;
  if (k === "prim") return (m.shape as { type?: string }).type !== "string";
  if (k === "obj") {
    const s = m.shape as ObjShape;
    if (s.open) return false;
    return getSlot(s.slots, "length") === undefined;
  }
  return false;
}

/** 抽象长度：number + var term + pred ≥0（字符串/数组长度恒非负）。
 *  供 `new Array(len + 1)` 等消费（add 的 addPred 平移界 → ctor 证非负
 *  不再记 RangeError，issue #98）。 */
function abstractLen(a: Abs): Abs {
  let t = lenTermMemo.get(a);
  if (!t) {
    t = { op: "var", id: `len#${lenVarSeq++}` };
    // #175 残留修复：域共享接收者（arr 元素域分发——xs[0]/xs[1]、for-of
    // 单代表、回调元素实参）跨读是同一 Abs 但代表不同具体值——不 memo，
    // 每次铸新 len#N，杜绝 sub 自反折叠把 xs[0].length - xs[1].length
    // 假折 0（len-sharing.ts）。原绑定接收者不受影响（memo 照旧，跨读
    // 同 term 是 sound 的：同一绑定同一值）。
    if (!isDomainShared(a)) lenTermMemo.set(a, t);
  }
  return abs({ k: "prim", type: "number" }, t, ge(t, lit(0)), "path");
}

/** 数组/字符串长度。opts.silent：可选链（a?.length）守卫臂——接收者已过
 *  $removeNullish，仅 any 不记 may-throw（Bug 3，与 $get 的 silent 同口径）。 */
export function $len(a: Abs, opts?: { silent?: boolean }): Abs {
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
  // Bug 3：nullish 接收者 .length 与 $get 同口径——记 throws 域并硬抛
  //（原生 null.length / undefined.length 定抛 TypeError，此前直落尾 unknown）
  if (noteNullishMemberThrows(a, "length", "property")) {
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  // any 上的 .length：无约束成员（any ≠ unknown——不得报引擎债）；
  // 非可选链记 may-throw（Bug 3，与 $get 同口径——L2 gate 不再漏 .length）
  if (a?.shape?.k === "any") {
    if (!opts?.silent) noteAnyMemberMayThrow(a, "length", "property");
    return anyMemberResult();
  }
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
    const lens = a.shape.members.map((m) => $len(m, opts));
    const lits = lens.map(litValue);
    if (
      lits.length > 0 &&
      lits.every((v) => v.ok && lits[0]!.ok && Object.is(v.value, lits[0]!.value))
    ) {
      return lens[0]!;
    }
    // Bug 239：union 接收者读 .length 必须**保留各成员的长度**——某成员
    // 根本没有 .length（原生 (7).length → undefined）时，旧口径
    // `return abstractLen(a)` 把「无 length」当成「有 length」⇒ 恒 number
    // ⇒ L1 契约 `number()` 被判成立、零诊断的**假绿**。
    // 逐成员长度 join（同 $idx / $get 的 sum 分支口径）：确定「无 length」
    // 的成员贡献 undefined 臂；长度不可知（unknown/any/brand/open obj）
    // 的成员保持原值（不误并 undefined 臂 → 不制造假红）。
    const arms: Abs[] = [];
    let hasUndefArm = false;
    for (const m of a.shape.members) {
      const l = $len(m, opts);
      if (memberHasNoLength(m)) {
        arms.push(undef()); // 原生：成员没有 length 属性 → 读出 undefined
        hasUndefArm = true;
        continue;
      }
      if (isExactUndef(l)) {
        arms.push(l); // 长度**就是** undefined（exact）
        hasUndefArm = true;
        continue;
      }
      arms.push(l);
    }
    if (!hasUndefArm) return abstractLen(a);
    return arms.reduce((x, y) => joinAbs(x, y));
  }
  // Bug 56：Arguments brand → tuple 内层长度（arguments.length 精确）
  if (a.shape.k === "brand" && a.shape.name === "Arguments") {
    return $len(a.shape.shape, opts);
  }
  // Bug 57：Proxy——长度读即 get("length")：无陷阱回退靶长度；陷阱存在
  //（可判定/不可判）时值域不可信 → 抽象 number（sound）
  if (a.shape.k === "brand" && a.shape.name === "Proxy") {
    const parts = proxyPartsOf(a);
    if (parts) {
      if (proxyTrapOf(parts.handler, "get").k === "absent") {
        return $len(parts.target, opts);
      }
      return abstractLen(a);
    }
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
  // Bug 38：TypedArray brand 的 length 槽（makeTypedArrayAbs 数字形态入槽，
  // 非可枚举自有数据属性——.length 编译为 $len，不经 $get 品牌槽路径）；
  // iterable/buffer 形态无槽沿尾 unknown（长度不建模口径）
  if (
    a.shape.k === "brand" &&
    TYPED_ARRAY_ELEMENT[(a.shape as { name?: string }).name ?? ""] !== undefined
  ) {
    const inner = (a.shape as { shape: Abs }).shape;
    if (inner.shape.k === "obj") {
      const lenSlot = getSlot((inner.shape as { slots: Record<string, { value: Abs; optional?: boolean }> }).slots, "length");
      if (lenSlot && !lenSlot.optional) return lenSlot.value;
    }
  }
  // RegExpStringIterator（matchAll 结果）：无 length 属性 → undefined
  if (a.shape.k === "brand" && a.shape.name === "RegExpMatchIterator") {
    return undef();
  }
  // P2b：类值 length = 构造器元数——委托 $get 品牌面一处口径（自有静态
  // length 槽 → 静态访问器 → 链上恰名 length 的静态方法/祖先槽 → 元数
  // （transpile ctorLength 通道，隐式 ctor 恒 0；未记录 → unknown 不假 0））。
  // `.length` 成员读编译为 $len（TypedArray 槽同款注释位），计算键
  // C["length"] 直接走 $get 同臂；内建构造器 brand（Array 等）无注册
  // spec → unknown（与改前 $len 尾 unknown 同值）。
  if (a.shape.k === "brand" && classNameOfValue(a as object) === a.shape.name) {
    return $get(a, "length", opts);
  }
  return unknown;
}

// 对象 / 成员
// --- 对象 / 成员 ---
