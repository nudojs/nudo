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
      // JSON.stringify(bigint) throws；按 JS 字面量拼法展示
      if (typeof lv === "bigint") return `${String(lv)}n`;
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
      const ret =
        s.returnType !== undefined ? formatShapeSlot(s.returnType) : "?";
      const labels = s.params ?? [];
      const paramTypes = s.paramTypes;
      const hasMarkers = labels.some(
        (p) => p.startsWith("...") || p.endsWith("?"),
      );

      // Rest (`...paths`) / optional (`options?`) labels win over raw paramTypes
      // so env signatures do not over-declare Node variadic/optional arity.
      const renderLabeled = (): string[] => {
        const ps: string[] = [];
        const n = paramTypes ? Math.max(paramTypes.length, labels.length) : labels.length;
        for (let i = 0; i < n; i++) {
          const label = labels[i];
          const type = paramTypes?.[i];
          const typeText = type !== undefined ? formatShapeSlot(type) : undefined;
          if (label?.startsWith("...")) {
            ps.push(typeText ? `...${label.slice(3)}: ${typeText}` : label);
          } else if (label?.endsWith("?")) {
            ps.push(typeText ? `${label.slice(0, -1)}?: ${typeText}` : label);
          } else if (typeText !== undefined) {
            ps.push(typeText);
          } else if (label) {
            ps.push(label);
          }
        }
        return ps;
      };

      if (hasMarkers) {
        return `(${renderLabeled().join(", ")}) => ${ret}`;
      }
      if (paramTypes && paramTypes.length > 0) {
        const ps = paramTypes.map((p) => formatShapeSlot(p));
        return `(${ps.join(", ")}) => ${ret}`;
      }
      return `(${labels.join(", ")}) => ${ret}`;
    }
    case "brand": {
      // Map/Set/WeakMap 泛型参数（harvest 的 __key/__value/__elem 槽）
      const inner = s.shape as Abs;
      const slots = inner && inner.shape && inner.shape.k === "obj" ? inner.shape.slots : undefined;
      if (slots) {
        const arg = (key: string): string | undefined => {
          const sl = slots[key];
          return sl ? formatShapeSlot(sl.value) : undefined;
        };
        if (s.name === "Map" || s.name === "ReadonlyMap" || s.name === "WeakMap") {
          const k = arg("__key");
          const v = arg("__value");
          if (k !== undefined && v !== undefined) return `${s.name}<${k}, ${v}>`;
        }
        if (s.name === "Set" || s.name === "ReadonlySet" || s.name === "WeakSet") {
          const el = arg("__elem");
          if (el !== undefined) return `${s.name}<${el}>`;
        }
      }
      return `${s.name}`;
    }
    case "eff":
      return `${s.eff}<${formatShape(s.inner)}>`;
    case "sum": {
      // 渲染去重：不同 term/pred 的成员可能渲染成同一形状（例如两条 number
      // 路径）——formatShape 是有损外延视图，重复文本只留一次；formatAbs
      // 仍保留全部成员（无损）。
      const seen = new Set<string>();
      const parts: string[] = [];
      for (const m of s.members) {
        const t = formatShape(m);
        if (seen.has(t)) continue;
        seen.add(t);
        parts.push(t);
      }
      return parts.join(" | ");
    }
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
