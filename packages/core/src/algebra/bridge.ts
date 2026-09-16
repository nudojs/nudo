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
import { lit, v as termVar } from "./term.ts";
import type { Pred } from "./pred.ts";
import { pTrue, predToString, gt, ge, lt, le } from "./pred.ts";
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
      // null 字面量保真：`=> null` case 期望与 exec/match 的 null 结果需过桥；
      // undefined 字面量维持 unknown（缺失属性读取的既定投影）
      if (a.term?.op === "lit" && a.term.value === null) {
        result = T.literal(null);
        break;
      }
      result = T.unknown;
      break;
    case "any":
      // any ≠ unknown：任意 JS 值，不是分析失败。conf 保留（通常 path）
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
 * 置信度：优先读 abs→tv 时挂上的 conf 旁路，避免 #widened 回升 #exact。
 */
export function typeValueToAbs(tv: TypeValue): Abs {
  if (!tv) return abs({ k: "unknown" }, undefined, undefined, "partial");

  /** abs→tv 时挂的 conf；无则用 fallback */
  const confOr = (fallback: Confidence): Confidence => getTvConfidence(tv) ?? fallback;

  switch (tv.kind) {
    case "never":
      return abs({ k: "never" }, undefined, undefined, confOr("exact"));
    case "unknown":
      // TypeValue 无 any kind：unknown+path 约定为「任意值」投影
      return abs(
        { k: "unknown" },
        undefined,
        undefined,
        confOr("partial"),
      );
    case "literal":
      if (typeof tv.value === "bigint") {
        // Abs term 不建模 bigint 字面量：只保留 prim 形状，放弃 literal identity
        return abs(
          { k: "prim", type: "bigint" },
          undefined,
          undefined,
          confOr("exact"),
        );
      }
      return abs(
        shapeOfLit(tv.value),
        lit(tv.value),
        pTrue,
        confOr("exact"),
      );
    case "primitive":
      return abs({ k: "prim", type: tv.type }, undefined, undefined, confOr("exact"));
    case "refined": {
      // template refined → 恢复 parts，便于链式拼接
      const tplParts = getTemplateParts(tv);
      if (tplParts) {
        return createTemplateAbs(tplParts.map(typeValueToAbs));
      }
      const base = typeValueToAbs(tv.base);
      const decoded = tryDecodeRefinedPred(tv, base.term);
      return abs(
        base.shape,
        base.term ?? (decoded ? termVar("_r") : undefined),
        decoded ?? base.pred,
        confOr(confJoin(base.conf, "path")),
      );
    }
    case "object": {
      const slots: Record<string, { value: Abs }> = {};
      for (const [k, v] of Object.entries(tv.properties)) {
        slots[k] = { value: typeValueToAbs(v) };
      }
      return abs({ k: "obj", slots }, undefined, undefined, confOr("exact"));
    }
    case "array":
      return abs(
        { k: "arr", element: typeValueToAbs(tv.element) },
        undefined,
        undefined,
        confOr("exact"),
      );
    case "tuple":
      return abs(
        { k: "tuple", elements: tv.elements.map(typeValueToAbs) },
        undefined,
        undefined,
        confOr("exact"),
      );
    case "function": {
      const params = tv.params ?? [];
      return abs({ k: "fn", params }, undefined, undefined, confOr("exact"));
    }
    case "promise":
      return abs(
        { k: "eff", eff: "promise", inner: typeValueToAbs(tv.value) },
        undefined,
        undefined,
        confOr("exact"),
      );
    case "instance": {
      const slots: Record<string, { value: Abs }> = {};
      for (const [k, v] of Object.entries(tv.properties ?? {})) {
        slots[k] = { value: typeValueToAbs(v) };
      }
      const inner = abs({ k: "obj", slots }, undefined, undefined, confOr("exact"));
      return abs(
        { k: "brand", name: tv.className, shape: inner },
        undefined,
        undefined,
        confOr("exact"),
      );
    }
    case "union":
      return abs(
        { k: "sum", members: tv.members.map(typeValueToAbs) },
        undefined,
        undefined,
        confOr("path"),
      );
    default:
      return abs({ k: "unknown" }, undefined, undefined, confOr("partial"));
  }
}

/** 从 refined.meta 反 encode 数值比较 pred（tryEncodeRefined 的逆） */
function tryDecodeRefinedPred(tv: TypeValue, term: Term | undefined): Pred | undefined {
  if (tv.kind !== "refined") return undefined;
  const meta = tv.refinement.meta as { op?: unknown; n?: unknown };
  const op = meta?.op;
  const n = meta?.n;
  if (typeof n !== "number") return undefined;
  if (op !== "gt" && op !== "ge" && op !== "lt" && op !== "le") return undefined;
  const t = term ?? termVar("_r");
  const b = lit(n);
  switch (op) {
    case "gt":
      return gt(t, b);
    case "ge":
      return ge(t, b);
    case "lt":
      return lt(t, b);
    case "le":
      return le(t, b);
  }
}

function shapeOfLit(v: CoreLit): Shape {
  if (typeof v === "number") return { k: "prim", type: "number" };
  if (typeof v === "string") return { k: "prim", type: "string" };
  if (typeof v === "boolean") return { k: "prim", type: "boolean" };
  if (typeof v === "bigint") return { k: "prim", type: "bigint" };
  return { k: "unknown" };
}

