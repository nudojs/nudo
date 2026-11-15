/**
 * Bug 405 —— `nudo check --what-if --target <函数名>` 把函数的**返回域**渲染成
 * 占位符 `?`（`() => ?  #exact`）。
 *
 * 症状（改前）：
 * ```
 * $ nudo check c.js --what-if raw:string --target useRaw
 * Type of "useRaw": () => ?  #exact
 * ```
 * 而**同一份文件**的签名表里写着 `useRaw() => 3` ⇒ 两条面互相矛盾；`?` 既不是
 * 合法 TS 类型也不是 Nudo 的类型记号（对 AI/agent 消费者等于「返回域未知」）。
 *
 * 根因：`--target` 走 `result.bindings`（顶层绑定 Abs，其 fn 形状**没有**
 * `returnType`）⇒ `formatAbs` 走 fn 臂的 `?` 兜底；签名表走的是**另一条面**
 * （`result.functions` / `combinedAbs`）⇒ 同一个函数被两条面取成两个 Abs。
 *
 * 修法（族 09 · S1 · 路线 ①）：`--target` 命中**函数名** ⇒ 改从
 * `result.functions` 取该函数的 `combinedAbs`（真实返回域）补进绑定 fn 形状
 * 缺失的 `returnType` 再渲染；取不到（非函数 / 无 `combinedAbs`）才回落到
 * `result.bindings`。**不动** `formatShape` 的 `?` 兜底（`?` 是 Nudo 内部
 * 占位符，既有产物依赖它）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-405-"));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, "utf-8");
  }
  return dir;
}

const SRC = [
  `const raw = "abc";`,
  ``,
  `export const useRaw = () => raw.length;`,
  ``,
].join("\n");

describe("Bug 405 —— --what-if --target 指向函数时不再打出 `?`", () => {
  it("--target 指向函数名：返回域取自函数面（不再是 `() => ?`）", () => {
    const dir = fixture({ "w405.js": SRC });
    const r = runCliTsx([
      "check",
      join(dir, "w405.js"),
      "--what-if",
      "raw:string",
      "--target",
      "useRaw",
    ]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Type of "useRaw":');
    // 改前：`Type of "useRaw": () => ?  #exact`
    expect(r.stdout).not.toContain("=> ?");
    expect(r.stdout).toContain("() => number");
  }, 60000);

  it("两条面不再互相矛盾：--target 的返回域与签名表一致", () => {
    const dir = fixture({ "w405b.js": SRC });
    const whatIf = runCliTsx([
      "check",
      join(dir, "w405b.js"),
      "--what-if",
      "raw:string",
      "--target",
      "useRaw",
    ]);
    const table = runCliTsx(["check", join(dir, "w405b.js")]);
    expect(whatIf.status).toBe(0);
    expect(table.status).toBe(0);
    // 签名表：`useRaw() => 3`（字面量视图）
    expect(table.stdout).toContain("useRaw() =>");
    expect(table.stdout).not.toContain("=> ?");
    // --target：返回域视图（number），与签名表同属一个返回域
    expect(whatIf.stdout).toContain("() => number");
  }, 60000);

  it("控制：--target 指向非函数绑定时行为不变", () => {
    const dir = fixture({ "w405c.js": SRC });
    const r = runCliTsx([
      "check",
      join(dir, "w405c.js"),
      "--what-if",
      "raw:string",
      "--target",
      "raw",
    ]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Type of "raw": string');
    expect(r.stdout).not.toContain("=> ?");
  }, 60000);

  it("控制：--target 指向不存在的名字时仍是 unknown", () => {
    const dir = fixture({ "w405d.js": SRC });
    const r = runCliTsx([
      "check",
      join(dir, "w405d.js"),
      "--what-if",
      "raw:string",
      "--target",
      "nope",
    ]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Type of "nope": unknown');
  }, 60000);
});
