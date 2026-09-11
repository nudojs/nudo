/**
 * Abs ⇄ TypeValue 桥。
 *
 * 纪律：
 * - absToTypeValue 有损：丢 term/pred 时 conf 降为 widened，禁止假装 exact
 * - typeValueToAbs 尽量恢复 term=lit
 * - 下游（dts/lsp/service）吃 TypeValue；代数运算吃 Abs
 */

import type { TypeValue, LiteralValue as CoreLit } from "../type-value.ts";
import { T, typeValueToString } from "../type-value.ts";
import { createTemplate, getTemplateParts } from "../refinements/template.ts";

import type { Abs, Shape, Confidence } from "./abs.ts";
import { abs, confJoin, litValue } from "./abs.ts";
import type { Term } from "./term.ts";
import { lit, v as termVar, termToString } from "./term.ts";
import type { Pred } from "./pred.ts";
import { pTrue, predToString } from "./pred.ts";
import { isTemplateLike, templatePartsOf, createTemplateAbs } from "./template.ts";

/** TypeValue 上的置信度旁路（零侵入 core） */
const confByTv = new WeakMap<object, Confidence>();

export function setTvConfidence(tv: TypeValue, conf: Confidence): void {
  if (tv && typeof tv === "object") confByTv.set(tv as object, conf);
}

export function getTvConfidence(tv: TypeValue): Confidence | undefined {
  if (tv && typeof tv === "object") return confByTv.get(tv as object);
  return undefined;
}

/**
 * Abs → TypeValue（给下游）。
 * 有损：非 lit term 丢弃；pred 尽量 encode 成 refined，否则丢。
 */
export function absToTypeValue(a: Abs): TypeValue {
  let conf = a.conf;
  let result: TypeValue;

  switch (a.shape.k) {
    case "never":
      result = T.never;
      break;
    case "unknown":
      result = T.unknown;
      break;
    case "prim": {
      const lv = litValue(a);
      if (lv !== undefined) {
        result = T.literal(lv as CoreLit);
        break;
      }
      // template string：parts → core createTemplate
      if (isTemplateLike(a) && a.shape.k === "prim" && a.shape.type === "string") {
        const parts = templatePartsOf(a).map(absToTypeValue);
        result = createTemplate(parts);
        break;
      }
      // 有 pred 无 lit → refined 尽力，否则 primitive
      const prim = primToT(a.shape.type);
      if (a.pred && a.pred.op !== "true") {
        const refined = tryEncodeRefined(prim, a);
        if (refined) {
          result = refined;
        } else {
          result = prim;
          conf = confJoin(conf, "widened");
        }
      } else {
        result = prim;
        if (a.term && a.term.op !== "lit") conf = confJoin(conf, "widened");
      }
      break;
    }
    case "obj": {
      const props: Record<string, TypeValue> = {};
      for (const [k, slot] of Object.entries(a.shape.slots)) {
        let v = absToTypeValue(slot.value);
        if (slot.optional) {
          v = T.union(v, T.undefined);
        }
        props[k] = v;
      }
      result = T.object(props);
      if (a.shape.open) conf = confJoin(conf, "widened");
      break;
    }
    case "arr":
      result = T.array(absToTypeValue(a.shape.element));
      break;
    case "tuple":
      result = T.tuple(a.shape.elements.map(absToTypeValue));
      break;
    case "fn": {
      // 无 body 闭包：造 dummy function
      const body = { type: "BlockStatement", body: [], directives: [] } as any;
      result = T.fn(a.shape.params, body, null as any);
      break;
    }
    case "brand":
      result = T.instanceOf(a.shape.name, brandProps(a.shape.shape));
      break;
    case "eff":
      result = T.promise(absToTypeValue(a.shape.inner));
      break;
    case "sum":
      result = T.union(...a.shape.members.map(absToTypeValue));
      break;
    default:
      result = T.unknown;
      conf = confJoin(conf, "partial");
  }

  // 非 lit term 且不是 obj/arr 这类已投影结构：标记损失
  if (a.term && a.term.op !== "lit" && a.shape.k === "prim") {
    // 上面已处理
  }

  setTvConfidence(result, conf);
  return result;
}

function primToT(type: string): TypeValue {
  switch (type) {
    case "number":
      return T.number;
    case "string":
      return T.string;
    case "boolean":
      return T.boolean;
    case "bigint":
      return T.bigint;
    case "symbol":
      return T.symbol;
    default:
      return T.unknown;
  }
}

function brandProps(shape: Abs): Record<string, TypeValue> {
  if (shape.shape.k === "obj") {
    const out: Record<string, TypeValue> = {};
    for (const [k, slot] of Object.entries(shape.shape.slots)) {
      out[k] = absToTypeValue(slot.value);
    }
    return out;
  }
  return {};
}

/**
 * 尝试把简单数值 pred 编码为 refined。
 * 仅支持：term > n / >= n / < n / <= n，且 term 是 var 或相对自身。
 * 返回 undefined 表示无法编码。
 */
function tryEncodeRefined(base: TypeValue, a: Abs): TypeValue | undefined {
  // 比较结果等 boolean 上的 pred 是路径事实，不是数值 refine
  if (base.kind !== "primitive" || base.type !== "number") return undefined;
  const p = a.pred;
  if (!p) return undefined;
  // 仅处理原子比较，且右侧字面量
  if (
    (p.op === "gt" || p.op === "ge" || p.op === "lt" || p.op === "le") &&
    p.b.op === "lit" &&
    typeof p.b.value === "number"
  ) {
    const n = p.b.value;
    const op = p.op;
    const check = (value: unknown): boolean => {
      if (typeof value !== "number") return false;
      switch (op) {
        case "gt":
          return value > n;
        case "ge":
          return value >= n;
        case "lt":
          return value < n;
        case "le":
          return value <= n;
      }
    };
    const opSym = op === "gt" ? ">" : op === "ge" ? ">=" : op === "lt" ? "<" : "<=";
    return T.refine(base, {
      name: `number (${opSym} ${n})`,
      meta: { op, n, pred: predToString(p) },
      check,
    });
  }
  return undefined;
}

/**
 * TypeValue → Abs（给代数运算）。
 */
export function typeValueToAbs(tv: TypeValue): Abs {
  if (!tv) return abs({ k: "unknown" }, undefined, undefined, "partial");

  switch (tv.kind) {
    case "never":
      return abs({ k: "never" }, undefined, undefined, "exact");
    case "unknown":
      return abs({ k: "unknown" }, undefined, undefined, "partial");
    case "literal":
      return abs(
        shapeOfLit(tv.value),
        lit(tv.value),
        pTrue,
        "exact",
      );
    case "primitive":
      return abs({ k: "prim", type: tv.type }, undefined, undefined, "exact");
    case "refined": {
      // template refined → 恢复 parts，便于链式拼接
      const tplParts = getTemplateParts(tv);
      if (tplParts) {
        return createTemplateAbs(tplParts.map(typeValueToAbs));
      }
      const base = typeValueToAbs(tv.base);
      return abs(base.shape, base.term, base.pred, confJoin(base.conf, "path"));
    }
    case "object": {
      const slots: Record<string, { value: Abs }> = {};
      for (const [k, v] of Object.entries(tv.properties)) {
        slots[k] = { value: typeValueToAbs(v) };
      }
      return abs({ k: "obj", slots }, undefined, undefined, "exact");
    }
    case "array":
      return abs(
        { k: "arr", element: typeValueToAbs(tv.element) },
        undefined,
        undefined,
        "exact",
      );
    case "tuple":
      return abs(
        { k: "tuple", elements: tv.elements.map(typeValueToAbs) },
        undefined,
        undefined,
        "exact",
      );
    case "function": {
      const params = tv.params ?? [];
      return abs({ k: "fn", params }, undefined, undefined, "exact");
    }
    case "promise":
      return abs(
        { k: "eff", eff: "promise", inner: typeValueToAbs(tv.value) },
        undefined,
        undefined,
        "exact",
      );
    case "instance": {
      const slots: Record<string, { value: Abs }> = {};
      for (const [k, v] of Object.entries(tv.properties ?? {})) {
        slots[k] = { value: typeValueToAbs(v) };
      }
      const inner = abs({ k: "obj", slots }, undefined, undefined, "exact");
      return abs(
        { k: "brand", name: tv.className, shape: inner },
        undefined,
        undefined,
        "exact",
      );
    }
    case "union":
      return abs(
        { k: "sum", members: tv.members.map(typeValueToAbs) },
        undefined,
        undefined,
        getTvConfidence(tv) ?? "path",
      );
    default:
      return abs({ k: "unknown" }, undefined, undefined, "partial");
  }
}

function shapeOfLit(v: CoreLit): Shape {
  if (typeof v === "number") return { k: "prim", type: "number" };
  if (typeof v === "string") return { k: "prim", type: "string" };
  if (typeof v === "boolean") return { k: "prim", type: "boolean" };
  if (typeof v === "bigint") return { k: "prim", type: "bigint" };
  return { k: "unknown" };
}

/**
 * 有损检查：Abs 转 TypeValue 后是否丢了 term/pred。
 * 用于金标与调试。
 */
export function bridgeIsLossy(a: Abs): { lossy: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (a.term && a.term.op !== "lit") {
    reasons.push(`dropped term ${termToString(a.term)}`);
  }
  if (a.pred && a.pred.op !== "true") {
    const tv = absToTypeValue(a);
    if (tv.kind !== "refined") {
      reasons.push(`dropped pred ${predToString(a.pred)}`);
    }
  }
  return { lossy: reasons.length > 0, reasons };
}
