/**
 * 格式化：把 Abs 渲染成人类可读 / CLI 友好的字符串。
 */

import type { Abs } from "./abs.ts";
import { litValue } from "./abs.ts";
import type { Term } from "./term.ts";
import { termToString } from "./term.ts";
import type { Pred } from "./pred.ts";
import { predToString } from "./pred.ts";

export type FormatOptions = {
  /** 是否显示 term= */
  showTerm?: boolean;
  /** 是否显示 pred */
  showPred?: boolean;
  indent?: string;
};

export function formatAbs(a: Abs, opts: FormatOptions = {}): string {
  const showTerm = opts.showTerm !== false;
  const showPred = opts.showPred !== false;
  const parts: string[] = [];

  parts.push(formatShape(a));

  if (showTerm && a.term && a.term.op !== "lit") {
    parts.push(`= ${termToString(a.term)}`);
  }
  if (showPred && a.pred && a.pred.op !== "true") {
    parts.push(`where ${predToString(a.pred)}`);
  }
  parts.push(`#${a.conf}`);
  // C2.4：分支 join 来源（hover / --verbose 报告可见）
  if (a.pathNote) {
    parts.push(a.pathNote);
  }
  return parts.join("  ");
}

/** fn/arr 槽位：shape + 非 lit term（禁止在 format 里内联复制 term 逻辑） */
export function formatShapeSlot(a: Abs): string {
  const base = formatShape(a);
  if (!a.term || a.term.op === "lit") return base;
  // 关系在 paramTypes/returnType 或 element 里，外层 term 是形参 α 身份，不重复展示
  // （否则 items: arr(A1) 会变成 arr(A1) = A1）
  if (a.shape.k === "fn" || a.shape.k === "arr") return base;
  // any + var → 直接打 term id（A1，而不是 any = A1）
  if (a.shape.k === "any" && a.term.op === "var") return termToString(a.term);
  return `${base} = ${termToString(a.term)}`;
}

export function formatShape(a: Abs): string {
  const s = a.shape;
  switch (s.k) {
    case "never":
      return "never";
    case "any":
      return "any";
    case "unknown": {
      // lit undefined（缺键 / Map miss）必须展示为 undefined，不能与真 unknown 混淆
      if (a.term?.op === "lit" && a.term.value === undefined) return "undefined";
      return "unknown";
    }
    case "prim": {
      const lv = litValue(a);
      // JSON.stringify(NaN|±Infinity) is "null" — keep JS literal spelling.
      if (typeof lv === "number" && !Number.isFinite(lv)) return String(lv);
      if (lv !== undefined) return JSON.stringify(lv);
      return s.type;
    }
    case "obj": {
      const entries = Object.entries(s.slots).map(([k, slot]) => {
        const opt = slot.optional ? "?" : "";
        return `${k}${opt}: ${formatShape(slot.value)}`;
      });
      return `{ ${entries.join(", ")} }`;
    }
    case "arr": {
      // any+var 元素 → arr(A1)（展示关系）；否则 element[]
      if (s.element.shape.k === "any" && s.element.term?.op === "var") {
        return `arr(${formatShapeSlot(s.element)})`;
      }
      return `${formatShape(s.element)}[]`;
    }
    case "tuple":
      return `[${s.elements.map(formatShape).join(", ")}]`;
    case "fn": {
      if (s.paramTypes && s.paramTypes.length > 0) {
        const ps = s.paramTypes.map((p) => formatShapeSlot(p));
        const ret =
          s.returnType !== undefined ? formatShapeSlot(s.returnType) : "?";
        return `(${ps.join(", ")}) => ${ret}`;
      }
      const ret =
        s.returnType !== undefined ? formatShapeSlot(s.returnType) : "?";
      return `(${s.params.join(", ")}) => ${ret}`;
    }
    case "brand":
      return `${s.name}`;
    case "eff":
      return `${s.eff}<${formatShape(s.inner)}>`;
    case "sum":
      return s.members.map(formatShape).join(" | ");
    default:
      return "·";
  }
}

/** 多行展示，CLI 用 */
export function formatAbsMultiline(a: Abs, label?: string): string {
  const lines: string[] = [];
  if (label) lines.push(label);
  lines.push(`  ${formatShape(a)}`);
  if (a.term && a.term.op !== "lit") {
    lines.push(`  term: ${termToString(a.term)}`);
  }
  if (a.pred && a.pred.op !== "true") {
    lines.push(`  pred: ${predToString(a.pred)}`);
  }
  lines.push(`  conf: ${a.conf}`);
  return lines.join("\n");
}
