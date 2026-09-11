/**
 * Abs 方法表：模板字符串 / 结构值上的方法与属性。
 * 类型即计算——方法结果仍是 Abs，可继续参与约束推理。
 * 宿主 TypeValue 的 dispatchMethod 只服务 IR 兜底，不是真理源。
 */

import type { Abs } from "./abs.ts";
import { abs, litValue, numLit, strLit, boolLit } from "./abs.ts";
import {
  isTemplateLike,
  templatePartsOf,
  concatString,
} from "./template.ts";

function strPrim(conf: Abs["conf"] = "path"): Abs {
  return abs({ k: "prim", type: "string" }, undefined, undefined, conf);
}

function boolPrim(): Abs {
  return abs({ k: "prim", type: "boolean" }, undefined, undefined, "partial");
}

function knownPrefix(parts: Abs[]): string {
  let s = "";
  for (const p of parts) {
    if (p.term?.op === "lit" && typeof p.term.value === "string") s += p.term.value;
    else break;
  }
  return s;
}

function knownSuffix(parts: Abs[]): string {
  let s = "";
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]!;
    if (p.term?.op === "lit" && typeof p.term.value === "string") s = p.term.value + s;
    else break;
  }
  return s;
}

function fixedLength(parts: Abs[]): number | undefined {
  if (parts.some((p) => !(p.term?.op === "lit" && typeof p.term.value === "string"))) {
    return undefined;
  }
  return parts.reduce((n, p) => n + String(p.term && p.term.op === "lit" ? p.term.value : "").length, 0);
}

/**
 * 调用 Abs 方法。返回 undefined = 未接管（调用方走其它路径）。
 */
export function callAbsMethod(
  recv: Abs,
  name: string,
  args: Abs[],
): Abs | undefined {
  // 模板 / 字符串
  if (isTemplateLike(recv) || (recv.shape.k === "prim" && recv.shape.type === "string")) {
    const a0 = args[0] ? litValue(args[0]) : undefined;
    if (isTemplateLike(recv)) {
      const parts = templatePartsOf(recv);
      const prefix = knownPrefix(parts);
      const suffix = knownSuffix(parts);
      switch (name) {
        case "startsWith": {
          if (typeof a0 !== "string") return boolPrim();
          if (prefix.length >= a0.length) return boolLit(prefix.startsWith(a0));
          if (a0.startsWith(prefix)) return boolPrim();
          return boolLit(false);
        }
        case "endsWith": {
          if (typeof a0 !== "string") return boolPrim();
          if (suffix.length >= a0.length) return boolLit(suffix.endsWith(a0));
          if (a0.endsWith(suffix)) return boolPrim();
          return boolLit(false);
        }
        case "includes": {
          if (typeof a0 !== "string") return boolPrim();
          const fixed = parts
            .filter((p) => p.term?.op === "lit" && typeof p.term.value === "string")
            .map((p) => String(p.term && p.term.op === "lit" ? p.term.value : ""))
            .join("");
          if (fixed.includes(a0)) return boolLit(true);
          return boolPrim();
        }
        case "toUpperCase":
        case "toLowerCase":
        case "trim":
          return strPrim("path");
        case "slice":
          return strPrim("path");
        case "concat": {
          let acc = recv;
          for (const a of args) acc = concatString(acc, a);
          return acc;
        }
        case "toString":
        case "valueOf":
          return recv;
      }
    }
  }

  // 数组 / 元组 join 等已在 ast-eval；此处只补模板
  return undefined;
}

/** 属性读取：template.length 等 */
export function getAbsProperty(recv: Abs, name: string): Abs | undefined {
  if (name === "length") {
    if (isTemplateLike(recv)) {
      const parts = templatePartsOf(recv);
      const n = fixedLength(parts);
      if (n !== undefined) return numLit(n);
      // 有抽象部件：下界 = 固定前缀+后缀长度
      const min = parts
        .filter((p) => p.term?.op === "lit" && typeof p.term.value === "string")
        .reduce((s, p) => s + String(p.term && p.term.op === "lit" ? p.term.value : "").length, 0);
      return abs(
        { k: "prim", type: "number" },
        undefined,
        undefined,
        "path",
      );
    }
  }
  return undefined;
}
