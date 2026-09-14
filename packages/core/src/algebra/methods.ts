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

function numPrim(conf: Abs["conf"] = "path"): Abs {
  return abs({ k: "prim", type: "number" }, undefined, undefined, conf);
}

function strArr(conf: Abs["conf"] = "path"): Abs {
  return abs({ k: "arr", element: strPrim("path") }, undefined, undefined, conf);
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

function isStrRecv(recv: Abs): boolean {
  return (
    isTemplateLike(recv) ||
    (recv.shape.k === "prim" && recv.shape.type === "string") ||
    (recv.term?.op === "lit" && typeof recv.term.value === "string")
  );
}

/**
 * 调用 Abs 方法。返回 undefined = 未接管（调用方走其它路径）。
 */
export function callAbsMethod(
  recv: Abs,
  name: string,
  args: Abs[],
): Abs | undefined {
  if (!isStrRecv(recv)) return undefined;

  const a0 = args[0] ? litValue(args[0]) : undefined;
  const lit = recv.term?.op === "lit" && typeof recv.term.value === "string"
    ? (recv.term.value as string)
    : undefined;

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
        if (a0.startsWith(prefix)) return boolPrim();
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

  // string prim / string 字面量
  switch (name) {
    case "startsWith":
    case "endsWith":
    case "includes":
      if (lit !== undefined && typeof a0 === "string") {
        if (name === "startsWith") return boolLit(lit.startsWith(a0));
        if (name === "endsWith") return boolLit(lit.endsWith(a0));
        return boolLit(lit.includes(a0));
      }
      return boolPrim();
    case "toUpperCase":
    case "toLowerCase":
    case "trim":
      return lit !== undefined ? strLit(
        name === "toUpperCase" ? lit.toUpperCase() : name === "toLowerCase" ? lit.toLowerCase() : lit.trim(),
      ) : strPrim("path");
    case "slice":
    case "substring":
      if (lit !== undefined) {
        const a1 = args[1] ? litValue(args[1]) : undefined;
        if (name === "slice") {
          return strLit(lit.slice(a0 as number | undefined, a1 as number | undefined));
        }
        return strLit(lit.substring(Number(a0 ?? 0), Number(a1 ?? lit.length)));
      }
      return strPrim("path");
    case "charAt":
      return lit !== undefined && typeof a0 === "number" ? strLit(lit.charAt(a0)) : strPrim("path");
    case "toString":
    case "valueOf":
      return lit !== undefined ? strLit(lit) : strPrim("path");
    case "concat": {
      if (lit !== undefined) {
        let s = lit;
        for (const a of args) {
          const av = litValue(a);
          s += av === undefined ? "" : String(av);
        }
        return strLit(s);
      }
      return strPrim("path");
    }
    case "indexOf":
    case "lastIndexOf":
    case "charCodeAt":
      return numPrim("path");
    case "split": {
      if (lit !== undefined) {
        const sep = typeof a0 === "string" ? a0 : undefined;
        if (sep !== undefined) {
          const parts = lit.split(sep).map((s) => strLit(s));
          return abs({ k: "tuple", elements: parts }, undefined, undefined, "exact");
        }
        // 非字面分隔符：保守整段
        return abs({ k: "tuple", elements: [strLit(lit)] }, undefined, undefined, "path");
      }
      return strArr("path");
    }
    case "replace":
    case "replaceAll":
    case "padStart":
    case "padEnd":
    case "repeat":
      return strPrim("path");
  }
  return undefined;
}

/** 属性读取：template/string.length 等 */
export function getAbsProperty(recv: Abs, name: string): Abs | undefined {
  if (name === "length") {
    if (isTemplateLike(recv)) {
      const parts = templatePartsOf(recv);
      const n = fixedLength(parts);
      if (n !== undefined) return numLit(n);
      return numPrim("path");
    }
    if (isStrRecv(recv)) {
      const lit = recv.term?.op === "lit" && typeof recv.term.value === "string"
        ? recv.term.value
        : undefined;
      if (lit !== undefined) return numLit(lit.length);
      return numPrim("path");
    }
  }
  return undefined;
}
