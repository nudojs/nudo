/**
 * collectCallRecords 统一 B（exec 模式）：顶层调用 + 测试回调展开
 * （it/test/describe 的回调体才是真实调用点；B 侧以 unknown 实参 $call
 * 展开，队列自然处理 describe 嵌套）。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectCallRecords } from "../analyzer.ts";
import { litValue } from "@nudojs/core";

function withDir(fn: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "nudo-tcb-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("collectCallRecords: B exec + test callback expansion", () => {
  it("it(...) callback body calls are harvested", () => {
    withDir((dir) => {
      const lib = join(dir, "util.js");
      writeFileSync(lib, "export function double(n) { return n * 2; }\n");
      const test = join(dir, "test.js");
      writeFileSync(test, 'import { double } from "./util.js";\nit("case", () => { const r = double(21); });\n');
      const records = collectCallRecords(test, readFileSync(test, "utf-8"));
      const d = records.filter((r) => r.targetExport === "double");
      expect(d.length).toBeGreaterThan(0);
      expect(d.some((r) => String(litValue(r.resultAbs)) === "42")).toBe(true);
    });
  });

  it("describe nesting expands inner it callbacks", () => {
    withDir((dir) => {
      const lib = join(dir, "util.js");
      writeFileSync(lib, "export function double(n) { return n * 2; }\n");
      const test = join(dir, "test.js");
      writeFileSync(
        test,
        'import { double } from "./util.js";\ndescribe("outer", () => { it("inner", () => { double(5); }); });\n',
      );
      const records = collectCallRecords(test, readFileSync(test, "utf-8"));
      const d = records.filter((r) => r.targetExport === "double");
      expect(d.some((r) => String(litValue(r.resultAbs)) === "10")).toBe(true);
    });
  });

  it("plain top-level calls keep parity (no expansion needed)", () => {
    withDir((dir) => {
      const lib = join(dir, "util.js");
      writeFileSync(lib, "export function double(n) { return n * 2; }\n");
      const test = join(dir, "test.js");
      writeFileSync(test, 'import { double } from "./util.js";\nconst r = double(21);\n');
      const records = collectCallRecords(test, readFileSync(test, "utf-8"));
      const d = records.find((r) => r.targetExport === "double");
      expect(d).toBeDefined();
      expect(String(litValue(d!.resultAbs))).toBe("42");
    });
  });

  it("self-registering callback is bounded (no infinite expansion)", () => {
    withDir((dir) => {
      const test = join(dir, "loop.js");
      writeFileSync(test, "describe('a', () => { describe('b', () => { describe('c', () => {}); }); });\n");
      const records = collectCallRecords(test, readFileSync(test, "utf-8"));
      expect(records.length).toBeLessThan(100);
    });
  });
});
