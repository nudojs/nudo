/**
 * RegExp brand 执行面（leaf-ish）：从 class.ts 拆出，避免巨型文件。
 */
import type { Abs } from "../abs.ts";
import { abs, litValue, boolLit, strLit, numLit, str } from "../abs.ts";
import { isObj, objOf, joinAbs } from "../objects.ts";
import { undefAbs } from "../hof.ts";
import { NudoThrow } from "./runtime.ts";
import { errorTypeAbs, recordMayThrow } from "./may-throw.ts";
import { registerMatchIter } from "./match-iter.ts";
import { isSymbolAbs } from "../symbol-id.ts";
import { validateRegexSubjectArg, matchResultAbs } from "../builtins/regexp.ts";

/** RegExp brand 内部 source/flags/lastIndex 提取（exec/test 共用） */
export function regexParts(re: Abs): { pat: string; flags: string; lastIndex: number } | undefined {
  if (re.shape.k !== "brand" || re.shape.name !== "RegExp") return undefined;
  const inner = re.shape.shape;
  if (!isObj(inner)) return undefined;
  const slots = inner.shape.slots;
  const patAbs = slots["source"]?.value;
  const flagsAbs = slots["flags"]?.value;
  const lastAbs = slots["lastIndex"]?.value;
  const patR = patAbs ? litValue(patAbs) : undefined;
  const pat = patR?.ok ? patR.value : undefined;
  if (typeof pat !== "string") return undefined;
  const flagsR = flagsAbs ? litValue(flagsAbs) : undefined;
  const flagsV = flagsR?.ok ? flagsR.value : undefined;
  const flags = typeof flagsV === "string" ? flagsV : "";
  const lvR = lastAbs ? litValue(lastAbs) : undefined;
  const lv = lvR?.ok ? lvR.value : undefined;
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
      result: abs({ k: "unknown" }, { op: "lit", value: null }, undefined, "exact"),
      lastIndex: reReal.lastIndex,
    };
  }
  // Bug 11：RegExpExecArray 带 index/input/groups 附加属性（matchResultAbs）
  //——m[i] 下标读与 m.index/m.input/m.groups 均可解；未参与捕获的组是
  // undefined 字面量（?? 默认值可用）
  return {
    result: matchResultAbs(m),
    lastIndex: reReal.lastIndex,
  };
}

/** RegExp brand 上的 exec/test：pattern 与 subject 都是字面量 → 真执行 */
export function execRegexBrand(re: Abs, method: string, args: Abs[]): Abs | undefined {
  if (method !== "exec" && method !== "test" && method !== "toString") return undefined;
  const parts = regexParts(re);
  if (!parts) return undefined;
  if (method === "toString") return strLit(`/${parts.pat}/${parts.flags}`);
  // Bug 57：subject ToString 校验（symbol 确定 TypeError；抽象 may）
  validateRegexSubjectArg(args[0]);
  const subjectR = args[0] ? litValue(args[0]) : undefined;
  const subject = subjectR?.ok ? subjectR.value : undefined;
  if (typeof subject !== "string") {
    // subject 非字面量：保持抽象（test → boolean，exec → null|match 的保守并）。
    // 此前 exec 直接返回 undefined（注释承诺的保守并未实现）——调用方回落到
    // 「方法不存在」路径，结果被当成 Abs undefined：`typeof m === "undefined"`、
    // `m === null` 折 false，捕获组下标全 unknown，整条 return 退化。
    if (method === "test") {
      return abs({ k: "prim", type: "boolean" }, undefined, undefined, "partial");
    }
    // exec：null | 匹配数组（下标可读；未参与捕获组为 undefined）
    const element = joinAbs(str(), undefAbs());
    const matchAbs = abs({ k: "arr", element }, undefined, undefined, "path");
    const nullAbs = abs({ k: "unknown" }, { op: "lit", value: null }, undefined, "exact");
    return joinAbs(nullAbs, matchAbs);
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
  // Bug 57：subject ToString 校验（语句级状态写回同样要先过 ToString）
  validateRegexSubjectArg(args[0]);
  const subjectR = args[0] ? litValue(args[0]) : undefined;
  const subject = subjectR?.ok ? subjectR.value : undefined;
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
  const patR = patAbs ? litValue(patAbs) : undefined;
  const pat = patR?.ok ? patR.value : undefined;
  // Bug 38：字符串 pattern——原生 search/match 第一步 RegExpCreate(ToString(
  // pattern))，与空 flags 的 RegExp 等价（"abc123".search("c") ≡ search(/c/)）。
  // 一切非 symbol 字面量（string/number/bool/null/bigint/undefined）经
  // ToString 折叠；matchAll 的字符串 pattern 恒无 g → 下方 !reBrand 分支
  // 回落 callAbsMethod 的定抛臂。
  const litTerm = re && re.term?.op === "lit" ? (re.term as { op: "lit"; value: unknown }) : undefined;
  const strPat =
    !reBrand && litTerm && typeof litTerm.value !== "symbol"
      ? String(litTerm.value)
      : undefined;
  const svR = litValue(recv);
  const sv = svR.ok && typeof svR.value === "string" ? svR.value : undefined;
  if (typeof sv !== "string") return undefined; // 非字符串字面量接收者：不接管
  // Bug 42：pattern 实参 ToString 校验——'a'.match/search/matchAll(Symbol())
  // 原生均抛（RegExpCreate/GetMethod 路径 ToString；node 实测）。RegExp brand
  // 合法；抽象 prim ToString total；其余（obj/fn/brand/sum/any/tuple/arr）→ may
  if (isSymbolAbs(re)) throw new NudoThrow(errorTypeAbs("TypeError"));
  if (
    re !== undefined &&
    re.term?.op !== "lit" &&
    !reBrand &&
    re.shape.k !== "prim"
  ) {
    recordMayThrow({ kind: "TypeError", cause: "match/search/matchAll pattern ToString may throw (Symbol)" });
  }
  if (typeof pat !== "string" && strPat === undefined) return undefined;
  const flagsR = flagsAbs ? litValue(flagsAbs) : undefined;
  const flagsV = flagsR?.ok ? flagsR.value : undefined;
  const flags = typeof flagsV === "string" ? flagsV : "";
  let reReal: RegExp;
  try {
    reReal = new RegExp(typeof pat === "string" ? pat : strPat!, flags);
  } catch {
    return undefined;
  }
  if (method === "search") {
    const idx = sv.search(reReal);
    return abs({ k: "prim", type: "number" }, { op: "lit", value: idx }, undefined, "exact");
  }
  if (method === "match") {
    // 非 global match ≡ exec；global → 全部命中串；无命中 → null（不是 []）
    if (flags.includes("g")) {
      const all = sv.match(reReal);
      if (all === null) {
        return abs({ k: "unknown" }, { op: "lit", value: null }, undefined, "exact");
      }
      return abs({ k: "tuple", elements: all.map((s) => strLit(s)) }, undefined, undefined, "exact");
    }
    const m = reReal.exec(sv);
    if (!m) {
      return abs({ k: "unknown" }, { op: "lit", value: null }, undefined, "exact");
    }
    return matchResultAbs(m);
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
 * Object.assign（evaluator 专用，accessor 感知）：与 builtins 的槽位合并对齐，
 * 但拷贝源访问器时**调用 getter**（原生语义），结果槽存 getter 返回值。
 */
/** strict：Object.assign 到不可变/不可扩展/不可写目标 → TypeError（同 $set 口径） */
