/**
 * RegExp brand 执行面（leaf-ish）：从 class.ts 拆出，避免巨型文件。
 */
import type { Abs } from "../abs.ts";
import { abs, litValue, boolLit, strLit, numLit, num, str } from "../abs.ts";
import { isObj, objOf, joinAbs } from "../objects.ts";
import { undefAbs, applyCallbackAbs, validateCallableArg } from "../hof.ts";
import { pTrue } from "../pred.ts";
import { emptyEnv } from "../ast-env.ts";
import { defaultLeakBudget } from "../leak.ts";
import { NudoThrow } from "./runtime.ts";
import { errorTypeAbs, recordMayThrow } from "./may-throw.ts";
import { registerMatchIter } from "./match-iter.ts";
import { isSymbolAbs } from "../symbol-id.ts";
import { setPropFlags } from "../builtins/invariants.ts";
import { validateRegexSubjectArg, matchResultAbs, tryMakeRegexAbs, markMatchArrayView } from "../builtins/regexp.ts";

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

/** ToLength（ES 规范）：NaN→0、截断小数、夹 [0, 2^53-1]——match/matchAll
 *  的 lastIndex 起点规范化（Bug 94）。 */
function toLength(n: number): number {
  if (Number.isNaN(n)) return 0;
  const t = Math.trunc(n);
  return t < 0 ? 0 : Math.min(t, Number.MAX_SAFE_INTEGER);
}

/** brand 槽 lastIndex 重绑原语（test/exec 状态写回 / Bug 96 参数位消费 / 共用） */
function rebindLastIndex(re: Abs, lastIndex: number): Abs {
  const inner = (re.shape as { k: "brand"; name: string; shape: Abs }).shape;
  if (!isObj(inner)) return re;
  const slots = { ...inner.shape.slots, lastIndex: { value: numLit(lastIndex) } };
  return abs(
    { k: "brand", name: "RegExp", shape: objOf(slots, { open: inner.shape.open }) },
    re.term,
    re.pred,
    re.conf,
  );
}

/** 严格 undefined 字面量判定（compile 的 flags 缺省形） */
function isUndefLit(a: Abs | undefined): boolean {
  if (!a || a.term?.op !== "lit") return false;
  const r = litValue(a);
  return r.ok && r.value === undefined;
}

/** Bug 126：r.compile(pattern, flags) 的 brand 重建（execRegexBrand 值通道与
 *  $reStateCall 写回通道共用）。原生（Annex B B.2.3.1）：
 *  - RegExp 实参 + flags 缺省/undefined 字面 → 复制其实参的 source/flags；
 *    flags 给定（非 undefined 字面）→ 定抛 TypeError（compile 保留了
 *    new RegExp(regex, flags) 在 ES2022 已放宽的限制，node 实测）；
 *    flags 抽象 → may TypeError，保守原样返回。
 *  - 其余实参走 tryMakeRegexAbs 验证（无参 → /(?:)/；symbol → TypeError；
 *    非法 pattern/flags → SyntaxError；抽象 → may 打点返回 undefined）。
 *  - 成功 → 全槽重建的新 brand（source/flags/标志 getter/lastIndex=0），
 *    原生返回接收者本身（表达式值与写回绑定同源）。 */
function compileRegexBrand(re: Abs, args: Abs[]): Abs {
  const p0 = args[0];
  const fAbs = args[1];
  if (p0 && p0.shape.k === "brand" && (p0.shape as { name?: string }).name === "RegExp") {
    if (fAbs && !isUndefLit(fAbs)) {
      if (fAbs.term?.op === "lit") throw new NudoThrow(errorTypeAbs("TypeError"));
      recordMayThrow({ kind: "TypeError", cause: "compile: RegExp argument with flags may throw (flags may be undefined)" });
      return re;
    }
    const src = regexParts(p0);
    if (!src) return re; // 实参 source/flags 非字面量：保守不动
    return tryMakeRegexAbs([strLit(src.pat), strLit(src.flags)]) ?? re;
  }
  return tryMakeRegexAbs(args) ?? re;
}

/** Bug 81：模式自带 @@match/@@search/@@matchAll 钩子（re[Symbol.match]=fn
 *  形——symbolKey 槽投影 "@@match"）的 GetMethod 语义检查：
 *  - 无槽 → none（默认宿主 regex 重建路径）；
 *  - 严格 undefined/null 字面 → nullish（GetMethod 视为缺省，但原生此后走
 *    RegExpCreate(ToString(pattern))——模式变为 "/source/flags" 文本、新对象
 *    起点 lastIndex=0，对 brand 形几乎恒不中）；
 *  - 不可调用 → TypeError（字面量臂定抛；抽象臂 recordMayThrow 后照常调用）；
 *  - 可调用 → call：以模式为 this、字符串为唯一实参调用钩子。 */
type HookOutcome = { kind: "none" } | { kind: "nullish" } | { kind: "call"; value: Abs };
function patternHookOutcome(
  re: Abs,
  inner: Abs | undefined,
  key: "@@match" | "@@search" | "@@matchAll",
  recv: Abs,
): HookOutcome {
  if (!inner || inner.shape.k !== "obj") return { kind: "none" };
  const hook = inner.shape.slots[key]?.value;
  if (!hook) return { kind: "none" };
  const hv = litValue(hook);
  if (hv.ok && (hv.value === undefined || hv.value === null)) return { kind: "nullish" };
  validateCallableArg(hook, `pattern ${key} hook may not be callable`);
  return { kind: "call", value: applyCallbackAbs(hook, [recv], emptyEnv(), pTrue, defaultLeakBudget, re) };
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

/** RegExp brand 上的 exec/test/compile：pattern 与 subject 都是字面量 → 真执行 */
export function execRegexBrand(re: Abs, method: string, args: Abs[]): Abs | undefined {
  if (method !== "exec" && method !== "test" && method !== "toString" && method !== "compile") return undefined;
  const parts = regexParts(re);
  if (!parts) return undefined;
  if (method === "toString") return strLit(`/${parts.pat}/${parts.flags}`);
  // Bug 126：compile 值通道——重建后的 brand 即返回值（原生 compile 返回接收者）
  if (method === "compile") return compileRegexBrand(re, args);
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
    // exec（issue #136）：null | 匹配数组。此前是均质 element（string|
    // undefined）的 arr——`m[0]` 与 `m[1]` 同值、无从窄化；改为与具体路径
    // matchResultAbs 同构的 per-index 槽 obj：捕获组数用 `pat + '|'` 空串
    // 必中探针（引擎权威计数 + groups 名单一次性取得），"0"=整匹配 string、
    // "1".."ng"=string|undefined（未参与捕获组 undefined）、length/index/
    // input/groups 附加属性同源。pattern 异常（理论不可达——brand source 槽
    // 出自真构造）回落旧均质 arr 保守。
    let probe: RegExpExecArray | null = null;
    try {
      probe = new RegExp(`${parts.pat}|`).exec("");
    } catch {
      probe = null;
    }
    const nullArm = abs({ k: "unknown" }, { op: "lit", value: null }, undefined, "exact");
    if (!probe) {
      const element = joinAbs(str(), undefAbs());
      return joinAbs(nullArm, abs({ k: "arr", element }, undefined, undefined, "path"));
    }
    const ng = probe.length - 1;
    const slots: Record<string, { value: Abs }> = {
      "0": { value: str() },
      length: { value: numLit(probe.length) },
      index: { value: num() },
      input: { value: str() },
    };
    for (let i = 1; i <= ng; i++) {
      slots[String(i)] = { value: joinAbs(str(), undefAbs()) };
    }
    const groupNames = probe.groups ? Object.keys(probe.groups) : [];
    slots["groups"] = {
      value: groupNames.length
        ? objOf(Object.fromEntries(groupNames.map((n) => [n, { value: joinAbs(str(), undefAbs()) }])))
        : undefAbs(),
    };
    // Bug「match/exec 结果 JSON 视图」：数组视图标注——JSON.stringify 按
    // 下标槽走数组序列化（与具体路径 matchResultAbs 同构；元素抽象时照常
    // 不可折 partial）。length 单挂非枚举（原生数组 length 唯一非枚举）
    const mAbs = abs({ k: "obj", slots }, undefined, undefined, "path");
    setPropFlags(mAbs, "length", { enumerable: false });
    markMatchArrayView(mAbs);
    return joinAbs(nullArm, mAbs);
  }
  try {
    return regexExecWithState(re, method, subject).result;
  } catch {
    return undefined;
  }
}

/**
 * 语句级 RegExp 状态写回（test/exec/compile）：执行并把状态更新后的 brand
 * 返回给 transpile 重绑（$reStateCall 与 $arrMutContainer 同模式）。
 * 表达式位置不写回（$invoke 只读执行，调用方按 JS 语义先取值）。
 * Bug 96：match/replace/replaceAll 臂是**参数位**消费的语句位写回（模式
 * 作为 String 方法实参，spec @@match/@replace 对原正则 Set lastIndex）。
 * Bug 126：compile 臂重建接收者（值通道 $invoke→execRegexBrand 同一助手）。
 */
export function $reStateCall(re: Abs, method: string, args: Abs[]): Abs {
  const parts = regexParts(re);
  if (!parts) return re;
  if (method === "compile") return compileRegexBrand(re, args);
  if (method === "match" || method === "replace" || method === "replaceAll") {
    // 全局 → Set lastIndex 0（@@match/@replace 步 2；replaceAll 恒 g）；
    // 非全局 sticky 的 match ≡ 单次 RegExpExec 推进（成功 = 匹配末端，失败
    // = 0——宿主 sticky 失败即归 0）；非 sticky 非全局原生不动。sticky 的
    // replace 原生阵营分裂（V8 按 RegExpExec 推进、JSC 保原值）——以 JSC
    // 差分门禁口径为准：不动（Bug 96 报告 Fix 亦只对 match 要求推进）。
    if (parts.flags.includes("g")) return rebindLastIndex(re, 0);
    if (method === "match" && parts.flags.includes("y")) {
      const svR = args[0] ? litValue(args[0]) : undefined;
      const sv = svR?.ok ? svR.value : undefined;
      if (typeof sv !== "string") return re; // 抽象 subject：状态不可判定，保守不动
      try {
        return rebindLastIndex(re, regexExecWithState(re, "exec", sv).lastIndex);
      } catch {
        return re;
      }
    }
    return re;
  }
  if (method !== "test" && method !== "exec") return re;
  // Bug 57：subject ToString 校验（语句级状态写回同样要先过 ToString）
  validateRegexSubjectArg(args[0]);
  const subjectR = args[0] ? litValue(args[0]) : undefined;
  const subject = subjectR?.ok ? subjectR.value : undefined;
  if (typeof subject !== "string") return re; // 抽象 subject：状态不可判定，保守不动
  try {
    const { lastIndex } = regexExecWithState(re, method, subject);
    return rebindLastIndex(re, lastIndex);
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
  // Bug 94：brand 的 lastIndex 槽带入（regexParts 同口径；缺槽/非数值 → 0）
  const lastAbs = inner && inner.shape.k === "obj" ? inner.shape.slots["lastIndex"]?.value : undefined;
  const lastR = lastAbs ? litValue(lastAbs) : undefined;
  const lastV = lastR?.ok ? lastR.value : undefined;
  const lastIndex = typeof lastV === "number" ? lastV : 0;
  // Bug 81：@@match/@@search 钩子分派（matchAll 的在 g 检查之后）——可调用
  // 钩子以模式为 this、字符串为唯一实参调用；nullish 字面槽 → RegExpCreate
  // (ToString(pattern)) 覆盖形（"/source/flags" 文本为模式、空 flags、新对象
  // 起点 lastIndex=0）。
  let toStringPat: string | undefined;
  if (reBrand && method !== "matchAll") {
    const oc = patternHookOutcome(re, inner, method === "match" ? "@@match" : "@@search", recv);
    if (oc.kind === "call") return oc.value;
    if (oc.kind === "nullish" && typeof pat === "string") toStringPat = `/${pat}/${flags}`;
  }
  let reReal: RegExp;
  try {
    reReal = new RegExp(toStringPat ?? (typeof pat === "string" ? pat : strPat!), toStringPat !== undefined ? "" : flags);
  } catch {
    return undefined;
  }
  if (method !== "search" && toStringPat === undefined) {
    // Bug 94：brand 的 lastIndex 起点带入——非全局 match ≡ exec（sticky 从
    // lastIndex 起）；全局 match 宿主先 Set lastIndex=0（spec @@match 步 3），
    // 赋值无害。search（spec 先置 0 再执行后恢复）与 Bug 81 的 RegExpCreate
    // 新对象形（起点恒 0）不带入。
    reReal.lastIndex = toLength(lastIndex);
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
  // Bug 81：@@matchAll 钩子在 g 检查之后分派（原生顺序：isRegExp/flags 检查
  // 先于 GetMethod——非全局 brand 带钩子仍抛，node 实测）
  {
    const oc = patternHookOutcome(re, inner, "@@matchAll", recv);
    if (oc.kind === "call") return oc.value;
    if (oc.kind === "nullish" && typeof pat === "string") toStringPat = `/${pat}/${flags}`;
  }
  let iterRe = reReal;
  if (toStringPat !== undefined) {
    // Bug 81 nullish 覆盖形：RegExpCreate(ToString(r), "g")——新对象起点 0
    try {
      iterRe = new RegExp(toStringPat, "g");
    } catch {
      return undefined;
    }
  } else if (flags.includes("y")) {
    // Bug 94：@@matchAll spec 克隆——flags 去 y（g 已由上方检查保证），
    // ToLength(lastIndex) 起点（/a/g @1 → 命中 1、2；/b/gy @1 → 命中 1 次）
    try {
      iterRe = new RegExp(pat as string, flags.replace(/y/g, ""));
      iterRe.lastIndex = toLength(lastIndex);
    } catch {
      return undefined;
    }
  }
  const ms = sv.matchAll(iterRe);
  const matchEls: Abs[] = [];
  for (const m of ms) {
    // Bug「match/exec 结果 JSON 视图」：迭代元素与 exec 结果同形（原生每项
    // 也是 RegExpExecArray：下标元素进 JSON 面，index/input/groups 非数组
    // 下标、length 非枚举不进）——matchResultAbs 的数组视图标注使
    // JSON.stringify(元素) 按数组折叠，m[0]/m.length/m.index/m.input 读面
    // 与 exec 结果一致
    matchEls.push(matchResultAbs(m));
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
