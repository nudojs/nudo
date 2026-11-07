/**
 * Bug 482 —— **内联** `@nudo:mock` 丢掉「可构造性」facet ⇒ `new <mock>` 不再定抛
 * ⇒ try/catch 走错分支（原生 "caught"，引擎 "mocked"）+ 门禁假绿。
 * `from` 形态（mock 文件导出箭头）一直是对的 ⇒ 两条路径的 facet 供给不对称。
 *
 * 修法（族 14 · 分片 I）：内联 mock 按载荷形态补 `ctor` facet
 * （箭头/方法/generator/async function ⇒ 不可构造；function/class 表达式 ⇒ 可构造）。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkSource, litValue } from "@nudojs/core";
import { parse, extractDirectivesQuiet } from "@nudojs/parser";
import { mockDirectivesToAbsSeeds, mockSeedsToAbsMocks } from "../mock-abs.ts";
import { tmpProject as makeTmpProject } from "./tmp-project.ts";

/** 内联箭头 mock：原生 `new` 定抛 TypeError ⇒ catch 分支 */
const INLINE_ARROW = `/**
 * @nudo:mock Greeter = () => ({ msg: "mocked" })
 */
export function greet() {
  try { return new Greeter().msg; } catch { return "caught"; }
}
`;

/** 内联 function 表达式 mock：原生可构造 ⇒ 不走 catch 分支 */
const INLINE_FN_EXPR = `/**
 * @nudo:mock Greeter = function () { this.msg = "mocked"; }
 */
export function greet() {
  try { return new Greeter().msg; } catch { return "caught"; }
}
`;

/** 负控制：同一段代码不加 mock（本地 const 箭头） */
const LOCAL_ARROW = `const Greeter = () => ({ msg: "mocked" });

export function greet() {
  try { return new Greeter().msg; } catch { return "caught"; }
}
`;

function seedsOf(source: string, fromFile: string) {
  return mockDirectivesToAbsSeeds(extractDirectivesQuiet(parse(source)), { fromFile });
}

function sigValue(source: string, fromFile: string, name: string): unknown {
  const mocks = mockSeedsToAbsMocks(seedsOf(source, fromFile));
  const report = checkSource(fromFile, source, undefined, {
    inject: { mocks },
    fromFile,
  });
  const sig = report.signatures.find((s) => s.name === name);
  expect(sig, `signature ${name} missing`).toBeDefined();
  const lit = litValue(sig!.abs);
  return lit.ok ? lit.value : sig!.display;
}

describe("Bug 482 — 内联 mock 的可构造性 facet", () => {
  it("内联箭头 mock：new 定抛 ⇒ 走 catch 分支（原生 caught，修复前 mocked）", () => {
    expect(sigValue(INLINE_ARROW, "/tmp/bug482-a.js", "greet")).toBe("caught");
  });

  it("内联 mock 的种子带 ctor facet（箭头 ⇒ 不可构造）", () => {
    const seeds = seedsOf(INLINE_ARROW, "/tmp/bug482-b.js");
    expect(seeds.seedFns.Greeter?.ctor).toBe(false);
  });

  it("内联 function 表达式 mock：可构造（ctor:true），不走 catch 分支", () => {
    const seeds = seedsOf(INLINE_FN_EXPR, "/tmp/bug482-c.js");
    expect(seeds.seedFns.Greeter?.ctor).toBe(true);
    // 构造成功（不再定抛 TypeError）⇒ 结果不是 catch 分支的 "caught"
    const value = sigValue(INLINE_FN_EXPR, "/tmp/bug482-d.js", "greet");
    expect(value).not.toBe("caught");
  });
});

describe("Bug 482 负控制 —— from 形态与本地箭头不受影响", () => {
  it("from 形态（mock 文件导出箭头）仍是 caught", () => {
    const dir = makeTmpProject("nudo-bug482-", {
      "mocks/greeter.js": `export const Greeter = () => ({ msg: "mocked" });\n`,
      "app.js": `/**
 * @nudo:mock Greeter from "./mocks/greeter.js"
 */
export function greet() {
  try { return new Greeter().msg; } catch { return "caught"; }
}
`,
    });
    const entry = join(dir, "app.js");
    const source = readFileSync(entry, "utf-8");
    const mocks = mockSeedsToAbsMocks(
      mockDirectivesToAbsSeeds(extractDirectivesQuiet(parse(source)), { fromFile: entry }),
    );
    const report = checkSource(entry, source, undefined, {
      inject: { mocks },
      fromFile: entry,
    });
    const sig = report.signatures.find((s) => s.name === "greet");
    const lit = litValue(sig!.abs);
    expect(lit.ok ? lit.value : sig!.display).toBe("caught");
  });

  it("本地 const 箭头（不加 mock）仍是 caught", () => {
    expect(sigValue(LOCAL_ARROW, "/tmp/bug482-e.js", "greet")).toBe("caught");
  });
});
