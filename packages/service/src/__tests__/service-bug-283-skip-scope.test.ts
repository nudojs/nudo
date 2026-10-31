/**
 * BUG-283 —— `@nudo:skip` 的**作用域绑定**按**函数名**做键 ⇒
 * ① 内层**同名**函数的 skip **顶掉**外层的声明（偷取）；
 * ② 外层**没有** skip 时内层的 skip **越界**作用到导出函数上（body 不再
 *    评估 ⇒ 导出签名的 **throws 标注被抹掉**）。
 *
 * 根因：`packages/parser/src/directives/fn-directives.ts` 的 `collectFnDirectives`
 * 只推 `{ node, name, directives }`——**把 core scope 自带的 `depth` 丢掉了**
 * ⇒ 消费面 `packages/service/src/skip-directives.ts` 的 `collectSkipReturns`
 * 只能 `Map.set(fn.name, …)` ⇒ 文档序后写者（内层）胜。
 *
 * 修法：depth 一路带下来 + 消费面「同名取**词法最浅**」（与 core
 * `findFnDirectiveScope` 同口径，`docs/design/directive-scope.md` 的
 * 「AST 最近 Function」）。
 *
 * 断言非永真：改前 C 组签名 `string`（外层声明的是 `number()`）、E 组
 * `string`（比 F 组少了 `throws TypeError`）；改后 C = D、E = F 逐字相同。
 */
import { describe, it, expect } from "vitest";
import { checkSource, type NudoSig } from "@nudojs/core";
import { parse, extractDirectivesQuiet } from "@nudojs/parser";
import { collectSkipReturns } from "../skip-directives.ts";
import { pureFnNamesOfAst } from "../eval-pure.ts";

/** 夹具：外层 skip? + 内层函数名 + 内层 skip?（严格单变量对照） */
const fixture = (outerSkip: boolean, innerName: string, innerSkip: boolean): string =>
  [
    ...(outerSkip ? ["/** @nudo:skip => number() */"] : []),
    "export function f(x) {",
    ...(innerSkip ? [`  /** @nudo:skip => string() */`] : []),
    `  function ${innerName}() { return "s"; }`,
    `  return ${innerName}() + x;`,
    "}",
    "",
  ].join("\n");

/** C：外层 number + 内层**同名** string（缺陷组） */
const C = fixture(true, "f", true);
/** D：外层 number + 内层**改名** string（对照组） */
const D = fixture(true, "g", true);
/** E：外层无 skip + 内层**同名** string（越界组） */
const E = fixture(false, "f", true);
/** F：外层无 skip + 内层无 skip（对照组） */
const F = fixture(false, "f", false);

function signatureOf(src: string, name: string): NudoSig {
  const report = checkSource("/tmp/bug-283.js", src, undefined, {
    fromFile: "/tmp/bug-283.js",
    skips: collectSkipReturns(src),
  });
  const sig = report.signatures.find((s) => s.name === name);
  expect(sig, `signature ${name} missing`).toBeDefined();
  return sig!;
}

describe("BUG-283 — @nudo:skip 按「同名取词法最浅」绑定", () => {
  it("C：内层同名函数的 skip 不再顶掉外层（C 的签名 == D 的签名）", () => {
    expect(collectSkipReturns(C).get("f")).toBeDefined();
    expect(signatureOf(C, "f").display).toBe(signatureOf(D, "f").display);
    expect(signatureOf(C, "f").display).toBe("number");
  });

  it("E：外层没有 skip ⇒ 内层同名 skip 不越界（该名不进 skip 表）", () => {
    expect(collectSkipReturns(E).has("f")).toBe(false);
    expect(collectSkipReturns(F).has("f")).toBe(false);
  });

  it("E 与 F 的签名逐字相同（导出函数的 throws 标注不再被抹掉）", () => {
    const e = signatureOf(E, "f");
    const f = signatureOf(F, "f");
    expect(e.display).toBe(f.display);
    expect(e.throws).toBe(f.throws);
    expect(e.throws).toContain("TypeError");
  });

  it("内层函数自己的 skip 仍按最浅同名者裁决（不同名时照常绑定）", () => {
    // D 组：内层改名 g ⇒ g 的 skip 绑定到 g，外层 f 仍是 number()
    expect(collectSkipReturns(D).get("f")).toBeDefined();
    expect(signatureOf(D, "f").display).toBe("number");
  });

  it("同族 @nudo:pure 用同一裁决（内层同名 pure 不标记外层）", () => {
    const src = [
      "export function f(x) {",
      "  /** @nudo:pure */",
      "  function f() { return 1; }",
      "  return f() + x;",
      "}",
      "",
    ].join("\n");
    expect(pureFnNamesOfAst(parse(src))).toEqual([]);
    const renamed = [
      "export function f(x) {",
      "  /** @nudo:pure */",
      "  function g() { return 1; }",
      "  return g() + x;",
      "}",
      "",
    ].join("\n");
    expect(pureFnNamesOfAst(parse(renamed))).toEqual(["g"]);
    // 顶层函数的 pure 不受影响
    expect(
      pureFnNamesOfAst(parse("/** @nudo:pure */\nexport function f() { return 1; }\n")),
    ).toEqual(["f"]);
    // 抽取面仍返回「带指令的函数」（depth 只是新增字段，不改变成员集）
    const fns = extractDirectivesQuiet(parse(C));
    expect(fns.map((fn) => [fn.name, fn.depth])).toEqual([
      ["f", 0],
      ["f", 1],
    ]);
  });
});
