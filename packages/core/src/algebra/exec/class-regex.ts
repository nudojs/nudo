/**
 * RegExp brand 执行面（leaf-ish）：从 class.ts 拆出，避免巨型文件。
 */
import type { Abs } from "../abs.ts";
import { abs, litValue, boolLit, strLit, numLit } from "../abs.ts";
import { isObj, objOf } from "../objects.ts";
import { undefAbs } from "../hof.ts";
import { NudoThrow } from "./runtime.ts";
import { errorTypeAbs } from "./may-throw.ts";
import { registerMatchIter } from "./match-iter.ts";

/** RegExp brand 内部 source/flags/lastIndex 提取（exec/test 共用） */
export function regexParts(re: Abs): { pat: string; flags: string; lastIndex: number } | undefined {
  if (re.shape.k !== "brand" || re.shape.name !== "RegExp") return undefined;
  const inner = re.shape.shape;
  if (!isObj(inner)) return undefined;
  const slots = inner.shape.slots;
  const patAbs = slots["source"]?.value;
  const flagsAbs = slots["flags"]?.value;
  const lastAbs = slots["lastIndex"]?.value;
  const pat = patAbs ? litValue(patAbs) : undefined;
  if (typeof pat !== "string") return undefined;
  const flagsV = flagsAbs ? litValue(flagsAbs) : undefined;
  const flags = typeof flagsV === "string" ? flagsV : "";
  const lv = lastAbs ? litValue(lastAbs) : undefined;
  const lastIndex = typeof lv === "number" ? lv : 0;
  return { pat, flags, lastIndex };
}

/** 带 receiver lastIndex 的真实执行：返回结果 Abs 与执行后的 lastIndex */
export function regexExecWithState(
  re: Abs,
  method: "test" | "exec",
  subject: string,
): { result: Abs; lastIndex: number } {
  const parts = regexParts(re)!;
  const reReal = new RegExp(parts.pat, parts.flags);
  reReal.lastIndex = parts.lastIndex;
  if (method === "test") {
    const ok = reReal.test(subject);
    return { result: boolLit(ok), lastIndex: reReal.lastIndex };
  }
  const m = reReal.exec(subject);
  if (!m) {
    return {
      result: abs({ k: "unknown" }, { op: "lit", value: null as never }, undefined, "exact"),
      lastIndex: reReal.lastIndex,
    };
  }
  // m[i] 按下标可读：tuple；未参与捕获的组是 undefined 字面量（?? 默认值可用）
  const els: Abs[] = m.map((g) => (g === undefined ? undefAbs() : strLit(g)));
  return {
    result: abs({ k: "tuple", elements: els }, undefined, undefined, "exact"),
    lastIndex: reReal.lastIndex,
  };
}

/** RegExp brand 上的 exec/test：pattern 与 subject 都是字面量 → 真执行 */
export function execRegexBrand(re: Abs, method: string, args: Abs[]): Abs | undefined {
  if (method !== "exec" && method !== "test" && method !== "toString") return undefined;
  const parts = regexParts(re);
  if (!parts) return undefined;
  if (method === "toString") return strLit(`/${parts.pat}/${parts.flags}`);
  const subject = args[0] ? litValue(args[0]) : undefined;
  if (typeof subject !== "string") {
    // subject 非字面量：保持抽象（test → boolean，exec → null|tuple 的保守并）
    return method === "test"
      ? abs({ k: "prim", type: "boolean" }, undefined, undefined, "partial")
      : undefined;
  }
  try {
    return regexExecWithState(re, method, subject).result;
  } catch {
    return undefined;
  }
}

/**
 * 语句级 RegExp 状态写回（test/exec）：执行并把 lastIndex 更新后的 brand
 * 返回给 transpile 重绑（$reStateCall 与 $arrMutContainer 同模式）。
 * 表达式位置不写回（$invoke 只读执行，调用方按 JS 语义先取值）。
 */
export function $reStateCall(re: Abs, method: string, args: Abs[]): Abs {
  const parts = regexParts(re);
  if (!parts || (method !== "test" && method !== "exec")) return re;
  const subject = args[0] ? litValue(args[0]) : undefined;
  if (typeof subject !== "string") return re; // 抽象 subject：状态不可判定，保守不动
  try {
    const { lastIndex } = regexExecWithState(re, method, subject);
    const inner = (re.shape as { k: "brand"; name: string; shape: Abs }).shape;
    if (!isObj(inner)) return re;
    const slots = { ...inner.shape.slots, lastIndex: { value: numLit(lastIndex) } };
    return abs(
      { k: "brand", name: "RegExp", shape: objOf(slots, { open: inner.shape.open }) },
      re.term,
      re.pred,
      re.conf,
    );
  } catch {
    return re;
  }
}

/** string.match(/re/) / string.search(/re/) / string.matchAll(/re/g)：双字面量 → 真执行 */
export function stringRegexMethod(recv: Abs, method: string, args: Abs[]): Abs | undefined {
  if (method !== "match" && method !== "search" && method !== "matchAll") return undefined;
  const re = args[0];
  const reBrand =
    !!re && re.shape.k === "brand" && re.shape.name === "RegExp"
      ? (re as Abs & { shape: Extract<Abs["shape"], { k: "brand" }> })
      : undefined;
  const inner = reBrand?.shape.shape;
  const patAbs = inner && inner.shape.k === "obj" ? inner.shape.slots["source"]?.value : undefined;
  const flagsAbs = inner && inner.shape.k === "obj" ? inner.shape.slots["flags"]?.value : undefined;
  const pat = patAbs ? litValue(patAbs) : undefined;
  const sv = litValue(recv);
  if (typeof pat !== "string" || typeof sv !== "string") return undefined;
  const flagsV = flagsAbs ? litValue(flagsAbs) : undefined;
  const flags = typeof flagsV === "string" ? flagsV : "";
  let reReal: RegExp;
  try {
    reReal = new RegExp(pat, flags);
  } catch {
    return undefined;
  }
  if (method === "search") {
    const idx = sv.search(reReal);
    return abs({ k: "prim", type: "number" }, { op: "lit", value: idx as never }, undefined, "exact");
  }
  if (method === "match") {
    // 非 global match ≡ exec；global → 全部命中串；无命中 → null（不是 []）
    if (flags.includes("g")) {
      const all = sv.match(reReal);
      if (all === null) {
        return abs({ k: "unknown" }, { op: "lit", value: null as never }, undefined, "exact");
      }
      return abs({ k: "tuple", elements: all.map((s) => strLit(s)) }, undefined, undefined, "exact");
    }
    const m = reReal.exec(sv);
    if (!m) {
      return abs({ k: "unknown" }, { op: "lit", value: null as never }, undefined, "exact");
    }
    const els: Abs[] = m.map((g) => (g === undefined ? undefAbs() : strLit(g)));
    return abs({ k: "tuple", elements: els }, undefined, undefined, "exact");
  }
  // matchAll：非全局正则原生 TypeError（hard throw，catch 可吸收）；
  // 全局（brand /g）→ 真执行迭代，每项 [full, ...groups] 元组
  if (!reBrand) return undefined; // 非 brand 参数（如字符串模式）：保守回落
  if (!flags.includes("g")) {
    throw new NudoThrow(
      errorTypeAbs("TypeError"),
    );
  }
  const ms = sv.matchAll(reReal);
  const matchEls: Abs[] = [];
  for (const m of ms) {
    const els: Abs[] = m.map((g) => (g === undefined ? undefAbs() : strLit(g)));
    matchEls.push(abs({ k: "tuple", elements: els }, undefined, undefined, "exact"));
  }
  // RegExpStringIterator 是对象：无 .length/下标；展开经侧表按匹配项精确迭代
  const iter = abs(
    { k: "brand", name: "RegExpMatchIterator", shape: objOf({}) },
    undefined,
    undefined,
    "path",
  );
  registerMatchIter(iter, matchEls);
  return iter;
}

/**
 * Object.assign（B-path 专用，accessor 感知）：与 builtins 的槽位合并对齐，
 * 但拷贝源访问器时**调用 getter**（原生语义），结果槽存 getter 返回值。
 */
/** strict：Object.assign 到不可变/不可扩展/不可写目标 → TypeError（同 $set 口径） */
