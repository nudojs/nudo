/**
 * 标准库模块可被 tsx 直接求值：validate 语义与 validateSchemaNode 对齐。
 * （从 export 产物路径走 CLI 冒烟，不依赖 dist。）
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const cliEntry = fileURLToPath(new URL("../index.ts", import.meta.url));

function runCli(args: string[]): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(
    process.execPath,
    [join(repoRoot, "node_modules/tsx/dist/cli.mjs"), cliEntry, ...args],
    { cwd: repoRoot, encoding: "utf-8", env: { ...process.env, NO_COLOR: "1", GITHUB_ACTIONS: "false" } },
  );
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status ?? 1 };
}

describe("export --format standard module is loadable", () => {
  it("generated module validate rejects bad output under contract", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-standard-load-"));
    writeFileSync(
      join(dir, "math.js"),
      `export function clampPos(x) {\n  return x > 0 ? x : 0;\n}\nclampPos(5);\n`,
      "utf-8",
    );
    // 侧车：x > 0 → 调用点 5 合法；输出仍可能是 number
    writeFileSync(
      join(dir, "math.nudo.js"),
      `import { number, fn } from "@nudojs/core";\nexport const clampPos = fn({ x: number().gt(0) }, number());\n`,
      "utf-8",
    );
    const out = join(dir, "out");
    const r = runCli(["export", join(dir, "math.js"), "--format", "standard", "--out", out]);
    expect(r.status).toBe(0);
    const modPath = join(out, "clampPos.nudo.standard.ts");
    const body = readFileSync(modPath, "utf-8");
    expect(body).toContain("~standard");
    // Arg0 应带 gt(0) refinement JSON
    expect(body).toContain('"gt"');

    // 动态 import 生成的 ts（tsx 可跑）
    const mod = await import(pathToFileURL(modPath).href);
    // 契约参数位：clampPos_x 应表达 number().gt(0)，而不是 call@ 的 lit 5
    const arg0 = mod.clampPos_x as {
      "~standard": { validate: (v: unknown) => { value?: unknown; issues?: Array<{ message?: string }> } };
    };
    expect(arg0).toBeDefined();
    expect(arg0["~standard"].validate(1).issues).toBeUndefined();
    const bad = arg0["~standard"].validate(0);
    expect(bad.issues?.length).toBeGreaterThan(0);
    expect(String(bad.issues?.[0]?.message ?? bad.issues)).toContain("gt 0");
  });

  it("literal contract projects as lit validator (not bare number)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-standard-lit-"));
    writeFileSync(
      join(dir, "pin.js"),
      `export function pin(x) {\n  return x;\n}\npin(42);\n`,
      "utf-8",
    );
    writeFileSync(
      join(dir, "pin.nudo.js"),
      `import { lit, fn } from "@nudojs/core";\nexport const pin = fn({ x: lit(42) }, lit(42));\n`,
      "utf-8",
    );
    const out = join(dir, "out");
    const r = runCli(["export", join(dir, "pin.js"), "--format", "standard", "--out", out]);
    expect(r.status).toBe(0);
    const body = readFileSync(join(out, "pin.nudo.standard.ts"), "utf-8");
    expect(body).toContain("pin_x");
    expect(body).toContain('"k":"lit"');
    const mod = await import(pathToFileURL(join(out, "pin.nudo.standard.ts")).href);
    const pinX = mod.pin_x as {
      "~standard": { validate: (v: unknown) => { value?: unknown; issues?: Array<{ message?: string }> } };
    };
    expect(pinX["~standard"].validate(42).issues).toBeUndefined();
    expect(pinX["~standard"].validate(0).issues?.length).toBeGreaterThan(0);
  });
});
