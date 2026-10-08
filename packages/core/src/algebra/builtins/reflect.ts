/**
 * Reflect.* 静态（Bug 19）：宿主命名空间方法分派。
 *
 * 原生各方法首步对 target 做**严格 IsObject**（任何 prim——含抽象 refined
 * prim 与 nullish 字面量——一律 TypeError，不经 Object.* 的 ToObject 装箱
 * 宽容；node v26 实测 Reflect.get(1,'a') / Reflect.get('s','a') /
 * Reflect.get(null,'a') 全抛）。setPrototypeOf 另校验 proto（Object or
 * null）；apply/construct 校验 target 可调用/可构造 + argsList 为对象
 * （CreateListFromArrayLike called on non-object）。
 *
 * 三档口径与全仓约定一致：定抛 → NudoThrow；any/unknown/含坏臂 union →
 * recordMayThrow（值域不变）；对象形态走保守投影。
 */
import type { Abs } from "../abs.ts";
import { abs, litValue, strLit, boolLit, unknown } from "../abs.ts";
import { joinAbs, setProtoAbs, canonicalArrayIndex, getSlot, getProtoAbs, isNullProtoObj } from "../objects.ts";
import { NudoThrow } from "../exec/nudo-throw.ts";
import { errorTypeAbs, recordMayThrow } from "../exec/may-throw.ts";
import { isNullishLitAbs } from "../surface.ts";
import { boolPrim } from "./shared.ts";
import { evalObjectMethod } from "./object.ts";
import { markExtState, extStateOf, getPropFlags, migrateInvariants } from "./invariants.ts";
import { objectProtoBrand } from "./ctor.ts";
import { $del, lookupObjAccessor, migrateAccessors } from "../exec/runtime/members.ts";
import { $set, $idxSet } from "../exec/runtime/containers.ts";
import { writeInPlace, undef, callAtFunctionBoundary } from "../exec/runtime/state.ts";
import { $call } from "../exec/call.ts";
import { getFnImpl } from "../abs-fn.ts";

/** target 三档：object（确定对象）/ prim（确定非对象）/ may（可能是 prim） */
type TargetClass = { k: "object" } | { k: "prim" } | { k: "may" };

function classifyReflectTarget(a: Abs | undefined): TargetClass {
  // 缺省 ≡ undefined（Reflect.get() 原生 "Reflect.get called on non-object"）
  if (!a) return { k: "prim" };
  // nullish 字面量（shape k:"unknown" + lit term，引擎的 null/undefined 表示）
  if (a.term?.op === "lit" && (a.term.value === null || a.term.value === undefined)) {
    return { k: "prim" };
  }
  const s = a.shape;
  // 任何 prim 形态（含 symbol prim / 抽象 refined prim）都不是对象 → 定抛
  if (s.k === "prim") return { k: "prim" };
  if (s.k === "any" || s.k === "unknown") return { k: "may" };
  if (s.k === "sum") {
    const bad = (s as { members: Abs[] }).members.some((m) => classifyReflectTarget(m).k !== "object");
    return bad ? { k: "may" } : { k: "object" };
  }
  return { k: "object" }; // obj/tuple/arr/fn/brand/eff：确定对象
}

/** 严格 IsObject 校验落地：prim → NudoThrow；may → recordMayThrow */
function enforceReflectTarget(a: Abs | undefined, what: string): void {
  const c = classifyReflectTarget(a);
  if (c.k === "prim") throw new NudoThrow(errorTypeAbs("TypeError"));
  if (c.k === "may") {
    recordMayThrow({ kind: "TypeError", cause: `Reflect.${what} called on non-object` });
  }
}

/** apply/construct 的 argsList（CreateListFromArrayLike）：非对象 → 定抛 */
function enforceArgsList(a: Abs | undefined, what: string): void {
  enforceReflectTarget(a, what);
}

/** 闭 obj 槽命中读取（miss → unknown：原型链可能有值，不折假 undefined） */
function closedObjSlotHit(target: Abs, keyAbs: Abs | undefined): Abs | undefined {
  if (target.shape.k !== "obj") return undefined;
  const os = target.shape as { slots: Record<string, { value: Abs }>; open?: boolean; index?: unknown };
  if (os.open || os.index) return undefined;
  const kvR = keyAbs ? litValue(keyAbs) : undefined;
  const kv = kvR?.ok ? kvR.value : undefined;
  // symbol 键不在 Abs 槽域（ToPropertyKey 对 symbol 不 ToString、不抛）
  if (typeof kv !== "string" && typeof kv !== "number") return undefined;
  const slot = os.slots[String(kv)];
  return slot ? slot.value : unknown;
}

export function evalReflectMethod(method: string, args: Abs[]): Abs | undefined {
  switch (method) {
    case "get": {
      enforceReflectTarget(args[0], "get");
      const hit = closedObjSlotHit(args[0]!, args[1]);
      return hit ?? unknown;
    }
    case "set": {
      // Bug 31：Reflect.set ≡ [[Set]]——普通可扩展对象上按 receiver（缺省 ≡
      // target）写槽成功；此前只校验不写（o.a 后续读折 undefined 错误值）。
      // 就地写回（writeInPlace 保 Abs 身份——别名可见），返回值照原生 boolean。
      enforceReflectTarget(args[0], "set");
      // 第 4 实参 receiver：非对象 → TypeError（缺省 ≡ target）
      const recvArg = args[3];
      if (recvArg !== undefined) {
        if (recvArg.term?.op === "lit") {
          if (recvArg.term.value !== null && typeof recvArg.term.value !== "object") {
            throw new NudoThrow(errorTypeAbs("TypeError"));
          }
        } else if (recvArg.shape.k === "prim") {
          throw new NudoThrow(errorTypeAbs("TypeError"));
        } else if (
          recvArg.shape.k === "any" ||
          recvArg.shape.k === "unknown" ||
          recvArg.shape.k === "sum"
        ) {
          recordMayThrow({ kind: "TypeError", cause: "Reflect.set receiver must be an object" });
        }
      }
      const t0 = args[0]!;
      const kvR = args[1] ? litValue(args[1]) : undefined;
      const kv = kvR?.ok ? kvR.value : undefined;
      if (typeof kv === "string" || typeof kv === "number") {
        const key = String(kv);
        const st = extStateOf(t0);
        const flags = getPropFlags(t0)?.get(key);
        const acc = lookupObjAccessor(t0, key);
        // 定 false 形态：frozen / writable:false / getter-only / 不可扩展新键
        const slotsOf =
          t0.shape.k === "obj"
            ? (t0.shape as { slots: Record<string, unknown> }).slots
            : t0.shape.k === "brand" && t0.shape.shape.shape.k === "obj"
              ? (t0.shape.shape.shape as { slots: Record<string, unknown> }).slots
              : undefined;
        const exists = slotsOf
          ? Object.prototype.hasOwnProperty.call(slotsOf, key)
          : undefined;
        if (st === "frozen" || flags?.writable === false || (acc && !acc.set)) {
          return boolLit(false);
        }
        if ((st === "sealed" || st === "nonext") && exists === false) {
          return boolLit(false);
        }
        if (t0.shape.k === "obj" || t0.shape.k === "brand") {
          writeInPlace(t0, $set(t0, key, args[2] ?? undef()));
          if (exists !== undefined) return boolLit(true);
        } else if (
          (t0.shape.k === "tuple" || t0.shape.k === "arr") &&
          canonicalArrayIndex(key) !== undefined
        ) {
          writeInPlace(t0, $idxSet(t0, args[1]!, args[2] ?? undef()));
          if (exists !== undefined) return boolLit(true);
        }
      }
      // 普通可扩展对象恒成功；冻结/非配置冲突不可判 → 保守 boolean
      return boolPrim();
    }
    case "has": {
      enforceReflectTarget(args[0], "has");
      const hit = closedObjSlotHit(args[0]!, args[1]);
      // 槽命中 → true；miss 走原型链不可判 → 保守 boolean
      if (hit !== undefined && hit !== unknown) return boolLit(true);
      return boolPrim();
    }
    case "deleteProperty": {
      // Bug 31：Reflect.deleteProperty ≡ [[Delete]]——就地删槽（$del），返回
      // 原生 boolean；非配置属性 / frozen 目标原生返 false 不抛。
      enforceReflectTarget(args[0], "deleteProperty");
      const t0 = args[0]!;
      const kvR = args[1] ? litValue(args[1]) : undefined;
      const kv = kvR?.ok ? kvR.value : undefined;
      if (typeof kv === "string" || typeof kv === "number") {
        const key = String(kv);
        const flags = getPropFlags(t0)?.get(key);
        if (extStateOf(t0) === "frozen" || flags?.configurable === false) {
          return boolLit(false);
        }
        if (
          t0.shape.k === "obj" ||
          t0.shape.k === "brand" ||
          t0.shape.k === "tuple" ||
          t0.shape.k === "arr"
        ) {
          writeInPlace(t0, $del(t0, args[1]!));
          return boolLit(true);
        }
      }
      return boolPrim();
    }
    case "ownKeys": {
      enforceReflectTarget(args[0], "ownKeys");
      const t0 = args[0]!;
      if (t0.shape.k === "obj") {
        const os = t0.shape as { slots: Record<string, unknown>; open?: boolean; index?: unknown };
        if (!os.open && !os.index) {
          // 与 Object.getOwnPropertyNames 同口径：闭 obj 自有键精确枚举
          return abs(
            { k: "tuple", elements: Object.keys(os.slots).map((n) => strLit(n)) },
            undefined,
            undefined,
            "exact",
          );
        }
      } else if (t0.shape.k === "tuple") {
        const holes = (t0.shape as { holes?: number[] }).holes ?? [];
        const names = t0.shape.elements
          .map((_, i) => i)
          .filter((i) => !holes.includes(i))
          .map(String);
        names.push("length");
        return abs({ k: "tuple", elements: names.map((n) => strLit(n)) }, undefined, undefined, "exact");
      }
      // 抽象/开放面：string | symbol 键（含 symbol 键，比 Names 面宽）
      return abs(
        {
          k: "arr",
          element: joinAbs(
            abs({ k: "prim", type: "string" }, undefined, undefined, "path"),
            abs({ k: "prim", type: "symbol" }, undefined, undefined, "path"),
          ),
        },
        undefined,
        undefined,
        "partial",
      );
    }
    case "defineProperty": {
      // target 严格 IsObject + 描述符校验/写入复用 Object.defineProperty 面
      //（Bug 39 同源），返回 boolean（redefine 失败原生返 false 不抛）。
      // Bug 31：保留返回容器并**就地写回**第一实参（Object.defineProperty
      // 的语句级 emit 写回只匹配 callee.object.name === "Object"——Reflect
      // 路径值域是 boolean，写回只能就地；访问器/flags 随容器迁移）。
      enforceReflectTarget(args[0], "defineProperty");
      const next = evalObjectMethod("defineProperty", args);
      const t0 = args[0]!;
      if (next !== undefined && next !== t0) {
        writeInPlace(t0, next);
        migrateAccessors(next, t0);
        migrateInvariants(next, t0);
      }
      return boolPrim();
    }
    case "getOwnPropertyDescriptor": {
      enforceReflectTarget(args[0], "getOwnPropertyDescriptor");
      return evalObjectMethod("getOwnPropertyDescriptor", args);
    }
    case "getPrototypeOf": {
      enforceReflectTarget(args[0], "getPrototypeOf");
      return evalObjectMethod("getPrototypeOf", args);
    }
    case "setPrototypeOf": {
      enforceReflectTarget(args[0], "setPrototypeOf");
      // proto：Object or null（node 实测 setPrototypeOf({},1) → TypeError）
      const p0 = args[1];
      if (!p0) throw new NudoThrow(errorTypeAbs("TypeError"));
      if (p0.term?.op === "lit") {
        const pv = p0.term.value;
        if (pv !== null && typeof pv !== "object") {
          throw new NudoThrow(errorTypeAbs("TypeError"));
        }
      } else if (p0.shape.k === "prim") {
        throw new NudoThrow(errorTypeAbs("TypeError"));
      } else if (p0.shape.k === "any" || p0.shape.k === "unknown" || p0.shape.k === "sum") {
        recordMayThrow({ kind: "TypeError", cause: "Reflect.setPrototypeOf proto must be an object or null" });
      }
      // Bug 31：应用原型设定（就地：null → nullProto 标记；object → open +
      // protoTable，setProtoAbs 语义）；不可扩展目标原生返 false 不抛。
      // Review 补：ES2024 OrdinarySetPrototypeOf 的 SameValue(current, V)
      // 检查先于 extensible 检查——原型未变时原生返 true（node 实测
      // preventExtensions(o) 后 setPrototypeOf(o, getPrototypeOf(o)) → true）。
      // 可判同原型：nullProto ↔ lit null；protoTable 同 Abs 身份（同变量）；
      // 缺省原型（非 nullProto、无表项）↔ Object.prototype 单例。
      const t0 = args[0]!;
      if (extStateOf(t0) !== undefined) {
        const curIsNull = isNullProtoObj(t0);
        const p0IsNull = p0.term?.op === "lit" && p0.term.value === null;
        if (curIsNull && p0IsNull) return boolLit(true);
        if (curIsNull !== p0IsNull) return boolLit(false); // 一侧 null 一侧对象：必不同
        if (getProtoAbs(t0) === p0) return boolLit(true);
        if (getProtoAbs(t0) === undefined && p0 === objectProtoBrand()) return boolLit(true);
        return boolLit(false);
      }
      setProtoAbs(t0, p0);
      return boolLit(true);
    }
    case "apply":
    case "construct": {
      // 可调用/可构造三档：fn → 按 ctor facet；brand/any/unknown/sum → may
      //（类值可调用、实例不可）；prim（含 nullish）与 obj/tuple/arr/eff →
      // 确定不可调用 → 定抛（node 实测 apply(1,…) TypeError）
      const t0 = args[0];
      if (!t0) throw new NudoThrow(errorTypeAbs("TypeError"));
      const s = t0.shape;
      const what = method === "apply" ? "callable" : "a constructor";
      if (s.k === "fn") {
        const ctor = (s as { ctor?: boolean }).ctor;
        if (method === "construct" && ctor === false) {
          throw new NudoThrow(errorTypeAbs("TypeError")); // 箭头/generator 不可构造
        }
        // Bug 14：apply 的 fn target 恒可调用（ctor facet 只与 construct 相关，
        // Math.max 等命名空间一等函数 ctor 缺省）——仅 construct 记 may
        if (method === "construct" && ctor === undefined) {
          recordMayThrow({ kind: "TypeError", cause: `Reflect.${method} target may not be ${what}` });
        }
      } else if (
        s.k === "brand" ||
        s.k === "any" ||
        s.k === "unknown" ||
        s.k === "sum"
      ) {
        recordMayThrow({ kind: "TypeError", cause: `Reflect.${method} target may not be ${what}` });
      } else {
        // prim（含 nullish 字面量）/ obj / tuple / arr / eff：确定不可调用
        throw new NudoThrow(errorTypeAbs("TypeError"));
      }
      enforceArgsList(args[2], method);
      // Bug 14：apply 镜像 $invoke 的 apply 路径（f.apply(t, a) ≡
      // Reflect.apply(f, t, a)——同一操作两口径）；construct 保持保守不
      // 复放（不同方法面，报告「已排除」）。argsList 展开：tuple 精确
      // 展开逐元素；arr → 单 element 槽位；闭 obj 无 length 槽 → 精确 0
      // 参（与 $invokeInner expandApplyArgs 同口径）。
      if (method === "apply") {
        const list = args[2];
        const expanded: Abs[] = [];
        let replay = false;
        if (list && (list.shape.k === "tuple" || list.shape.k === "arr")) {
          if (list.shape.k === "tuple") {
            expanded.push(...(list.shape as { elements: Abs[] }).elements);
          } else {
            expanded.push((list.shape as { element: Abs }).element);
          }
          // fn target（含 apply/body impl）→ 真复放；无 impl 的抽象 fn 面
          // → $call 走 instantiateReturn/unknown（同一保守口径）
          const impl = getFnImpl(t0);
          if (impl?.apply || impl?.body || impl?.relation) replay = true;
        } else if (
          list &&
          list.shape.k === "obj" &&
          (list.shape as { open?: boolean }).open !== true
        ) {
          const lenAbs = getSlot(
            (list.shape as { slots: Record<string, { value: Abs }> }).slots,
            "length",
          )?.value;
          if (!lenAbs || isNullishLitAbs(lenAbs)) expanded.length = 0;
          else expanded.push(unknown);
        } else {
          expanded.push(unknown);
        }
        if (replay) {
          return callAtFunctionBoundary(() => $call(t0, expanded, args[1]));
        }
        if (s.k === "fn") {
          // 无 impl 的 fn Abs：保持恒等域（unknown），不折假
          return unknown;
        }
      }
      // 不复放调用（保守）：值域不折假
      return unknown;
    }
    case "isExtensible": {
      enforceReflectTarget(args[0], method);
      return boolPrim();
    }
    case "preventExtensions": {
      // Bug 31：标记 nonext（就地——Object.isExtensible(o) 随后折 false）；
      // 对象 target 原生恒返 true（已不可扩展也 true）。
      enforceReflectTarget(args[0], method);
      if (args[0]) markExtState(args[0]!, "nonext");
      return boolLit(true);
    }
    default:
      return undefined;
  }
}
