/**
 * this/可选链/静态成员读写：$thisGet/$thisSet/$optionalGet/$staticInvoke/$setKey。
 *
 * Invariants:
 * - 类方法体内 this 成员读经 $thisGet（内层 obj 槽优先）；可选链臂
 *   （?.）已过 nullish 排除——不重复记 may-throw。
 * - $setKey 计算键写：非字面量 key → open + index join（不得写成字面
 *   槽 "?"）；对象字面量计算键 __proto__ 是自有数据属性（与 $set 的
 *   setter 语义分流）。
 */
import type { Abs } from "../../abs.ts";
import { abs, unknown, confJoin, litValue } from "../../abs.ts";
import { objOf, joinAbs, getSlot, setSlot, propertyKeyOf } from "../../objects.ts";
import { builtinSuperCtorOf } from "../runtime/members.ts";
import { $get, $set, asAbsVal, clearStaleTermPred } from "../runtime.ts";
import { withNewTargetReset } from "../runtime/state.ts";
import { $call } from "../call.ts";
// 直连 member.ts（不经 containers barrel）：本模块体加载期即回调本 setter，
// vite SSR 下 barrel 的 re-export 不是实例化期可用绑定（原单文件拓扑中
// setter 是本模块提升函数声明）。barrel 间接层会在此处拿到 undefined。
import {
  noteEvalCallRecord,
} from "../calls.ts";
import { throwPayloadOf } from "../may-throw.ts";
// 共享 nullish 判定（无环：member-diag 只依赖 class-registry/may-throw/objects）
import { isNullishAbs } from "../member-diag.ts";

import { $invoke } from "./invoke.ts";
import { specOf, findStaticMethod } from "./declare.ts";

/** @deprecated 转译层不再发射、内部无调用；保留导出仅为公共 API 兼容。 */
export function $thisGet(thisVal: Abs, key: string): Abs {
  if (thisVal.shape.k === "brand") {
    const inner = thisVal.shape.shape;
    if (inner.shape.k === "obj") {
      const slot = getSlot(inner.shape.slots, key);
      if (slot) return slot.value;
    }
  }
  return unknown;
}

/** @deprecated 转译层不再发射、内部无调用；保留导出仅为公共 API 兼容。 */
export function $thisSet(thisVal: Abs, key: string, value: Abs): Abs {
  if (thisVal.shape.k === "brand") {
    const inner = thisVal.shape.shape;
    const slots = inner.shape.k === "obj" ? { ...inner.shape.slots } : {};
    setSlot(slots, key, { value: asAbsVal(value) });
    return abs(
      {
        k: "brand",
        name: thisVal.shape.name,
        shape: objOf(slots),
      },
      thisVal.term,
      thisVal.pred,
      confJoin(thisVal.conf, value.conf),
    );
  }
  return unknown;
}

/** 解构默认值：undefined（含 sum 成员 / 可能缺失）时用 default 并入非 undefined 部分 */
export function $orDefault(v: Abs, dflt: () => Abs): Abs {
  // 实参缺失：transpile 占位参数收到 JS undefined（非 Abs）
  if (v === undefined) return asAbsVal(dflt());
  if (isDefinitelyUndefinedAbs(v)) return asAbsVal(dflt());
  // sum / optional 可能含 undefined → JS 用 default 替换该成员，域是 dflt ∪ non-undefined
  if (v.shape.k === "sum") {
    const d = asAbsVal(dflt());
    const parts: Abs[] = [];
    let sawUndef = false;
    for (const m of v.shape.members) {
      if (isDefinitelyUndefinedAbs(m)) {
        sawUndef = true;
        continue;
      }
      parts.push(m);
    }
    if (!sawUndef) return v;
    if (parts.length === 0) return d;
    let joined = parts[0]!;
    for (let i = 1; i < parts.length; i++) joined = joinAbs(joined, parts[i]!);
    return joinAbs(joined, d);
  }
  return v;
}

export function isDefinitelyUndefinedAbs(v: Abs | undefined): boolean {
  if (!v) return false;
  if (v.term?.op === "lit" && v.term.value === undefined) return true;
  // unknown + lit(undefined) 的历史折叠形（tagged：.ok 且 value===undefined 才是 lit(undefined)）
  const r = litValue(v);
  if (v.shape.k === "unknown" && r.ok && r.value === undefined) return true;
  return false;
}

/** 可选链 a?.b：nullish 短路为 undefined 字面量。非 nullish 臂的属性读对
 *  非 nullish 值原生不抛 → silent（不记 any may-throw，Bug 3）。
 *  opts.symbolKey（Bug 149）：键来自符号投影（"[Symbol.X]" → "@@X"）——
 *  陷阱边界把 "@@X" 还原成真 symbol（规范 PropertyKey）。 */
export function $optionalGet(o: Abs, key: string, opts?: { symbolKey?: boolean }): Abs {
  if (isNullishAbs(o)) {
    return abs(
      { k: "unknown" },
      { op: "lit", value: undefined },
      undefined,
      "exact",
    );
  }
  return $get(o, key, { silent: true, symbolKey: opts?.symbolKey });
}

/** 可选链 a?.m()：nullish 短路为 undefined */
export function $optionalInvoke(thisVal: Abs, method: string, args: Abs[]): Abs {
  if (isNullishAbs(thisVal)) {
    return abs(
      { k: "unknown" },
      { op: "lit", value: undefined },
      undefined,
      "exact",
    );
  }
  return $invoke(thisVal, method, args);
}

/** 静态方法：cls.staticMethod(args)
 *  @deprecated 转译层不再发射；剩余内部调用方仅 check-may-throw.ts 的类方法桥。
 *  保留导出仅为公共 API 兼容。 */
export function $staticInvoke(cls: Abs, method: string, args: Abs[]): Abs {
  // Bug 79：静态方法调用是普通调用面——new.target 归 undefined
  return withNewTargetReset(() => {
    const spec = specOf(cls);
    const className = spec?.name ?? (cls.shape.k === "brand" ? cls.shape.name : undefined);
    // Bug 18：静态方法沿 superName 继承链查找（空派生类 B.m() 不断链）
    const m = className ? findStaticMethod(className, method) : undefined;
    if (!m) {
      // N2：内建父构造器静态（B extends Object → B.keys）：宿主静态通道
      //（$get namespace 投影 → $call）。无通道 → unknown（不折 undefined）。
      if (className) {
        const sup = builtinSuperCtorOf(className);
        if (sup) {
          const prop = $get(sup.host as Abs, method);
          if (prop && prop.shape.k === "fn") {
            return $call(prop, args, cls);
          }
        }
      }
      return unknown;
    }
    const recordName = className ? `${className}.${method}` : method;
    let result: Abs = unknown;
    let threw = false;
    try {
      // R5：类值（接收者）作 __this 首参注入——静态方法体内 this = 调用类
      result = m(cls, ...args);
      return result;
    } catch (e) {
      threw = true;
      result = throwPayloadOf(e);
      throw e;
    } finally {
      noteEvalCallRecord({ fnName: recordName, args, result, threw });
    }
  });
}

/** 计算属性写：o[kAbs] = v。非字面量 key → open + index join（不得写成字面槽 "?"） */
export function $setKey(o: Abs, key: Abs, value: Abs): Abs {
  // ToPropertyKey：null/undefined/boolean 字面量 → "null"/"undefined"/"true"
  const pk = propertyKeyOf(key);
  const k = pk !== undefined ? pk : litValue(key);
  if (typeof k === "string" || typeof k === "number") {
    const ks = String(k);
    // 对象字面量计算键 `{['__proto__']: v}` 是自有数据属性（CreateDataProperty），
    // 不是 `o.__proto__ = v` 的 setter。与 $set 分流。
    if (ks === "__proto__" && o.shape.k === "obj") {
      setSlot((o.shape as { slots: Record<string, { value: Abs }> }).slots, ks, {
        value: asAbsVal(value),
      });
      o.conf = confJoin(o.conf, value.conf);
      clearStaleTermPred(o);
      return o;
    }
    return $set(o, ks, value);
  }
  const val = asAbsVal(value);
  if (o.shape.k === "brand") {
    const inner = $setKey(o.shape.shape, key, value);
    return abs(
      { k: "brand", name: o.shape.name, shape: inner },
      o.term,
      o.pred,
      confJoin(o.conf, value.conf),
    );
  }
  if (o.shape.k !== "obj") {
    return abs(
      {
        k: "obj",
        slots: {},
        index: { key: unknown, value: val },
        open: true,
      },
      undefined,
      undefined,
      confJoin("path", value.conf),
    );
  }
  const shape = o.shape as { slots: Record<string, { value: Abs; optional?: boolean }>; index?: { key: Abs; value: Abs }; open?: boolean };
  const prevIndex = shape.index?.value;
  const indexVal = prevIndex ? joinAbs(prevIndex, val) : val;
  const next = objOf({ ...shape.slots }, {
    index: { key: shape.index?.key ?? unknown, value: indexVal },
    open: true,
  });
  next.conf = confJoin(o.conf, value.conf);
  return next;
}
