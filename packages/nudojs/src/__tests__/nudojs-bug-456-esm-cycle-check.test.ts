/**
 * Bug 456 回归（CLI 面）：`nudo check` 检出 ESM import 环就**丢弃整张依赖图**
 * ⇒ 环内文件的 import 全部落空 ⇒ 环内函数在 check 面恒为 `unknown`
 * （原生是确定值）。
 *
 * 原生 oracle（node ESM）：probe() → 0（a(2) → b(1) → a(0) → 0）。
 * 改前：`probe() => unknown`；改后：`probe() => 0`。
 *
 * 本文件锁三件事：
 *  ① 环内文件在 check 面给出**正确签名**（= 原生值）；
 *  ② 求值**有界**：真·无限递归的环被调用环检测器截断成
 *     `nudo:recursion-truncated`（info），不挂死、不无限求值；
 *  ③ 负控制：非环的跨模块调用不受影响（值与改前一致）。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliNode as runCli } from "./helpers/run-cli.ts";

/** 环的一半：a ⇄ b（ESM import 环） */
const A = `import { b } from "./b.js";
export function a(n) { return n <= 0 ? 0 : b(n - 1); }
`;
const B = `import { a } from "./a.js";
export function b(n) { return n <= 0 ? 1 : a(n - 1); }
`;
/** 入口：probe() = a(2) = 0（原生 oracle） */
const ENTRY = `import { a } from "./a.js";
export function probe() { return a(2); }
`;
/** 真·无限递归的环（x ⇄ y，无基例） */
const X = `import { y } from "./y.js";
export function x(n) { return y(n); }
`;
const Y = `import { x } from "./x.js";
export function y(n) { return x(n); }
`;
/** 负控制：非环的跨模块调用（原生 21 * 2 = 42） */
const MATH = `export function double(x) { return x * 2; }
`;
const MATH_ENTRY = `import { double } from "./math.js";
export function probe() { return double(21); }
`;

function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-456-cli-"));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, "utf-8");
  }
  return dir;
}

describe("Bug 456 CLI：nudo check 面对 ESM import 环不再丢弃整张依赖图", () => {
  it("环内文件的签名 = 原生值（改前：unknown）", () => {
    const dir = fixture({ "a.js": A, "b.js": B, "index.js": ENTRY });
    try {
      const r = runCli(["check", "index.js"], { cwd: dir });
      expect(r.stdout).toContain("probe() => 0");
      expect(r.stdout).not.toContain("probe() => unknown");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("求值有界：无限递归的环被截断成 nudo:recursion-truncated（不挂死）", () => {
    const dir = fixture({ "x.js": X, "y.js": Y, "index.js": `import { x } from "./x.js";\nexport function probe() { return x(0); }\n` });
    try {
      const r = runCli(["check", "index.js"], { cwd: dir });
      expect(r.status).toBe(0); // info 不挡门禁
      expect(r.stdout).toContain("nudo:recursion-truncated");
      expect(r.stdout).toContain("probe() => unknown"); // 截断 ⇒ 加宽为 unknown
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("负控制：非环的跨模块调用不受影响（21 * 2 = 42）", () => {
    const dir = fixture({ "math.js": MATH, "index.js": MATH_ENTRY });
    try {
      const r = runCli(["check", "index.js"], { cwd: dir });
      expect(r.stdout).toContain("probe() => 42");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
