/**
 * BUG-226 —— `nudo migrate verify` 的注入装配器仍用**对象展开**合并 env 模块
 * （而非 `mergeHarvestUnderEnv`）⇒ 手工 env 与 harvest **同名模块**时，harvest
 * 独有的导出被**整体丢弃** ⇒ 同一文件同一配置，verify 报 `unknown` + 误导性
 * `nudo:unknown-inference`，而 `nudo check` 报精确类型。
 *
 * 引擎自己的策略（两个面都打印同一条诊断）：
 * 「handwritten @nudo:env wins over harvest on module "util" — export(s) format;
 *  **harvest only fills missing slots (B8)**」——`onlyHarvest` 正是那个空位。
 *
 * 修复：改用 `mergeHarvestUnderEnv(graph.modules, envMods)`（与
 * `commands/check.ts` 的 Bug 1037 同源）。
 *
 * 判据 = **跨动词一致性**（报告自述：「同一文件 `nudo check` 与
 * `nudo migrate verify` 的诊断码集合必须相同、签名文本必须相同」）。
 *
 * 反向闸：`nudo check` 自己的签名必须是精确的 `harvested() => string`
 * （否则「两面一致」可能只是两面都错）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateVerify } from "../migrate.ts";
import { runCliTsx } from "./helpers/run-cli.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function project(): string {
  const root = mkdtempSync(join(tmpdir(), "nudo-mig-226-"));
  dirs.push(root);
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name: "p12", version: "1.0.0", type: "module" }),
    "utf-8",
  );
  // harvest 来源：一个**自带 .d.ts** 的假包，模块名与 node env 的 `util` 同名
  const mod = join(root, "node_modules", "util");
  mkdirSync(mod, { recursive: true });
  writeFileSync(
    join(mod, "package.json"),
    JSON.stringify({ name: "util", version: "1.0.0", types: "index.d.ts" }),
    "utf-8",
  );
  writeFileSync(
    join(mod, "index.d.ts"),
    "export declare function onlyHarvest(a: string): string;\nexport declare function format(...args: unknown[]): string;\n",
    "utf-8",
  );
  writeFileSync(join(mod, "index.js"), "module.exports = { onlyHarvest: (a) => a };\n", "utf-8");
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(
    join(root, "src", "app.js"),
    [
      "/// @nudo:env node",
      'import { onlyHarvest } from "util";',
      "",
      "export function harvested() {",
      '  return onlyHarvest("x");',
      "}",
      "",
    ].join("\n"),
    "utf-8",
  );
  return root;
}

/**
 * 从人类面输出里取「error / warning / fn」三元组（check 面会多一段 `N info`
 * ——统计口径只比这三项，与 `migrateVerify` 的 `nudoSummary` 同量纲）。
 */
function summaryOf(stdout: string): string | undefined {
  const m = /(\d+) error · (\d+) warning ·(?:\s*\d+ info ·)?\s*(\d+) fn/.exec(stdout);
  return m ? `${m[1]} error · ${m[2]} warning · ${m[3]} fn` : undefined;
}

describe("Bug 226: verify 的 env/harvest 合并必须走 B8（harvest 填空位）", () => {
  it("nudo check 的签名是精确类型（反向闸：前提成立）", () => {
    const root = project();
    const check = runCliTsx(["check", join(root, "src", "app.js")]);
    expect(check.status, check.stderr).toBe(0);
    expect(check.stdout).toContain("harvested() => string");
    expect(summaryOf(check.stdout)).toBe("0 error · 1 warning · 1 fn");
    // 反向闸：check 面的签名里不得出现 `unknown`（那才是「harvest 空位被丢」的症状）
    expect(check.stdout).not.toContain("harvested() => unknown");
  });

  it("verify 与 check 的诊断统计一致（不再多出 unknown-inference）", async () => {
    const root = project();
    const check = runCliTsx(["check", join(root, "src", "app.js")]);
    const rows = await migrateVerify([join(root, "src", "app.js")], { json: true, root });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.nudoOk).toBe(true);
    expect(rows[0]!.nudoSummary).toBe(summaryOf(check.stdout));
  });
});
