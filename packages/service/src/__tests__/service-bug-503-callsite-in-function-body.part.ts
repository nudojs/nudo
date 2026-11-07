/**
 * Bug 503：调用点位于**导出函数体内**时，Nudo 从不合成 `call@` case ⇒ 回落
 * 成 `entry@` ⇒ 该函数的调用点域完全丢失（误报 entry-only）。
 *
 * 根因（analyzer-orchestrate-uncached-cases.ts / analyzer-orchestrate-uncached.ts）：
 * `call@` 合成只消费**外部传入**的 records；函数体求值期间发生的调用不落
 * 共享 callRecords ⇒ 被调方永远只有 `entry@`。
 *
 * 修法：入口求值（entry@ 兜底）时开启调用点采集，把函数体内的调用并入共享
 * callRecords；被调方若已先回落 entry@，则在证据出现后撤掉 entry@、改合成
 * call@ 见证（调用点域恢复 ⇒ 不再误报 entry-only）。
 *
 * 钉：函数体内的调用点 → 被调方有 call@ 见证（改前只有 entry@）；顶层调用点
 * 口径不变（负控制）；非导出函数口径不变（负控制）。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { analyzeFile } from "../analyzer.ts";
import { withTmpProject, writeTmpFile } from "./tmp-project.ts";

function casesOf(result: ReturnType<typeof analyzeFile>, name: string): string[] {
  const fn = result.functions.find((f) => f.name === name);
  return (fn?.cases ?? []).map((c) => c.name);
}

describe("Bug 503：导出函数体内的调用点 → 合成 call@ 见证", () => {
  it("函数体内调用：被调方有 call@ 见证（改前只有 entry@）", () =>
    withTmpProject("nudo-b503-", (dir) => {
      const src = `export function add(a, b) {
  return a + b;
}
export function run() {
  return add(1, 2);
}
`;
      const file = writeTmpFile(dir, "B.js", src);
      const result = analyzeFile(file, readFileSync(file, "utf-8"));
      const names = casesOf(result, "add");
      expect(names.some((n) => n.startsWith("call@"))).toBe(true);
      expect(names.some((n) => n.startsWith("entry@"))).toBe(false);
      // 调用点域恢复 ⇒ 被调方不再误报 entry-only（调用方 run 仍无调用点域，仍报）
      const entryOnlyMsgs = result.diagnostics
        .filter((d) => d.code === "nudo:interface-entry-only")
        .map((d) => d.message);
      expect(entryOnlyMsgs.some((m) => m.includes("export 'add'"))).toBe(false);
    }));

  it("负控制：顶层调用点口径不变（call@ 见证仍在）", () =>
    withTmpProject("nudo-b503b-", (dir) => {
      const src = `export function add(a, b) {
  return a + b;
}
const x = add(1, 2);
export function get() {
  return x;
}
`;
      const file = writeTmpFile(dir, "A.js", src);
      const result = analyzeFile(file, readFileSync(file, "utf-8"));
      const names = casesOf(result, "add");
      expect(names.some((n) => n.startsWith("call@"))).toBe(true);
      expect(names.some((n) => n.startsWith("entry@"))).toBe(false);
    }));

  it("负控制：非导出函数口径不变（保留 entry@ 见证）", () =>
    withTmpProject("nudo-b503c-", (dir) => {
      const src = `function inner2() { return 7; }
export function run2() { return inner2(); }
`;
      const file = writeTmpFile(dir, "same.js", src);
      const result = analyzeFile(file, readFileSync(file, "utf-8"));
      const names = casesOf(result, "inner2");
      expect(names.some((n) => n.startsWith("entry@"))).toBe(true);
    }));
});
