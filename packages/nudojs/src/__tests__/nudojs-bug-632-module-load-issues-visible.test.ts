/**
 * Bug 632 —— `nudo check` **从不报告模块装载问题族**
 * （`nudo:module-missing` / `nudo:missing-export` / `nudo:module-cycle` /
 * `nudo:module-depth`）：依赖解析失败的源文件**门禁绿灯、exit 0**。
 *
 * 根因：模块图装载问题（service `composeEvalModules` → `pushBModuleIssues`）
 * 只走**分析器诊断通道**；core `checkSource` 不装载依赖模块图 ⇒ 这些事实
 * 在 check 面完全没有出口。`domainIssuesFromDiagnostics` 的白名单此前**只**
 * 留 interface 家族两码 ⇒ 分析器产出的 module 族诊断被整条丢弃
 * ⇒ 「依赖解析失败」在 CI 门禁上不可见（fail-open）。
 *
 * 钉：
 * - 依赖文件缺失 ⇒ `nudo:module-missing` 上屏（error）+ **exit 1**（门禁红）；
 * - 依赖文件存在但缺导出 ⇒ `nudo:missing-export` 上屏（error）+ **exit 1**；
 * - `--json` 面同码同 severity（JSON 契约面不得比人面更弱）。
 *
 * 回归方向：把 `packages/nudojs/src/check-json-map.ts` 的
 * `CHECK_FACE_DIAG_CODES` 退回「只有 interface 家族两码」⇒ 本钉大面积失败。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliNode as runCli } from "./helpers/run-cli.ts";

/** 最小 ESM 工程（type=module ⇒ .js 走 ESM 解析）。 */
function writeProject(dir: string, name: string): void {
  writeFileSync(
    join(dir, "package.json"),
    `{ "name": "${name}", "version": "1.0.0", "type": "module" }`,
    "utf-8",
  );
}

/** 从 `--json` 面解析出 issues（人面与 JSON 面必须同码同 severity）。 */
function jsonIssues(stdout: string): Array<{ severity: string; code: string; message: string }> {
  const parsed = JSON.parse(stdout) as {
    issues?: Array<{ severity: string; code: string; message: string }>;
  };
  return parsed.issues ?? [];
}

describe("check — 模块装载问题族上屏（Bug 632）", () => {
  it("依赖文件缺失 ⇒ nudo:module-missing 上屏 + 门禁红（exit 1）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug632-missing-"));
    writeProject(dir, "b632-missing");
    writeFileSync(
      join(dir, "a.js"),
      `import { nope } from "./does-not-exist.js";\nexport function f() { return nope; }\n`,
      "utf-8",
    );

    const r = runCli(["check", join(dir, "a.js")]);
    const out = r.stdout + r.stderr;
    // 人面：诊断码以 "(nudo:xxx)" 形式出现（docs 深链不是这个形态）
    expect(out).toContain("(nudo:module-missing)");
    // 门禁红（此前是 OK / exit 0）
    expect(r.status).toBe(1);
  });

  it("依赖文件存在但缺导出 ⇒ nudo:missing-export 上屏 + 门禁红（exit 1）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug632-export-"));
    writeProject(dir, "b632-export");
    writeFileSync(join(dir, "exists.js"), `export function g() { return 1; }\n`, "utf-8");
    writeFileSync(
      join(dir, "a.js"),
      `import { nope } from "./exists.js";\nexport function f() { return nope; }\n`,
      "utf-8",
    );

    const r = runCli(["check", join(dir, "a.js")]);
    const out = r.stdout + r.stderr;
    expect(out).toContain("(nudo:missing-export)");
    expect(r.status).toBe(1);
  });

  it("--json 面同码同 severity（error）且 ok=false", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug632-json-"));
    writeProject(dir, "b632-json");
    writeFileSync(
      join(dir, "a.js"),
      `import { nope } from "./does-not-exist.js";\nexport function f() { return nope; }\n`,
      "utf-8",
    );

    const r = runCli(["check", join(dir, "a.js"), "--json"]);
    const issues = jsonIssues(r.stdout);
    const hit = issues.find((i) => i.code === "nudo:module-missing");
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe("error");
    expect(r.status).toBe(1);
  });

  it("不双报：mock 文件缺失（mock 通道 + 模块图通道同码同文）只报一条", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug632-dup-"));
    writeProject(dir, "b632-dup");
    writeFileSync(
      join(dir, "a.js"),
      `// @nudo:mock fs from "./definitely-missing-mock-file.js"\nexport function useFs() {\n  return 1;\n}\n`,
      "utf-8",
    );

    const r = runCli(["check", join(dir, "a.js"), "--json"]);
    const issues = jsonIssues(r.stdout);
    const missing = issues.filter((i) => i.code === "nudo:module-missing");
    expect(missing.length).toBe(1);
    expect(missing[0].severity).toBe("error");
  });
});
