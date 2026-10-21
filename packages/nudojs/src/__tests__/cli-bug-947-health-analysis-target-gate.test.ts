/**
 * Bug 947 — `nudo health` **不设「分析目标」闸门** ⇒ 把 `.d.ts` / 侧车 / `.jsx`
 * 当成**已检查的源文件**并报「Result: OK」（exit 0），而 `nudo check` /
 * `nudo test` 对**同一路径** exit 1「Not an analysis target」⇒ 假绿 + 跨动词
 * 自相矛盾。
 *
 * 口径：health 的目标解析与 check / test **同口径**（`isNudoTargetPath` 闸门 +
 * 同款 pathNotTarget 错误：同样的 message / suggestion）。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

let dir: string;
const p = (f: string) => join(dir, f);

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-bug-947-"));
  writeFileSync(p("types.d.ts"), "export declare function g(x: number): number;\n");
  writeFileSync(p("sidecar.nudo.js"), "export const g = fn({ x: number() }, number());\n");
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("Bug 947: health 必须与分析目标闸门同口径", () => {
  it("文本面：.d.ts 目标 ⇒ exit 1 + Not an analysis target（不得 Result: OK）", { timeout: 60_000 }, () => {
    const r = runCliTsx(["health", p("types.d.ts")]);
    expect(r.status).toBe(1);
    expect(r.stdout).not.toContain("Result: OK");
    expect(r.stderr).toContain("Not an analysis target");
    expect(r.stderr).toContain("fix:");
  });

  it("侧车（*.nudo.js）同样不是分析目标 ⇒ 判红", { timeout: 60_000 }, () => {
    const r = runCliTsx(["health", p("sidecar.nudo.js")]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Not an analysis target");
  });

  it("--json 面：ok:false + pathErrors[0].code == nudo:path-not-target", { timeout: 60_000 }, () => {
    const r = runCliTsx(["health", "--json", p("types.d.ts")]);
    const parsed = JSON.parse(r.stdout) as {
      ok: boolean;
      files: unknown[];
      pathErrors?: Array<{ code: string; message: string; suggestion: string }>;
    };
    expect(parsed.ok).toBe(false);
    expect(r.status).toBe(1);
    expect(parsed.files).toEqual([]);
    expect(parsed.pathErrors?.length ?? 0).toBe(1);
    expect(parsed.pathErrors?.[0].code).toBe("nudo:path-not-target");
    expect(parsed.pathErrors?.[0].suggestion).toContain(".js/.mjs/.ts");
  });

  it("跨动词同口径：check / test 对同一路径报同一款错误", { timeout: 60_000 }, () => {
    const check = runCliTsx(["check", p("types.d.ts")]);
    const health = runCliTsx(["health", p("types.d.ts")]);
    expect(check.status).toBe(1);
    expect(health.status).toBe(check.status);
    expect(health.stderr).toContain("Not an analysis target");
    expect(check.stderr).toContain("Not an analysis target");
  });
});
