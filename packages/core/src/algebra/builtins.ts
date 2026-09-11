/**
 * Abs 侧常用 builtin：shape 级运算，不依赖 TypeValue host 库。
 * 覆盖 Math / Object / JSON / Number / 全局转换函数的常见面。
 */

import type { Abs } from "./abs.ts";
import { abs, litValue, numLit, strLit, boolLit, unknown, confJoin } from "./abs.ts";

function numPrim(conf: Abs["conf"] = "path"): Abs {
  return abs({ k: "prim", type: "number" }, undefined, undefined, conf);
}

function strPrim(conf: Abs["conf"] = "path"): Abs {
  return abs({ k: "prim", type: "string" }, undefined, undefined, conf);
}

function boolPrim(conf: Abs["conf"] = "partial"): Abs {
  return abs({ k: "prim", type: "boolean" }, undefined, undefined, conf);
}

/** Math.* — 字面量可折叠的返回精确值，否则 number */
export function evalMathMethod(name: string, args: Abs[]): Abs | undefined {
  const a0 = args[0] ? litValue(args[0]) : undefined;
  const a1 = args[1] ? litValue(args[1]) : undefined;
  switch (name) {
    case "abs":
      if (typeof a0 === "number") return numLit(Math.abs(a0));
      return numPrim();
    case "floor":
      if (typeof a0 === "number") return numLit(Math.floor(a0));
      return numPrim();
    case "ceil":
      if (typeof a0 === "number") return numLit(Math.ceil(a0));
      return numPrim();
    case "round":
      if (typeof a0 === "number") return numLit(Math.round(a0));
      return numPrim();
    case "sqrt":
      if (typeof a0 === "number") return numLit(Math.sqrt(a0));
      return numPrim();
    case "min": {
      const lits = args.map(litValue);
      if (lits.length > 0 && lits.every((x) => typeof x === "number")) {
        return numLit(Math.min(...(lits as number[])));
      }
      return numPrim();
    }
    case "max": {
      const lits = args.map(litValue);
      if (lits.length > 0 && lits.every((x) => typeof x === "number")) {
        return numLit(Math.max(...(lits as number[])));
      }
      return numPrim();
    }
    case "pow":
      if (typeof a0 === "number" && typeof a1 === "number") return numLit(Math.pow(a0, a1));
      return numPrim();
    case "sign":
      if (typeof a0 === "number") return numLit(Math.sign(a0));
      return numPrim();
    default:
      return undefined;
  }
}

/** Object.keys/values/entries/assign */
export function evalObjectMethod(name: string, args: Abs[]): Abs | undefined {
  const a0 = args[0];
  switch (name) {
    case "keys": {
      if (a0?.shape.k === "obj") {
        const keys = Object.keys((a0.shape as { slots: Record<string, unknown> }).slots).map((k) =>
          strLit(k),
        );
        return abs({ k: "tuple", elements: keys }, undefined, undefined, "exact");
      }
      return abs({ k: "arr", element: strPrim("path") }, undefined, undefined, "partial");
    }
    case "values": {
      if (a0?.shape.k === "obj") {
        const slots = (a0.shape as { slots: Record<string, { value: Abs }> }).slots;
        const vals = Object.values(slots).map((s) => s.value);
        return abs({ k: "tuple", elements: vals }, undefined, undefined, "exact");
      }
      return abs({ k: "arr", element: unknown }, undefined, undefined, "partial");
    }
    case "entries": {
      if (a0?.shape.k === "obj") {
        const slots = (a0.shape as { slots: Record<string, { value: Abs }> }).slots;
        const entries = Object.entries(slots).map(([, s]) =>
          abs({ k: "tuple", elements: [strPrim("exact"), s.value] }, undefined, undefined, "exact"),
        );
        return abs({ k: "tuple", elements: entries }, undefined, undefined, "exact");
      }
      return abs({ k: "arr", element: unknown }, undefined, undefined, "partial");
    }
    case "assign": {
      // Object.assign(a, b) ≈ spread
      if (!args.length) return unknown;
      let acc = args[0]!;
      for (let i = 1; i < args.length; i++) {
        acc = { ...acc }; // 保持结构；细粒度 spread 在 evalCall 侧
        if (acc.shape.k === "obj" && args[i]!.shape.k === "obj") {
          const base = (acc.shape as { slots: Record<string, { value: Abs }> }).slots;
          const over = (args[i]!.shape as { slots: Record<string, { value: Abs }> }).slots;
          acc = abs({ k: "obj", slots: { ...base, ...over } }, undefined, undefined, confJoin(acc.conf, args[i]!.conf));
        }
      }
      return acc;
    }
    default:
      return undefined;
  }
}

/** JSON.parse / stringify */
export function evalJsonMethod(name: string, args: Abs[]): Abs | undefined {
  if (name === "stringify") return strPrim("partial");
  if (name === "parse") return unknown;
  return undefined;
}

/** Number.isInteger / isNaN / parseFloat 等 */
export function evalNumberStatic(name: string, args: Abs[]): Abs | undefined {
  const a0 = args[0] ? litValue(args[0]) : undefined;
  switch (name) {
    case "isInteger":
      if (typeof a0 === "number") return boolLit(Number.isInteger(a0));
      return boolPrim();
    case "isNaN":
      if (typeof a0 === "number") return boolLit(Number.isNaN(a0));
      return boolPrim();
    case "isFinite":
      if (typeof a0 === "number") return boolLit(Number.isFinite(a0));
      return boolPrim();
    case "parseInt":
    case "parseFloat":
      if (typeof a0 === "string" || typeof a0 === "number") {
        const n = name === "parseInt" ? parseInt(String(a0), 10) : parseFloat(String(a0));
        return numLit(n);
      }
      return numPrim();
    case "MAX_SAFE_INTEGER":
      return numLit(Number.MAX_SAFE_INTEGER);
    default:
      return undefined;
  }
}

/** 全局 parseInt / parseFloat / isNaN / Number / String / Boolean */
export function evalGlobalFn(name: string, args: Abs[]): Abs | undefined {
  const a0 = args[0] ? litValue(args[0]) : undefined;
  switch (name) {
    case "parseInt":
      if (typeof a0 === "string" || typeof a0 === "number") return numLit(parseInt(String(a0), 10));
      return numPrim();
    case "parseFloat":
      if (typeof a0 === "string" || typeof a0 === "number") return numLit(parseFloat(String(a0)));
      return numPrim();
    case "isNaN":
      if (typeof a0 === "number") return boolLit(Number.isNaN(a0));
      return boolPrim();
    case "Number":
      if (typeof a0 === "number") return numLit(a0);
      if (typeof a0 === "string") return numLit(Number(a0));
      if (typeof a0 === "boolean") return numLit(a0 ? 1 : 0);
      return numPrim();
    case "String":
      if (a0 !== undefined) return strLit(String(a0));
      return strPrim();
    case "Boolean":
      if (a0 !== undefined) return boolLit(Boolean(a0));
      return boolPrim();
    default:
      return undefined;
  }
}

/** Array.isArray / Array.from / Array.of */
export function evalArrayStatic(name: string, args: Abs[]): Abs | undefined {
  const a0 = args[0];
  switch (name) {
    case "isArray": {
      if (!a0) return boolLit(false);
      const k = a0.shape.k;
      return boolLit(k === "arr" || k === "tuple");
    }
    case "from":
    case "of":
      return abs({ k: "arr", element: a0 ?? unknown }, undefined, undefined, "path");
    default:
      return undefined;
  }
}
