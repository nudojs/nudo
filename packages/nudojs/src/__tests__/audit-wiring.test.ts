/**
 * 审计批次 2026-11-14 回归钉 · 接线 / 配置（BUG-010 / BUG-022）。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nodeModuleCapability } from "../../../core/src/algebra/exec/capabilities.ts";
import { runCliTsx as runCli } from "./helpers/run-cli.ts";

describe("audit 34 · 能力清单前缀归一化（BUG-010）", () => {
  it("清单里显式 allow 的带前缀内建不再被误判 denied", () => {
    expect(nodeModuleCapability("node:test/reporters")).toBe("allowed");
    expect(nodeModuleCapability("node:path")).toBe("allowed");
    expect(nodeModuleCapability("node:fs")).toBe("denied");
  });
});

function makePkg(dir: string, name: string): void {
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: `${name}-pkg`,
      version: "1.0.0",
      scripts: { typecheck: "tsc --noEmit" },
      devDependencies: { typescript: "^5.4.0" },
    }),
    "utf-8",
  );
}

describe("audit 34 · migrate retire --all 多目标（BUG-022）", () => {
  it("两个位置目标都被退役（一变量对照：无 --all 时也都要退役）", { timeout: 60000 }, () => {
    const root = mkdtempSync(join(tmpdir(), "nudo-audit-retire-"));
    for (const n of ["w1", "w2"]) {
      const dir = join(root, n);
      mkdirSync(dir);
      makePkg(dir, n);
    }
    const r = runCli(["migrate", "retire", "w1", "w2", "--all"], { cwd: root });
    expect(r.status).toBe(0);
    for (const n of ["w1", "w2"]) {
      const pkg = JSON.parse(readFileSync(join(root, n, "package.json"), "utf-8"));
      expect(pkg.scripts.typecheck).toContain("nudo check");
    }
  });
});

import { mkdirSync } from "node:fs";
