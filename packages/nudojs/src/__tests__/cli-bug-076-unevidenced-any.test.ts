/**
 * BUG-076 —— `nudo export --format dts` 的**无证据参数**口径（文档 vs 实现矛盾）。
 *
 * 两处文档（`docs/design/cli-semantics.md` §2「已记录例外」+ 导出指南 en/zh
 * 的第 114 / 185 行）承诺：未被观测的 export 参数渲染为 **`unknown`**，并在
 * stderr 打一行**点名提示**（三条补证据路径）。
 *
 * 实测口径（本轮取证，且与 `packages/website/docs/concepts/abs.md:100`
 * 「unconstrained entry parameters display as `any`, never as `unknown`」、
 * 本包 `export-dts-evidence.test.ts` 的 Bug 544 钉法一致）：
 * ① **主路径**（普通导出函数，无论完全无证据还是契约未覆盖某位）⇒ 参数
 *    渲染 **`any`**，stderr **没有** `rendered as unknown` 提示；
 * ② **窄路径**（`@nudo:skip` / 无 case 函数 **且** 手写契约参数位存在
 *    ⇒ `contractOnlySignature`）⇒ 契约**未覆盖**的形参渲染 **`unknown`**，
 *    stderr 出 `note: <fn>.<param> rendered as unknown …` 一行。
 *
 * ⇒ 「提示通道」不是死代码，只是**只覆盖窄路径**。本文件钉住这条现状：
 * 口径若变更（改文档而不改代码 = 现状；改代码兑现承诺 = 两种形状都会变），
 * 这条回归会先亮红灯。
 *
 * ⚠ 夹具里写 `writeSrcTsconfig`：CLI 子进程按 cwd 找 tsconfig，否则落到
 * `<pkg>/dist` 的旧构建 ⇒ 断言会测到陈旧实现。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx as runCli, writeSrcTsconfig } from "./helpers/run-cli.ts";

function fixtureDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-076-"));
  writeSrcTsconfig(dir);
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, "utf-8");
  }
  return dir;
}

describe("export --format dts · BUG-076 · 无证据参数的既定口径", () => {
  it("主路径：完全无证据的导出函数 ⇒ 参数 any，stderr 无 unknown 提示", () => {
    const dir = fixtureDir({
      "noev.js": `export function neverCalled(a, b) {\n  return a + b;\n}\n`,
    });

    const r = runCli(["export", "noev.js", "--format", "dts"], { cwd: dir });

    expect(r.status, r.stdout + r.stderr).toBe(0);
    // Abs `any`（未约束）⇒ TS any（abs.md:100 / Bug 544），不是 unknown
    expect(r.stdout).toContain("export declare function neverCalled(a: any, b: any)");
    expect(r.stdout).toContain("@param a - any");
    expect(r.stdout).not.toContain("unknown");
    // 主路径上「无名提示」是现状：既没有 unknown，也不该凭空造一条提示
    expect(r.stderr).not.toContain("rendered as unknown");
  }, 30000);

  it("主路径：契约只覆盖部分形参时，未覆盖位同样是 any（不是 unknown）", () => {
    const dir = fixtureDir({
      "std.nudo.js": `import { number } from "@nudojs/core";\nexport const positive = number().gt(0);\n`,
      "partial.js": `export function partialFn(a, b) {\n  return a + b;\n}\n`,
      "partial.nudo.js": `import { number } from "@nudojs/core";\nexport const partialFn = fn({ a: number() }, number());\n`,
    });

    const r = runCli(["export", "partial.js", "--format", "dts"], { cwd: dir });

    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toContain("export declare function partialFn(a: number, b: any)");
    expect(r.stdout).not.toContain("b: unknown");
    expect(r.stderr).not.toContain("rendered as unknown");
  }, 30000);

  it("窄路径：@nudo:skip + 契约未覆盖的形参 ⇒ 该位 unknown + stderr 点名提示", () => {
    const dir = fixtureDir({
      "std.nudo.js": `import { number } from "@nudojs/core";\nexport const positive = number().gt(0);\n`,
      "skipped.js": [
        `/// @nudo:import { positive } from "./std.nudo.js"`,
        `/**`,
        ` * @nudo:skip`,
        ` * @nudo:contract a positive`,
        ` */`,
        `export function sk3(a, b) {`,
        `  return a + b;`,
        `}`,
        ``,
      ].join("\n"),
    });

    const r = runCli(["export", "skipped.js", "--format", "dts"], { cwd: dir });

    expect(r.status, r.stdout + r.stderr).toBe(0);
    // 契约位具名投影；未覆盖位 = unknown（contractOnlySignature 的兜底）
    expect(r.stdout).toContain("export declare function sk3(a: number, b: unknown)");
    // 提示点名到 `fn.param`，并给出三条补证据路径
    expect(r.stderr).toContain("note: sk3.b rendered as unknown");
    expect(r.stderr).toContain("*.nudo.js");
    expect(r.stderr).toContain("@nudo:contract");
    expect(r.stderr).toContain("@nudo:case");
  }, 30000);
});
