/**
 * throws 域判定与值域计算粒度一致性回归（Bug 2 / 3 / 23 / 25）。
 *
 * 共同症状：`nudo check` L2 门（nudo:entry-may-throw）假阳性——守卫已证明
 * 不可能抛的代码被记 may-throw TypeError。修复分两层：
 *
 * - 转译层守卫剪影（Bug 2/3/23）：nullish / typeof 守卫的臂内影子重绑。
 *   Bug 2：早退提升路径（transpileFnBodyStmts）此前不做剪影——非终结尾句
 *   在 fork 外执行，`p.major` 撞未剪 null 臂记假 may-throw。
 *   Bug 3：复合 `p === null || p === undefined`、`typeof u === "undefined"`
 *   守卫此前不在 nullishGuardOf 白名单；严格 `p === null`/`p === undefined`
 *   剪除粒度按字面量（严格等价只排除该字面量，`null === undefined` 为 false）。
 *   Bug 23：typeof 类型守卫（`typeof v === "string"` 等）完全无剪枝机制。
 * - 判定层 sum 成员感知（Bug 23/25）：isMaybeBigintOperand 对 sum 分配成员
 *   ——纯 prim union（number|string）绝不可能是 Symbol/bigint，不随
 *   obj/fn/brand/any 成员连坐。
 *
 * 假阴性红线（真实可抛路径不得被剪掉）：
 * - 严格 `p === null` 守卫假值臂的 p 仍可能 undefined（g1 对照）
 * - 严格 `p === undefined` / typeof undefined 守卫假值臂仍可能 null（g2/g3 对照）
 * - 无守卫 / any 入口的运算面照旧记 may-throw（noGuard / anyAdd 对照）
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue, formatAbs, runTranspiled, callTranspiledExportFull } from "@nudojs/core";
import { withStdImport, stdOpts } from "./nudo-constraints.ts";
import { abs, num, str, anyAbs, unknown, numLit, type Abs } from "../abs.ts";
import { objOf } from "../objects.ts";
import { lit } from "../term.ts";
import { cmp } from "../arithmetic.ts";
import { $removeNull, $removeUndefined, $narrowTypeOf } from "../exec/runtime/async.ts";
import { runWithMayThrowSession, setMayThrowCollector, type MayThrowEffect } from "../may-throw.ts";
import { nullishGuardOf, typeGuardOf } from "../exec/transpile/stmt-predicates.ts";

function check(src: string) {
  return checkSource("/t/throw-granularity.js", withStdImport(src), pTrue, stdOpts);
}

function l2Count(r: ReturnType<typeof check>, fn?: string): number {
  return r.issues.filter((i) => i.code === "nudo:entry-may-throw" && (!fn || i.fn === fn)).length;
}

function sigOf(r: ReturnType<typeof check>, fn: string): string {
  return r.signatures.find((s) => s.name === fn)?.display ?? "(missing)";
}

/** 引擎边界 may-throw 效果收集（判定层单测用） */
function mayThrowKinds(fn: () => unknown): string[] {
  const effects: MayThrowEffect[] = [];
  runWithMayThrowSession(() => {
    setMayThrowCollector((e) => effects.push(e));
    try {
      fn();
    } catch {
      /* 硬抛面不走 recordMayThrow */
    }
    setMayThrowCollector(null);
  });
  return [...new Set(effects.map((e) => `${e.kind}: ${e.cause ?? ""}`))];
}

const nullLit = abs({ k: "unknown" }, lit(null), undefined, "exact");
const undefLit = abs({ k: "unknown" }, lit(undefined), undefined, "exact");
const sumOf = (members: Abs[]): Abs => ({ shape: { k: "sum", members }, conf: "exact" });

const PARSE = `function parse(s) { if (s === 'x') return { major: 1 }; return null; }`;
const NUM_OR_STR = "/** @nudo:contract v numOrStr */";

// --- Bug 2：非终结尾句的守卫剪枝透传 ---------------------------------------

describe("Bug 2: null 守卫后接非终结尾语句零 L2", () => {
  it("b1：中间绑定 + 尾 return（守卫后仅多一行 const t = p.major）", () => {
    const r = check(
      `${PARSE}\nexport function b1(s) { const p = parse(s); if (p === null) return -1; const t = p.major; return t; }`,
    );
    expect(l2Count(r)).toBe(0);
    expect(r.summary.errors).toBe(0);
    expect(sigOf(r, "b1")).toMatch(/^(-1 \| 1|1 \| -1)\b/);
  });

  it("非终结尾句多个（绑定 + 调用 + return）", () => {
    const r = check(
      `${PARSE}\nfunction use(x) { return x + 1; }\nexport function b1b(s) { const p = parse(s); if (p === null) return -1; const t = p.major; const u = use(t); return u; }`,
    );
    expect(l2Count(r)).toBe(0);
    expect(r.summary.errors).toBe(0);
  });

  it("值面：引擎边界直调折 -1 | 1（早退值与非空臂 join）", () => {
    const exports = runTranspiled(
      `${PARSE}\nexport function b1(s) { const p = parse(s); if (p === null) return -1; const t = p.major; return t; }`,
      { mode: "analyze" },
    );
    const r1 = callTranspiledExportFull(exports, "b1", [str()] as never);
    expect(formatAbs(r1.result)).toMatch(/-1 \| 1|1 \| -1/);
  });

  it("对照：无守卫仍报 L2（剪枝不越界）", () => {
    const r = check(`${PARSE}\nexport function noGuard(s) { const p = parse(s); const t = p.major; return t; }`);
    expect(l2Count(r, "noGuard")).toBeGreaterThan(0);
  });
});

// --- Bug 3：复合 / typeof-undefined 守卫识别 + 剪除粒度 ---------------------

describe("Bug 3: 复合与 typeof undefined 守卫零 L2", () => {
  it("b2：p === null || p === undefined 复合守卫", () => {
    const r = check(
      `${PARSE}\nexport function b2(s) { const p = parse(s); if (p === null || p === undefined) return -1; return p.major; }`,
    );
    expect(l2Count(r)).toBe(0);
    expect(r.summary.errors).toBe(0);
    expect(sigOf(r, "b2")).toMatch(/^(-1 \| 1|1 \| -1)\b/);
  });

  it("b3：typeof u === 'undefined' 守卫（假值臂只剪 undefined）", () => {
    const r = check(
      `export function b3(s) { const u = s === 'x' ? { v: 2 } : undefined; if (typeof u === 'undefined') return 0; return u.v; }`,
    );
    expect(l2Count(r)).toBe(0);
    expect(r.summary.errors).toBe(0);
    expect(sigOf(r, "b3")).toMatch(/^(0 \| 2|2 \| 0)\b/);
  });

  it("&& 形态：p !== null && p !== undefined 正分支剪枝", () => {
    const r = check(
      `${PARSE}\nexport function bAnd(s) { const p = parse(s); if (p !== null && p !== undefined) return p.major; return -1; }`,
    );
    expect(l2Count(r)).toBe(0);
    expect(sigOf(r, "bAnd")).toMatch(/^(-1 \| 1|1 \| -1)\b/);
  });

  it("typeof !== 形态：真值臂剪 undefined", () => {
    const r = check(
      `export function bTne(s) { const u = s === 'x' ? { v: 2 } : undefined; if (typeof u !== 'undefined') return u.v; return 0; }`,
    );
    expect(l2Count(r)).toBe(0);
    expect(sigOf(r, "bTne")).toMatch(/^(0 \| 2|2 \| 0)\b/);
  });

  it("表达式面同享：三元复合守卫零 L2", () => {
    const r = check(
      `${PARSE}\nexport function bTern(s) { const p = parse(s); return p === null || p === undefined ? -1 : p.major; }`,
    );
    expect(l2Count(r)).toBe(0);
  });

  it("粒度假阴性红线：p === null 假值臂仍可能 undefined（g1）", () => {
    // 原生：p=undefined 时 `undefined === null` 为 false → 假值臂 `undefined.major` 抛
    const r = check(
      `export function g1(s) { const p = s === 'x' ? { major: 1 } : undefined; if (p === null) return -1; return p.major; }`,
    );
    expect(l2Count(r, "g1")).toBeGreaterThan(0);
  });

  it("粒度假阴性红线：p === undefined 假值臂仍可能 null（g2）", () => {
    // 原生：p=null 时 `null === undefined` 为 false → 假值臂 `null.major` 抛
    const r = check(
      `export function g2(s) { const p = s === 'x' ? { major: 1 } : null; if (p === undefined) return -1; return p.major; }`,
    );
    expect(l2Count(r, "g2")).toBeGreaterThan(0);
  });

  it("粒度假阴性红线：typeof u === 'undefined' 假值臂仍可能 null（g3）", () => {
    // 原生：u=null 时 typeof null === 'object' ≠ 'undefined' → 假值臂 `null.v` 抛
    const r = check(
      `export function g3(s) { const u = s === 'x' ? { v: 2 } : null; if (typeof u === 'undefined') return 0; return u.v; }`,
    );
    expect(l2Count(r, "g3")).toBeGreaterThan(0);
  });
});

// --- Bug 23：typeof 类型守卫剪枝 -------------------------------------------

describe("Bug 23: typeof 类型守卫七面零 L2", () => {
  const faces: Array<[string, string, RegExp]> = [
    ["addStr", `export function addStr(v) { if (typeof v === "string") { return v + "!"; } return 0; }`, /^string \| 0\b/],
    ["relStr", `export function relStr(v) { if (typeof v === "string") { return v > "a"; } return false; }`, /^boolean/],
    ["forOfStr", `export function forOfStr(v) { if (typeof v === "string") { let s = ""; for (const c of v) s += c; return s; } return ""; }`, /^string\b/],
    ["spreadStr", `export function spreadStr(v) { if (typeof v === "string") { return [...v].length; } return 0; }`, /^number \| 0\b/],
    ["destrStr", `export function destrStr(v) { if (typeof v === "string") { const [c] = v; return c; } return 0; }`, /^string \| undefined \| 0\b/],
    ["tmplStr", "export function tmplStr(v) { if (typeof v === \"string\") { return `${v}!`; } return 0; }", /^string \| 0\b/],
    // number 守卫：不可能的 string 臂消失（此前 number | string | 0）
    ["addNum", `export function addNum(v) { if (typeof v === "number") { return v + 1; } return 0; }`, /^number\b/],
  ];

  it.each(faces)("%s：零 L2，签名精确", (name, fnSrc, sigRe) => {
    const r = check(`${NUM_OR_STR}\n${fnSrc}`);
    expect(l2Count(r, name)).toBe(0);
    expect(r.summary.errors).toBe(0);
    expect(sigOf(r, name)).toMatch(sigRe);
  });

  it("假值臂绑补集：typeof !== 'string' 臂内 v + 1 不记 may-throw", () => {
    const r = check(
      `${NUM_OR_STR}\nexport function negArm(v) { if (typeof v !== "string") { return v + 1; } return v.length; }`,
    );
    expect(l2Count(r, "negArm")).toBe(0);
  });

  it("表达式面：三元与 && 右臂同享类型剪枝", () => {
    const r = check(
      `${NUM_OR_STR}\nexport function ternT(v) { return typeof v === "string" ? v + "!" : 0; }\n/** @nudo:contract w numOrStr */\nexport function andT(w) { return typeof w === "string" && w.length > 1; }`,
    );
    expect(l2Count(r)).toBe(0);
    expect(sigOf(r, "ternT")).toMatch(/^string \| 0\b/);
  });

  it("|| 右臂补集：typeof v === 'string' || v < 1 零 L2", () => {
    const r = check(
      `${NUM_OR_STR}\nexport function orT(v) { return typeof v === "string" || v < 1; }`,
    );
    expect(l2Count(r, "orT")).toBe(0);
  });

  it("issue #105：any 入口 typeof 守卫臂内不再记 may-throw（窄化为 prim）", () => {
    // 守卫证明该臂 v 必是 string（v+"!" 全定）；红线移至无守卫形态。
    const r = check(`export function anyAdd(v) { if (typeof v === "string") { return v + "!"; } return 0; }`);
    expect(l2Count(r, "anyAdd")).toBe(0);
  });

  it("假阴性红线：any 入口（无守卫）强转仍记 may-throw", () => {
    // 无 typeof 守卫的 any 操作数：v 可能是 Symbol/1n → 原生 may TypeError，
    // 与 check-gold 的 scale(x) 用例同口径，不得静默放行。
    const r = check(`export function anyAdd(v) { return v + "!"; }`);
    expect(l2Count(r, "anyAdd")).toBeGreaterThan(0);
  });
});

// --- Bug 25：纯 union 契约的关系运算（判定层成员感知） ----------------------

describe("Bug 25: 纯 prim union 关系运算零假 L2", () => {
  it("plainRel：numOrStr > 'a' 不记 may-throw（成员绝不 Symbol）", () => {
    const r = check(`${NUM_OR_STR}\nexport function plainRel(v) { return v > "a"; }`);
    expect(l2Count(r, "plainRel")).toBe(0);
    expect(r.summary.errors).toBe(0);
    expect(sigOf(r, "plainRel")).toMatch(/^boolean\b/);
  });

  it("plainAdd：v + 1 保持无 L2（对照，不变）", () => {
    const r = check(`${NUM_OR_STR}\nexport function plainAdd(v) { return v + 1; }`);
    expect(l2Count(r, "plainAdd")).toBe(0);
  });

  it("拼接形态：v + '!' 无守卫同样零 L2（Bug 23 同判定点）", () => {
    const r = check(`${NUM_OR_STR}\nexport function plainCat(v) { return v + "!"; }`);
    expect(l2Count(r, "plainCat")).toBe(0);
    expect(sigOf(r, "plainCat")).toMatch(/^string\b/);
  });

  it("判定层单测：cmp 对 prim sum 不记效果；obj/any 成员照记", () => {
    const primSum = sumOf([num(), str()]);
    expect(mayThrowKinds(() => cmp("gt", primSum, str()))).toEqual([]);
    const objSum = sumOf([num(), objOf({ a: { value: num() } })]);
    expect(mayThrowKinds(() => cmp("gt", objSum, str())).length).toBeGreaterThan(0);
    expect(mayThrowKinds(() => cmp("gt", anyAbs, str())).length).toBeGreaterThan(0);
    // eq/ne 显式不走守卫（Symbol() === Symbol() 合法）
    expect(mayThrowKinds(() => cmp("eq", primSum, str()))).toEqual([]);
  });

  it("假阴性红线：unknown（无 lit）成员的 sum 保守照记（口径不变）", () => {
    // unknown = 引擎 fail-closed 令牌（可能任何值含 Symbol）——sum 成员里的
    // unknown 令牌仍记 may-throw；顶层 unknown 才按 wave 1 口径豁免。
    const unkSum = sumOf([num(), unknown]);
    expect(mayThrowKinds(() => cmp("gt", unkSum, str())).length).toBeGreaterThan(0);
    expect(mayThrowKinds(() => cmp("gt", unknown, str()))).toEqual([]);
  });
});

// --- 新运行时助手单元语义 ---------------------------------------------------

describe("守卫剪影运行时助手", () => {
  it("$removeNull / $removeUndefined 各剪各的字面量成员", () => {
    const objM = objOf({ v: { value: num() } });
    const s = sumOf([objM, nullLit, undefLit]);
    expect(($removeNull(s)!.shape as { members: Abs[] }).members).toHaveLength(2);
    expect(($removeUndefined(s)!.shape as { members: Abs[] }).members).toHaveLength(2);
    // 双剪后单成员直接返回该成员本身
    expect($removeUndefined($removeNull(s))).toBe(objM);
    // 非 sum / 纯字面量：原样返回（保守）
    expect($removeNull(nullLit)).toBe(nullLit);
    expect($removeUndefined(undefLit)).toBe(undefLit);
    const five = numLit(5);
    expect($removeNull(five)).toBe(five);
  });

  it("$narrowTypeOf：真臂绑匹配成员、假臂绑补集、不可判成员保留", () => {
    const s = sumOf([num(), str()]);
    // 单成员剪余直接返回该成员（与 $removeNullish 同口径）
    expect($narrowTypeOf(s, "string", true)!.shape).toEqual(str().shape);
    expect($narrowTypeOf(s, "string", false)!.shape).toEqual(num().shape);
    // any 成员两侧保留（保守）：keep=true 剔 num 后单成员返回 any 本身；
    // keep=false num 本就不匹配 → 全保留 → 原样 sum
    const withAny = sumOf([num(), anyAbs]);
    expect($narrowTypeOf(withAny, "string", true)!.shape.k).toBe("any");
    expect($narrowTypeOf(withAny, "string", false)!.shape.k).toBe("sum");
    // typeof null === "object"：null-lit 成员匹配 "object" 臂
    const os = sumOf([str(), nullLit]);
    expect($narrowTypeOf(os, "object", true)).toBe(nullLit);
    expect($narrowTypeOf(os, "string", true)!.shape).toEqual(str().shape);
    // 单形态（非 sum）原样返回
    const single = numLit(5);
    expect($narrowTypeOf(single, "string", true)).toBe(single);
    // issue #105：裸 any 事实臂窄化为对应 prim（term/pred/conf 保留）；
    // 补集臂（keep=false）不可表示 → 保留 any；unknown 是 fail-closed 令牌 → 不窄化
    expect($narrowTypeOf(anyAbs, "string", true)!.shape).toEqual(str().shape);
    expect($narrowTypeOf(anyAbs, "number", true)!.shape).toEqual(num().shape);
    expect($narrowTypeOf(anyAbs, "string", false)).toBe(anyAbs);
    expect($narrowTypeOf(unknown, "string", true)).toBe(unknown);
    // object/function/undefined 无单一 Abs 可表（null/数组/函数各有形态）→ 保留
    expect($narrowTypeOf(anyAbs, "object", true)).toBe(anyAbs);
    expect($narrowTypeOf(anyAbs, "function", true)).toBe(anyAbs);
  });

  it("守卫识别：nullishGuardOf 粒度 / typeGuardOf 臂", () => {
    expect(nullishGuardOf({ type: "BinaryExpression", operator: "===", left: { type: "Identifier", name: "p" }, right: { type: "NullLiteral" } }))
      .toEqual({ name: "p", arm: "alt", grain: "null" });
    expect(nullishGuardOf({ type: "BinaryExpression", operator: "==", left: { type: "Identifier", name: "p" }, right: { type: "NullLiteral" } }))
      .toEqual({ name: "p", arm: "alt", grain: "nullish" });
    expect(nullishGuardOf({ type: "LogicalExpression", operator: "||", left: { type: "BinaryExpression", operator: "===", left: { type: "Identifier", name: "p" }, right: { type: "NullLiteral" } }, right: { type: "BinaryExpression", operator: "===", left: { type: "Identifier", name: "p" }, right: { type: "Identifier", name: "undefined" } } }))
      .toEqual({ name: "p", arm: "alt", grain: "nullish" });
    expect(nullishGuardOf({ type: "LogicalExpression", operator: "&&", left: { type: "BinaryExpression", operator: "!==", left: { type: "Identifier", name: "p" }, right: { type: "NullLiteral" } }, right: { type: "BinaryExpression", operator: "!==", left: { type: "Identifier", name: "p" }, right: { type: "Identifier", name: "undefined" } } }))
      .toEqual({ name: "p", arm: "cons", grain: "nullish" });
    // 异名复合：保守 undefined
    expect(nullishGuardOf({ type: "LogicalExpression", operator: "||", left: { type: "BinaryExpression", operator: "===", left: { type: "Identifier", name: "p" }, right: { type: "NullLiteral" } }, right: { type: "BinaryExpression", operator: "===", left: { type: "Identifier", name: "q" }, right: { type: "NullLiteral" } } }))
      .toBeUndefined();
    expect(typeGuardOf({ type: "BinaryExpression", operator: "===", left: { type: "UnaryExpression", operator: "typeof", argument: { type: "Identifier", name: "v" } }, right: { type: "StringLiteral", value: "string" } }))
      .toEqual({ name: "v", typeOf: "string", arm: "cons" });
    expect(typeGuardOf({ type: "BinaryExpression", operator: "!==", left: { type: "UnaryExpression", operator: "typeof", argument: { type: "Identifier", name: "v" } }, right: { type: "StringLiteral", value: "number" } }))
      .toEqual({ name: "v", typeOf: "number", arm: "alt" });
    // 字面量在左的对称形态
    expect(typeGuardOf({ type: "BinaryExpression", operator: "===", left: { type: "StringLiteral", value: "function" }, right: { type: "UnaryExpression", operator: "typeof", argument: { type: "Identifier", name: "f" } } }))
      .toEqual({ name: "f", typeOf: "function", arm: "cons" });
    // "undefined" 走 nullish 通道，typeGuardOf 不认
    expect(typeGuardOf({ type: "BinaryExpression", operator: "===", left: { type: "UnaryExpression", operator: "typeof", argument: { type: "Identifier", name: "u" } }, right: { type: "StringLiteral", value: "undefined" } }))
      .toBeUndefined();
  });
});
