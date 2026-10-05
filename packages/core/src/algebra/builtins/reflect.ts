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
import { joinAbs } from "../objects.ts";
import { NudoThrow } from "../exec/nudo-throw.ts";
import { errorTypeAbs, recordMayThrow } from "../exec/may-throw.ts";
import { boolPrim } from "./shared.ts";
import { evalObjectMethod } from "./object.ts";

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
      enforceReflectTarget(args[0], "set");
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
      enforceReflectTarget(args[0], "deleteProperty");
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
      //（Bug 39 同源），返回 boolean（redefine 失败原生返 false 不抛）
      enforceReflectTarget(args[0], "defineProperty");
      evalObjectMethod("defineProperty", args);
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
      return boolPrim();
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
        if (ctor === undefined) {
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
      // 不复放调用（保守）：值域不折假
      return unknown;
    }
    case "isExtensible":
    case "preventExtensions": {
      enforceReflectTarget(args[0], method);
      return boolPrim();
    }
    default:
      return undefined;
  }
}
