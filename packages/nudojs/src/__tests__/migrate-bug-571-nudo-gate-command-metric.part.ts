/**
 * Bug 571 — `migrate status` 的「no nudo check/test script yet」是**假阻塞**：
 * 判定用脚本**名**（`/check|test/` 匹配脚本名），采集用脚本**命令**（`/\bnudo\b/`）。
 * ⇒ 命令已经是 `nudo check .` / `npx nudojs check .`、但脚本名叫 `lint` / `typecheck2`
 * 的包被报成「还没有 nudo 门禁」；retire 改写后（`npx nudojs check .`）该阻塞**永不消失**。
 *
 * 期望：门禁判定口径 = **命令文本**（`nudo check` / `npx nudojs check` / `nudo test`）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateStatus, formatStatusTable } from "../migrate.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function pkg(name: string, scripts: Record<string, string>, extra: Record<string, unknown> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "nudo-m2-571-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name, version: "1.0.0", scripts, ...extra }),
    "utf-8",
  );
  writeFileSync(join(dir, "index.ts"), "export const x = 1;\n", "utf-8");
  return dir;
}

describe("Bug 571: migrate status 的 nudo 门禁判定看命令文本，不看脚本名", () => {
  it("脚本名不含 check/test、命令是 nudo check ⇒ 不得报「no nudo check/test script yet」", () => {
    const dir = pkg("named2-pkg", { lint: "nudo check ." }, {
      devDependencies: { typescript: "^5.0.0" },
    });
    const rows = migrateStatus(dir);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.nudoScripts).toContain("lint");
    expect(rows[0]!.blockers).not.toContain("no nudo check/test script yet");
  });

  it("retire 改写后的形态 `npx nudojs check .` 同样算已有门禁（旧口径匹配不到 nudojs）", () => {
    const dir = pkg("retired-shape", { typecheck2: "npx nudojs check ." });
    const rows = migrateStatus(dir);
    expect(rows[0]!.blockers).not.toContain("no nudo check/test script yet");
  });

  it("`nudo test` 也是门禁", () => {
    const dir = pkg("test-shape", { gate: "nudo test ." });
    const rows = migrateStatus(dir);
    expect(rows[0]!.blockers).not.toContain("no nudo check/test script yet");
  });

  it("反向闸：命令里没有 nudo 门禁 ⇒ 仍必须报该阻塞（判定不是恒假）", () => {
    const dir = pkg("no-gate", { build: "tsc -p ." });
    const rows = migrateStatus(dir);
    expect(rows[0]!.blockers).toContain("no nudo check/test script yet");
  });

  it("字符串里的 nudo check 不算门禁（shell 掩码口径不变）", () => {
    const dir = pkg("quoted", { note: 'echo "please run nudo check ."' });
    const rows = migrateStatus(dir);
    expect(rows[0]!.blockers).toContain("no nudo check/test script yet");
  });

  it("文本面不再出现该假阻塞", () => {
    const dir = pkg("named2-pkg-text", { lint: "nudo check ." });
    const text = formatStatusTable(migrateStatus(dir));
    expect(text).not.toContain("no nudo check/test script yet");
  });
});
