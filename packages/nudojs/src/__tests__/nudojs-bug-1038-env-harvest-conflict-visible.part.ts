/**
 * Bug 1038 —— 文档明确列为 **check 面告警**的 `nudo:env-harvest-conflict`
 * 在 `nudo check` **永不出现**：analyzer 已经产出这条 warning，check 面的
 * 诊断白名单把它整条丢掉 ⇒ 文档承诺 vs 实现冲突。
 *
 * 根因：`domainIssuesFromDiagnostics` 的白名单只留 interface 家族两码
 * ⇒ service `pushBModuleIssues` 产出的 `nudo:env-harvest-conflict`
 * （handwritten `@nudo:env` 胜出 / harvest 冲突）被静默丢弃 ⇒ 用户看不到
 * 「我手写的 @nudo:env 盖掉了 harvest」这个事实。
 *
 * 钉：`nudo check` 人面 + `--json` 面都上屏 `nudo:env-harvest-conflict`，
 * 且 severity = **warning**（告警不挡门禁 ⇒ exit 0）。
 *
 * 回归方向：把 `CHECK_FACE_DIAG_CODES` 里的 `DIAG.envHarvestConflict` 去掉
 * ⇒ 本钉大面积失败。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliNode as runCli } from "./helpers/run-cli.ts";

/**
 * 夹具：手写 `@nudo:env node` + 一个自带 @types 形态 d.ts 的 node_modules 包
 * ⇒ harvest 与手写 env 在 `format` 槽位上冲突 ⇒ 分析器产出
 * `nudo:env-harvest-conflict`（warning）。
 */
function writeHarvestConflictFixture(dir: string): void {
  writeFileSync(
    join(dir, "package.json"),
    `{ "name": "b1038", "version": "1.0.0", "type": "module" }`,
    "utf-8",
  );
  const nm = join(dir, "node_modules", "util");
  mkdirSync(nm, { recursive: true });
  writeFileSync(
    join(nm, "package.json"),
    `{ "name": "util", "version": "1.0.0", "types": "index.d.ts" }`,
    "utf-8",
  );
  writeFileSync(
    join(nm, "index.d.ts"),
    `export declare function onlyHarvest(a: string): string;\nexport declare function format(...args: unknown[]): string;\n`,
    "utf-8",
  );
  writeFileSync(
    join(nm, "index.js"),
    `module.exports = { onlyHarvest: (a) => a };\n`,
    "utf-8",
  );
  writeFileSync(
    join(dir, "lib.js"),
    `/// @nudo:env node\nimport { onlyHarvest, format } from "util";\n\nexport function harvested(a) {\n  return onlyHarvest(a);\n}\nexport function key(dir, name) {\n  return format(dir, name);\n}\n`,
    "utf-8",
  );
}

describe("check — env-harvest-conflict 上屏（Bug 1038）", () => {
  it("人面上屏 nudo:env-harvest-conflict（warning，不挡门禁）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug1038-"));
    writeHarvestConflictFixture(dir);

    const r = runCli(["check", join(dir, "lib.js")]);
    const out = r.stdout + r.stderr;
    expect(out).toContain("(nudo:env-harvest-conflict)");
    // 告警级 ⇒ 门禁不红（exit 0）
    expect(r.status).toBe(0);
  });

  it("--json 面同码同 severity（warning）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug1038-json-"));
    writeHarvestConflictFixture(dir);

    const r = runCli(["check", join(dir, "lib.js"), "--json"]);
    const parsed = JSON.parse(r.stdout) as {
      issues?: Array<{ severity: string; code: string }>;
    };
    const hit = (parsed.issues ?? []).find((i) => i.code === "nudo:env-harvest-conflict");
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe("warning");
  });
});
