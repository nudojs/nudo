/**
 * Bug 184 回归（core 转译层）：`switch` 的 **case 标签产生窄化事实**。
 *
 * 修复前：case 标签不产生任何窄化事实 ⇒ 臂内既不知道「本臂命中哪个字面量」，
 * 也不知道「其它臂排除了哪些字面量」：
 * - 命中事实缺失：`switch (x) { case 1: return x; default: return 2; }` 的返回
 *   域含未窄化的 number ⇒ L1 契约 `return number().gt(0)` 假红；
 * - 排除事实缺失：`switch (v) { case null: return 0; default: return v.length; }`
 *   的 default 臂仍可能 v === null ⇒ `v.length` 判 may-throw ⇒ L2 假红。
 *
 * 修复后：case 标签产出**命中事实**（判别值在本臂等于该字面量）与**排除事实**
 * （本臂之外的标签值在本臂被排除）：
 * - 标识符判别式：命中事实以影子重绑表达（臂内判别值 = 该字面量）；排除事实
 *   只有 nullish 标签可表达（$removeNull / $removeUndefined / $removeNullish）。
 * - 成员判别式（`switch (o.kind)`）：命中 / 排除事实均走 $narrowMemberEq。
 *
 * 负控制钉住：① 臂内写判别绑定时**跳过**窄化（影子参数会吞掉臂内写）；② 非
 * 字面量 case 标签不产事实；③ 相邻形态（if/else 判别）不受影响。
 */
import { describe, it, expect } from "vitest";
import { call, throwsError } from "./eval-helpers.ts";
import { abs } from "../abs.ts";
import { pTrue } from "../pred.ts";
import { joinAbs } from "../objects.ts";
import { $lit } from "../exec/runtime/state.ts";
import { formatAbs } from "../format.ts";
import { checkSource } from "../index.ts";
import { l2Count, sidecarOpts } from "./nudo-constraints.ts";

/** 抽象 number 判别值（非字面量 ⇒ switch 走抽象路径） */
const NUMBER_ABS = abs({ k: "prim", type: "number" }, undefined, pTrue, "exact");
/** string | null 判别值 */
const STR_OR_NULL = joinAbs(
  abs({ k: "prim", type: "string" }, undefined, pTrue, "exact"),
  $lit(null),
);

/** 引擎求值（结果面 + throws 面） */
function engine(src: string, arg: unknown): { result: string; throws: string } {
  const r = call(src, "f", [arg as never]);
  return {
    result: formatAbs(r.result as never),
    throws: formatAbs((r as { throws?: unknown }).throws as never),
  };
}

/** 不相交判别联合（TS 判别联合正典形态：两 lit 臂）——成员判别式窄化用 */
const DISJOINT_SRC = `
import { string, shape, union, lit, nullable, array } from "@nudojs/core";
const asUnion = union(
  shape({ type: lit('Identifier'), name: string() }),
  shape({ type: lit('TemplateLiteral'),
          expressions: array(shape({})),
          quasis: array(shape({ value: shape({ cooked: string().optional() }) })) }),
);
export const nodeParam = nullable(asUnion);
`;
const DISC_IMP = `/// @nudo:import { nodeParam } from "./std126.nudo.js"\n`;

/** checkSource + 判别联合侧车 */
function checkDisc(src: string) {
  return checkSource(
    "/t/disc-narrow-184.js",
    DISC_IMP + src,
    pTrue,
    sidecarOpts("std126", DISJOINT_SRC),
  );
}

describe("Bug 184: switch 的 case 标签产生窄化事实", () => {
  it("命中事实：`case 1:` 臂内判别值 = 字面量 1（返回域 1 | 2）", () => {
    const src = `export function f(x) { switch (x) { case 1: return x; default: return 2; } }`;
    const r = engine(src, NUMBER_ABS);
    expect(r.result).toContain("1");
    expect(r.result).toContain("2");
    expect(r.throws).toContain("never");
  });

  it("排除事实：`default:` 臂排除 `case null` ⇒ v.length 不判 may-throw", () => {
    const src = `export function f(v) { switch (v) { case null: return 0; default: return v.length; } }`;
    const r = call(src, "f", [STR_OR_NULL]);
    expect(throwsError((r as { throws?: unknown }).throws, "TypeError")).toBe(false);
  });

  it("排除事实：`case null:` 之外的臂（`case 1:`）同样排除 null", () => {
    const src = `export function f(v) { switch (v) { case 1: return v.length; default: return 0; } }`;
    const r = call(src, "f", [STR_OR_NULL]);
    expect(throwsError((r as { throws?: unknown }).throws, "TypeError")).toBe(false);
  });

  it("多个 case 标签：命中事实取并集（1 | 2 | 3）", () => {
    const src = `export function f(x) { switch (x) { case 1: return x; case 2: return x; default: return 3; } }`;
    const r = engine(src, NUMBER_ABS);
    expect(r.result).toContain("1");
    expect(r.result).toContain("2");
    expect(r.result).toContain("3");
  });

  // --- 负控制 ---------------------------------------------------------
  it("负控制：臂内写判别绑定 ⇒ 跳过窄化（影子参数会吞掉臂内写）", () => {
    const src = `export function f(x) { switch (x) { case 1: x = 5; return x; default: return 2; } }`;
    const r = engine(src, NUMBER_ABS);
    expect(r.result).toContain("5");
  });

  it("负控制：非字面量 case 标签不产事实（臂内判别值不被改写）", () => {
    const src = `export function f(x) { switch (x) { case x + 1: return x; default: return 2; } }`;
    const r = engine(src, NUMBER_ABS);
    // 未窄化：返回域含未窄化的 number（不是字面量 1）
    expect(r.result).not.toContain("1 |");
  });

  it("负控制：相邻形态（if/else 判别）不受影响", () => {
    const src = `export function f(x) { if (x === 1) { return x; } return 2; }`;
    const r = engine(src, NUMBER_ABS);
    expect(r.throws).toContain("never");
  });

  // --- 成员判别式（switch (o.kind)）--------------------------------------
  it("成员判别式：case 标签剪影 union 成员（index 读不记 may-throw）", () => {
    const r = checkDisc(`/**
 * @nudo:contract node nodeParam
 */
export function switchForm(node) {
  if (!node) return null;
  switch (node.type) {
    case 'TemplateLiteral': return node.quasis[0];
    default: return null;
  }
}`);
    expect(l2Count(r, "switchForm")).toBe(0);
  });

  it("负控制：成员判别式的 case 标签**不是**字面量 ⇒ 不剪影（index 读记 may-throw）", () => {
    const r = checkDisc(`/**
 * @nudo:contract node nodeParam
 */
export function switchFormNonLit(node) {
  if (!node) return null;
  switch (node.type) {
    case 'Template' + 'Literal': return node.quasis[0];
    default: return null;
  }
}`);
    expect(l2Count(r, "switchFormNonLit")).toBe(1);
  });
});
