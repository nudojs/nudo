/**
 * Bug 374 回归：指令文法 / 引理前提 / 接口冲突类诊断必须带**位置**。
 *
 * 机制（Bug 374）：`nudo:assume-invalid`（2 个 push 点）、`nudo:invariant-invalid`
 * （2 个 push 点）、`nudo:interface-conflict`（2 个 push 点）与
 * `nudo:contract-syntax` 构造 issue 时只带 `fn` 不带位置 ⇒ LSP 把红线画在
 * **文件第 1 行第 1 列**、CLI `--json` 的 `issues[].line` 是 `null`
 * （出错指令在第 7~9 行也照样画首行）。
 *
 * 修法：四个码的**每个** push 点都补上**出错指令所在行/列**（行 1-based、
 * 列 0-based，与 Babel loc 同坐标面）。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";

/** 出错的 @nudo:assume 在第 2 行 */
const ASSUME_INVALID = [
  "/**",
  " * @nudo:assume x <= ",
  " */",
  "export function f(x) { return x; }",
].join("\n");

/** 出错的 @nudo:invariant 在第 2 行 */
const INVARIANT_INVALID = [
  "/**",
  " * @nudo:invariant i <= ",
  " */",
  "export function f(x) { return x; }",
].join("\n");

/** 出错的 @nudo:contract 在第 2 行 */
const CONTRACT_SYNTAX = [
  "/**",
  " * @nudo:contract x ((((",
  " */",
  "export function f(x) { return x; }",
].join("\n");

/** 出错的 @nudo:contract 在第 3 行（与侧车同名绑定冲突） */
const CONFLICT = [
  '/// @nudo:import { positive } from "./shapes.nudo.js"',
  "/**",
  " * @nudo:contract x positive",
  " */",
  "export function f(x) { return x; }",
].join("\n");

/** 返回位冲突（同一码的**第二个** push 点） */
const CONFLICT_RET = [
  '/// @nudo:import { positive } from "./shapes.nudo.js"',
  "/**",
  " * @nudo:contract return positive",
  " */",
  "export function f(x) { return x; }",
].join("\n");

const SHAPES_SIDECAR = "export const positive = number().gt(0);";
/** 同名侧车绑定（x < 0）与手写契约（x > 0）矛盾 ⇒ interface-conflict */
const OWN_SIDECAR = "export const f = fn({ x: number().lt(0) }, number());";
/** 同名侧车绑定（返回槽 < 0）与手写契约（返回槽 > 0）矛盾 */
const OWN_SIDECAR_RET = "export const f = fn({ x: number() }, number().lt(0));";

function issuesOf(
  src: string,
  code: string,
  file = "/t/bug-374.js",
  ownSidecar = OWN_SIDECAR,
) {
  return checkSource(file, src, pTrue, {
    entryThrows: "off",
    loadModule: (spec: string) => {
      if (spec === "./shapes.nudo.js") return SHAPES_SIDECAR;
      if (spec.endsWith(".nudo.js")) return ownSidecar;
      return undefined;
    },
    fromFile: file,
  }).issues.filter((i) => i.code === code);
}

describe("Bug 374：四类诊断必须带出错指令的位置", () => {
  it("nudo:assume-invalid ⇒ 行 2 / 列 3", () => {
    const issues = issuesOf(ASSUME_INVALID, "nudo:assume-invalid");
    expect(issues.length).toBe(1);
    expect(issues[0]!.line).toBe(2);
    expect(issues[0]!.column).toBe(3);
    expect(issues[0]!.fn).toBe("f");
  });

  it("nudo:invariant-invalid ⇒ 行 2 / 列 3", () => {
    const issues = issuesOf(INVARIANT_INVALID, "nudo:invariant-invalid");
    expect(issues.length).toBe(1);
    expect(issues[0]!.line).toBe(2);
    expect(issues[0]!.column).toBe(3);
    expect(issues[0]!.fn).toBe("f");
  });

  it("nudo:contract-syntax ⇒ 行 2 / 列 3", () => {
    const issues = issuesOf(CONTRACT_SYNTAX, "nudo:contract-syntax");
    expect(issues.length).toBe(1);
    expect(issues[0]!.line).toBe(2);
    expect(issues[0]!.column).toBe(3);
  });

  it("nudo:interface-conflict ⇒ 行 3 / 列 3（出错指令所在行）", () => {
    const issues = issuesOf(CONFLICT, "nudo:interface-conflict", "/t/conflict.js");
    expect(issues.length).toBe(1);
    expect(issues[0]!.line).toBe(3);
    expect(issues[0]!.column).toBe(3);
    expect(issues[0]!.fn).toBe("f");
  });

  it("nudo:interface-conflict（返回位，同码第二个 push 点）⇒ 行 3 / 列 3", () => {
    const issues = issuesOf(
      CONFLICT_RET,
      "nudo:interface-conflict",
      "/t/conflict-ret.js",
      OWN_SIDECAR_RET,
    );
    expect(issues.length).toBe(1);
    expect(issues[0]!.line).toBe(3);
    expect(issues[0]!.column).toBe(3);
    expect(issues[0]!.message).toContain("return slot");
  });

  it("位置不得回落成文件首行（所有这些码都不得 line === 1）", () => {
    for (const [src, code] of [
      [ASSUME_INVALID, "nudo:assume-invalid"],
      [INVARIANT_INVALID, "nudo:invariant-invalid"],
      [CONTRACT_SYNTAX, "nudo:contract-syntax"],
      [CONFLICT, "nudo:interface-conflict"],
    ] as const) {
      for (const i of issuesOf(src, code)) {
        expect(i.line, `${code} 缺位置`).toBeTypeOf("number");
        expect(i.line, `${code} 位置回落成首行`).toBeGreaterThan(1);
      }
    }
  });
});
