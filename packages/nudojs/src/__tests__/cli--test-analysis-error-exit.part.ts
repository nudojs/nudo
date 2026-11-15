/**
 * BUG-014 — `nudo test` 看不到**分析面 error 级诊断** ⇒ 假绿。
 *
 * 两个可观察面（同一根因：`commands/test.ts` 的退出码只由声明断言 + pathErrors
 * 决定，error 级分析诊断完全不参与）：
 * - 模块装载失败（`nudo:module-missing`，error）⇒ `nudo check` 判红，`nudo test`
 *   此前报绿（exit 0）；
 * - `--json` 面没有 `ok` / error 计数 ⇒ CI 消费方不解析 `diagnostics[]` 就看不出
 *   失败。
 *
 * 反向钉：warning 级诊断（模块环）**不得**把 `test` 判红（那会大面积假红）。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug14-"));
  for (const [name, src] of Object.entries(files)) writeFileSync(join(dir, name), src);
  return dir;
}

function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

const CLEAN = `export function add(a, b) {
  return a + b;
}
`;

/** error 级分析诊断：import 的模块不存在 ⇒ `nudo:module-missing`（error）。 */
const MISSING_MODULE = `import { missing } from "./missing.js";
export function call(a) {
  return missing(a);
}
`;

/** warning 级分析诊断：模块环 ⇒ `nudo:module-cycle`（warning）。 */
const CYCLE_A = `import { b } from "./b.js";
export function a() { return b(); }
`;
const CYCLE_B = `import { a } from "./a.js";
export function b() { return a(); }
`;

describe("BUG-014 — `nudo test` 的 error 级分析诊断必须挡退出码", () => {
  it("module-missing（error）⇒ exit 1 且诊断上屏", () => {
    const dir = project({ "m.js": MISSING_MODULE });
    try {
      const r = runCliTsx(["test", join(dir, "m.js")]);
      expect(r.status).toBe(1);
      expect(r.stdout).toContain("[error]");
      expect(r.stdout).toContain("nudo:module-missing");
    } finally {
      cleanup(dir);
    }
  });

  it("--json：ok=false 且 summary.errors 反映 error 计数", () => {
    const dir = project({ "m.js": MISSING_MODULE });
    try {
      const r = runCliTsx(["test", join(dir, "m.js"), "--json"]);
      expect(r.status).toBe(1);
      const json = JSON.parse(r.stdout) as {
        ok?: boolean;
        summary?: { errors?: number };
      };
      expect(json.ok).toBe(false);
      expect(json.summary?.errors ?? 0).toBeGreaterThanOrEqual(1);
    } finally {
      cleanup(dir);
    }
  });

  it("干净文件：ok=true、errors=0、exit 0", () => {
    const dir = project({ "ok.js": CLEAN });
    try {
      const r = runCliTsx(["test", join(dir, "ok.js"), "--json"]);
      expect(r.status).toBe(0);
      const json = JSON.parse(r.stdout) as {
        ok?: boolean;
        summary?: { errors?: number };
      };
      expect(json.ok).toBe(true);
      expect(json.summary?.errors).toBe(0);
    } finally {
      cleanup(dir);
    }
  });

  it("warning 级诊断（模块环）不得把 test 判红", () => {
    const dir = project({ "a.js": CYCLE_A, "b.js": CYCLE_B });
    try {
      const r = runCliTsx(["test", join(dir, "a.js")]);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("nudo:module-cycle");
    } finally {
      cleanup(dir);
    }
  });
});
