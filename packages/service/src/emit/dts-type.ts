/**
 * dts 声明 IR · 类型节点 + 打印器。
 *
 * 第一切片只覆盖**无需引擎上下文**的类型：prim / 字面量 / array / tuple /
 * union / never / unknown。遇到 obj / brand / fn / eff / 模板 / 类型变量 /
 * 收窄 pred 时返回 undefined，由调用方回落到既有 `absToTSType`。
 *
 * 这样新路径可以逐步接管简单返回 / 参数类型，而不在一次改动里重写 8.5k 行
 * 渲染器。
 */
import { extStateOf, type Abs } from "@nudojs/core";

export type DtsType =
  | { kind: "prim"; name: string }
  | { kind: "literal"; text: string }
  | { kind: "never" }
  | { kind: "unknown" }
  | { kind: "array"; element: DtsType; readonly?: boolean }
  | {
      kind: "tuple";
      elements: DtsType[];
      holes?: readonly number[];
      rest?: DtsType;
      readonly?: boolean;
    }
  | { kind: "union"; members: DtsType[] };

export type DtsTypeOpts = {
  /** `as const` 通道下的元组是 readonly（与 absToTSType 的全局开关同口径） */
  readonlyTuples?: boolean;
};

/**
 * Abs → DtsType；返回 undefined = 本切片不负责，调用方回落。
 *
 * 保守条件：任何非字面量 term、任何收窄 pred、类型变量都直接放弃；宁可走
 * 旧渲染器，也不让新打印器输出与旧产物不同的文本。
 */
export function dtsTypeOfAbs(a: Abs, opts: DtsTypeOpts = {}): DtsType | undefined {
  if (a.pred !== undefined && a.pred.op !== "true") return undefined;
  if (a.term !== undefined && a.term.op !== "lit") return undefined;

  if (a.term?.op === "lit") {
    const v = a.term.value;
    if (v === null) return { kind: "literal", text: "null" };
    if (v === undefined) return { kind: "literal", text: "undefined" };
    if (a.shape.k === "prim") {
      if (typeof v === "string") return { kind: "literal", text: JSON.stringify(v) };
      if (typeof v === "boolean") return { kind: "literal", text: String(v) };
      if (typeof v === "number") {
        return Number.isFinite(v)
          ? { kind: "literal", text: String(v) }
          : { kind: "prim", name: "number" };
      }
      if (typeof v === "bigint") return { kind: "prim", name: "bigint" };
    }
  }

  switch (a.shape.k) {
    case "never":
      return { kind: "never" };
    case "unknown":
      return { kind: "unknown" };
    case "any":
      // nudo any 在 TS 投影面 = unknown（ABS-03 产品裁定）。
      return { kind: "unknown" };
    case "prim":
      return { kind: "prim", name: a.shape.type };
    case "arr": {
      const element = dtsTypeOfAbs(a.shape.element, opts);
      return element === undefined
        ? undefined
        : {
            kind: "array",
            element,
            ...(opts.readonlyTuples || isFrozen(a) ? { readonly: true } : {}),
          };
    }
    case "tuple": {
      const elements: DtsType[] = [];
      for (const el of a.shape.elements) {
        const t = dtsTypeOfAbs(el, opts);
        if (t === undefined) return undefined;
        elements.push(t);
      }
      let rest: DtsType | undefined;
      if (a.shape.rest) {
        rest = dtsTypeOfAbs(a.shape.rest, opts);
        if (rest === undefined) return undefined;
      }
      return {
        kind: "tuple",
        elements,
        ...(a.shape.holes?.length ? { holes: [...a.shape.holes] } : {}),
        ...(rest ? { rest } : {}),
        ...(opts.readonlyTuples || isFrozen(a) ? { readonly: true } : {}),
      };
    }
    case "sum": {
      const members: DtsType[] = [];
      for (const m of a.shape.members) {
        const t = dtsTypeOfAbs(m, opts);
        if (t === undefined) return undefined;
        members.push(t);
      }
      return { kind: "union", members };
    }
    default:
      return undefined;
  }
}

/** `Object.freeze` 的冻结侧表（与 absToTSTypeB 的 BUG-392 判据同源）。 */
function isFrozen(a: Abs): boolean {
  return a.facets?.frozen === true || extStateOf(a) === "frozen";
}

/** DtsType → TS 文本（与 absToTSType 的支持子集逐字同形）。 */
export function renderDtsType(t: DtsType): string {
  switch (t.kind) {
    case "prim":
      return t.name;
    case "literal":
      return t.text;
    case "never":
      return "never";
    case "unknown":
      return "unknown";
    case "array": {
      const el = renderDtsType(t.element);
      const arr = t.element.kind === "union" ? `(${el})[]` : `${el}[]`;
      return t.readonly ? `readonly ${arr}` : arr;
    }
    case "tuple": {
      const parts = t.elements.map((el, i) => {
        const text = renderDtsType(el);
        return t.holes?.includes(i) ? `hole: ${text}` : text;
      });
      if (t.rest) {
        const restText =
          t.rest.kind === "array"
            ? renderDtsType(t.rest)
            : t.rest.kind === "union"
              ? `(${renderDtsType(t.rest)})[]`
              : `${renderDtsType(t.rest)}[]`;
        parts.push(`...${restText}`);
      }
      return `${t.readonly ? "readonly " : ""}[${parts.join(", ")}]`;
    }
    case "union": {
      const parts = t.members
        .map(renderDtsType)
        .filter((s) => s !== "never");
      const uniq = [...new Set(parts)];
      return uniq.length === 0 ? "never" : uniq.join(" | ");
    }
  }
}
