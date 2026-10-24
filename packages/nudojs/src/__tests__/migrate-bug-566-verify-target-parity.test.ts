/**
 * Bug 566 — `nudo migrate verify` 把 sidecar 与 `.d.ts` 当源码分析，与 `nudo check` 判定分叉。
 *
 * 根因：verify 自行按扩展名收文件（.js/.mjs/.cjs/.ts/.tsx），没走 `nudo check` 的
 * `isNudoTargetPath`（`packages/service/src/target-path.ts`）——后者显式排除
 * `.d.ts`（声明文件，不是可求值实现）与 `*.nudo.js`（侧车契约模块）。
 * ⇒ 同一棵源码树：check 绿（exit 0），verify 红（exit 1），红的原因是一行
 * `.d.ts` 声明或一个侧车。
 *
 * 判据（闸②）：`migrate verify` 与 `nudo check` 对同一份代码给出**同一结论**。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-566-"));
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** 合法实现（check 面绿） */
writeFileSync(join(dir, "foo.js"), "export function foo(x) {\n  return x;\n}\n", "utf-8");
/** 侧车契约模块：不是分析目标 */
writeFileSync(join(dir, "foo.nudo.js"), "export const fooContract = {};\n", "utf-8");
/** 类型声明 + 一条真错误（旧实现下让 verify 判红） */
writeFileSync(
  join(dir, "types.d.ts"),
  "export declare function foo(x: number): string;\nexport function broken(u) {\n  return u.name;\n}\n",
  "utf-8",
);

describe("migrate verify — 文件发现与 nudo check 同口径（Bug 566）", () => {
  it("目录扫描不把 sidecar / .d.ts 当源码：verify 与 check 同绿", { timeout: 120_000 }, () => {
    const check = runCliTsx(["check", dir]);
    expect(check.status).toBe(0);

    const verify = runCliTsx(["migrate", "verify", dir]);
    // 旧行为：verify 扫到 types.d.ts → 判红 exit 1（比 check 更严）
    expect(verify.status).toBe(0);
    expect(verify.stdout).toContain("foo.js");
    expect(verify.stdout).not.toContain("foo.nudo.js");
    expect(verify.stdout).not.toContain("types.d.ts");
  });

  it("显式 .d.ts 目标与 check 一样被拒（不当源码分析）", { timeout: 120_000 }, () => {
    const decl = join(dir, "types.d.ts");
    const check = runCliTsx(["check", decl]);
    expect(check.status).toBe(1);

    const verify = runCliTsx(["migrate", "verify", decl]);
    expect(verify.status).toBe(1);
    expect(verify.stdout + verify.stderr).toContain("Not an analysis target");
  });
});
