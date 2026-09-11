/**
 * TypeValue 项（term）身份旁路。
 *
 * core 的 TypeValue 无 term 字段；用 WeakMap 旁路挂载，零侵入。
 * 纪律：
 * - 禁止给共享单例（T.number 等）挂 term——必须先 clone 再 attach
 * - typeValueToAbs 优先读旁路；无旁路时按 kind 推导
 */

import type { TypeValue } from "@nudojs/core";
import { T } from "@nudojs/core";
import type { Term } from "@nudojs/core";
import { v as termVar, lit } from "@nudojs/core";
import type { Pred } from "@nudojs/core";

const termByTv = new WeakMap<object, Term>();
const predByTv = new WeakMap<object, Pred>();

export function attachTerm(tv: TypeValue, term: Term): void {
  if (tv && typeof tv === "object") termByTv.set(tv as object, term);
}

export function getTerm(tv: TypeValue): Term | undefined {
  if (tv && typeof tv === "object") return termByTv.get(tv as object);
  return undefined;
}

export function attachPred(tv: TypeValue, pred: Pred): void {
  if (tv && typeof tv === "object") predByTv.set(tv as object, pred);
}

export function getPred(tv: TypeValue): Pred | undefined {
  if (tv && typeof tv === "object") return predByTv.get(tv as object);
  return undefined;
}

/**
 * 为参数绑定克隆 TypeValue 并挂 term。
 * - primitive number → clone + var(name)
 * - literal number → clone + lit(value)（与 kind 推导一致，但显式）
 * - refined → clone + 尽量挂 base term + pred
 */
export function tagParamArg(arg: TypeValue, paramName: string): TypeValue {
  if (!paramName || paramName.startsWith("...")) return arg;
  // 函数/实例不 clone：浅拷贝会丢 _signature / 原型表（Promise executor 等）
  if (arg.kind === "function" || arg.kind === "instance") return arg;
  const cloned = cloneTypeValue(arg);
  if (cloned.kind === "primitive" && cloned.type === "number") {
    attachTerm(cloned, termVar(paramName));
  } else if (cloned.kind === "literal" && typeof cloned.value === "number") {
    attachTerm(cloned, lit(cloned.value));
  } else if (cloned.kind === "refined") {
    attachTerm(cloned, termVar(paramName));
  }
  return cloned;
}

function cloneTypeValue(tv: TypeValue): TypeValue {
  switch (tv.kind) {
    case "literal":
      return { kind: "literal", value: tv.value };
    case "primitive":
      return { kind: "primitive", type: tv.type };
    case "refined":
      return { kind: "refined", base: tv.base, refinement: tv.refinement };
    case "object":
      return { kind: "object", properties: tv.properties, id: tv.id };
    case "array":
      return { kind: "array", element: tv.element };
    case "tuple":
      return { kind: "tuple", elements: tv.elements };
    case "function":
      return {
        kind: "function",
        params: tv.params,
        body: tv.body,
        closure: tv.closure,
      };
    case "promise":
      return { kind: "promise", value: tv.value };
    case "instance":
      return {
        kind: "instance",
        className: tv.className,
        properties: tv.properties,
      };
    case "union":
      return { kind: "union", members: tv.members };
    case "never":
      return { kind: "never" };
    case "unknown":
      return { kind: "unknown" };
    default:
      return tv;
  }
}
