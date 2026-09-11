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
  return parts.join("  ");
}

export function formatShape(a: Abs): string {
  const s = a.shape;
  switch (s.k) {
    case "never":
      return "never";
    case "unknown":
      return "unknown";
    case "prim": {
      const lv = litValue(a);
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
    case "arr":
      return `${formatShape(s.element)}[]`;
    case "tuple":
      return `[${s.elements.map(formatShape).join(", ")}]`;
    case "fn": {
      const ret =
        s.returnType !== undefined ? formatShape(s.returnType) : "?";
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
