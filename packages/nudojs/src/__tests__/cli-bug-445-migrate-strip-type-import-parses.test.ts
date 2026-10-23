/**
 * Bug 445 —— 值位置的「类型专用导入」未消除 ⇒ 产物 Node **加载不了**
 * （ESM 链接期 `SyntaxError: does not provide an export named 'Foo'`），
 * 而 `migrate strip` / `migrate verify` 双双绿灯。
 *
 * **真源**：`packages/core/src/strip-types.ts`（值位置引用收集 ⇒ 与 tsc 的
 * import elision 同口径）。本钉是**产物面**的回归钉：产物必须能被 Node
 * **真实加载**（`node --check` 只验语法、抓不到本条的链接失败）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const TYPES_TS = `export interface Foo { id: string; }
`;
const USE_TS = `import { Foo } from "./types.js";
export function use(f: Foo): string { return "ok"; }
`;

/** node --check（语法检查，不执行） */
function nodeCheck(path: string): { status: number; stderr: string } {
  const r = spawnSync(process.execPath, ["--check", path], { encoding: "utf-8" });
  return { status: r.status ?? 1, stderr: r.stderr ?? "" };
}

/** 真 ESM 加载（链接期检查 —— `node --check` 抓不到这一层） */
function esmLoad(path: string): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import(${JSON.stringify(`file://${path}`)}).then(()=>console.log("LOAD OK")).catch(e=>{console.log("LOAD ERROR:", e.constructor.name+":", e.message); process.exitCode=1;});`,
    ],
    { encoding: "utf-8" },
  );
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

describe("Bug 445 —— strip 产物不得残留「值位置的类型专用导入」（产物可加载）", () => {
  it("类型专用的值位置 import 被消掉 ⇒ 产物 `node --check` 过且真 import() 成功", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-cli-bug-445-"));
    dirs.push(dir);
    writeFileSync(join(dir, "types.ts"), TYPES_TS, "utf-8");
    writeFileSync(join(dir, "use.ts"), USE_TS, "utf-8");

    const r = runCliTsx(["migrate", "strip", "--write", "--no-draft", dir]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).not.toContain("TypeScript syntax");

    const product = join(dir, "use.js");
    expect(existsSync(product)).toBe(true);
    const code = readFileSync(product, "utf-8");
    // 类型专用的绑定不得留在产物里（tsc 的 import elision 同口径）
    expect(code).not.toContain("Foo");
    expect(code).not.toContain("types.js");

    const check = nodeCheck(product);
    expect(check.status, `${product}\n${check.stderr}`).toBe(0);

    // 核心证据：**真加载**（被 import 的模块被剥成空模块 ⇒ 链接期 SyntaxError）
    const load = esmLoad(product);
    expect(load.status, `${load.stdout}\n${load.stderr}`).toBe(0);
    expect(load.stdout).toContain("LOAD OK");
  });

  it("产物里的 import 不得指向「没有该运行时导出」的模块（链接面）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-cli-bug-445b-"));
    dirs.push(dir);
    writeFileSync(join(dir, "types.ts"), TYPES_TS, "utf-8");
    writeFileSync(join(dir, "use.ts"), USE_TS, "utf-8");

    const r = runCliTsx(["migrate", "strip", "--write", "--no-draft", dir]);
    expect(r.status, r.stderr).toBe(0);
    // 被 import 的模块剥成空模块 ⇒ 任何残留的具名 import 都会链接失败
    const types = readFileSync(join(dir, "types.js"), "utf-8");
    expect(types.trim()).toBe("");
    const use = readFileSync(join(dir, "use.js"), "utf-8");
    expect(use).not.toMatch(/import\s/);
  });
});
