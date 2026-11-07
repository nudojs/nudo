/**
 * BUG-050 —— `nudo migrate strip --write` 写出 **Node 无法解析** 的 `.js`
 * 且 exit 0（非 `declare` 的 `namespace` / `import x = require(…)`）。
 *
 * 根因：命令层的 TS-only 构造清单（`tsOnlyConstructs`）**没有**
 * `TSModuleDeclaration` / `TSImportEqualsDeclaration`，而 core 的剥除器刻意
 * 保留这两个节点（运行时语义 / 「已知不处理」清单）⇒ 门禁永不命中 ⇒
 * 写盘 + exit 0。
 *
 * 期望（`commands/migrate.ts` 文件头的自述）：写盘**之前**检出「剥完仍有
 * TS-only 语法」的目标并**拒绝写盘** + 响亮报错（migrate 是一程闸门）。
 *
 * 反向闸：只含普通类型的 `.ts` 照常写盘（断言非永真）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function dirWith(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-mig-050-"));
  dirs.push(dir);
  writeFileSync(join(dir, "package.json"), '{ "name": "b050", "type": "module" }\n', "utf-8");
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, "utf-8");
  }
  return dir;
}

const NS = `export namespace Helpers {
  export const twice = (n: number): number => n * 2;
}
`;

const IMPORT_EQUALS = `import fs = require("node:fs");
export const readFile = (p: string): string => fs.readFileSync(p, "utf-8");
`;

describe("Bug 050: strip 不得写出仍是 TS 语法的 .js", () => {
  it("非 declare 的 namespace ⇒ 拒绝写盘 + exit 1", () => {
    const dir = dirWith({ "ns.ts": NS });
    const r = runCliTsx(["migrate", "strip", "--write", dir]);
    expect(r.status).toBe(1);
    expect(`${r.stdout}${r.stderr}`).toContain("namespace");
    // 一程闸门：产物**不得**落盘
    expect(existsSync(join(dir, "ns.js"))).toBe(false);
    expect(readFileSync(join(dir, "ns.ts"), "utf-8")).toBe(NS);
  });

  it("`import x = require(…)` ⇒ 拒绝写盘 + exit 1（且提示里点名该构造）", () => {
    const dir = dirWith({ "ie.ts": IMPORT_EQUALS });
    const r = runCliTsx(["migrate", "strip", "--write", dir]);
    expect(r.status).toBe(1);
    expect(`${r.stdout}${r.stderr}`).toContain("import x = require");
    expect(existsSync(join(dir, "ie.js"))).toBe(false);
  });

  it("--json 面同样是合法失败信封（pathErrors 带文件名）", () => {
    const dir = dirWith({ "ns.ts": NS });
    const r = runCliTsx(["migrate", "strip", "--write", "--json", dir]);
    expect(r.status).toBe(1);
    // BUG-017：`--json` 顶层形状恒为数组（信封是单元素数组）
    const __env = JSON.parse(r.stdout) as Array<{
      ok?: boolean;
      pathErrors?: Array<{ path: string; message: string }>;
    }>;
    const parsed = __env[0]!;
    expect(parsed.ok).toBe(false);
    expect(parsed.pathErrors?.length ?? 0).toBe(1);
    expect(parsed.pathErrors?.[0]?.path).toContain("ns.ts");
  });

  it("反向闸：纯类型剥除照常写盘（门禁不得误伤）", () => {
    const dir = dirWith({ "ok.ts": "export const twice = (n: number): number => n * 2;\n" });
    const r = runCliTsx(["migrate", "strip", "--write", dir]);
    expect(r.status, r.stderr).toBe(0);
    expect(existsSync(join(dir, "ok.js"))).toBe(true);
    expect(readFileSync(join(dir, "ok.js"), "utf-8")).toContain("n * 2");
  });
});
