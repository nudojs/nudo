/**
 * BUG-234（协议面）—— `nudo migrate strip` 对 **enum 的计算成员**原样保留初始化
 * 表达式 ⇒ 产物引用**未绑定全局** ⇒ 运行时 ReferenceError；而 strip 的 note
 * 还宣称「TS enum semantics kept」。
 *
 * 本文件是**运行期**回归钉（`cli-bug-913` 只钉「产物可解析」，没钉「跑得起来」）：
 * 四种 enum 形态（数值 / 混合 / 字符串 / const）的 strip 产物都必须在宿主里
 * 跑出与 tsc 一致的结果。
 *
 * 反向闸：产物的计算成员里不得再出现裸成员标识符（`A * 10`），必须是
 * `E[\"A\"] * 10`——这正是 ReferenceError 的唯一来源。
 */
import { describe, it, expect, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripTsToJs } from "../migrate.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function runStrip(source: string): { code: string; notes: string[] } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-mig-234-"));
  dirs.push(dir);
  const file = join(dir, "enum.ts");
  writeFileSync(file, source, "utf-8");
  return stripTsToJs(source, { filePath: file });
}

/** 把产物写进临时 `.mjs` 并**真的**用 node 跑它 */
function runProduct(code: string): { stdout: string; status: number } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-mig-234-run-"));
  dirs.push(dir);
  const file = join(dir, "product.mjs");
  writeFileSync(file, code, "utf-8");
  try {
    const stdout = execFileSync(process.execPath, [file], {
      encoding: "utf-8",
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
    });
    return { stdout: stdout.trim(), status: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return { stdout: `${e.stdout ?? ""}${e.stderr ?? ""}`.trim(), status: e.status ?? 1 };
  }
}

describe("Bug 234: enum 计算成员的 strip 产物必须能在宿主里跑", () => {
  it("数值 enum：`A = 1, B = A * 10, C` ⇒ [1,10,11]", () => {
    const { code } = runStrip(
      "export enum E { A = 1, B = A * 10, C }\nconsole.log(JSON.stringify([E.A, E.B, E.C]));\n",
    );
    // 反向闸：计算成员里不得再有裸 `A`
    expect(code).not.toMatch(/E\[E\["B"\] = A \*/);
    expect(code).toMatch(/E\[E\["B"\] = E\["A"\] \*/);
    const run = runProduct(code);
    expect(run.stdout).not.toContain("ReferenceError");
    expect(run.status).toBe(0);
    expect(run.stdout).toBe("[1,10,11]");
  });

  it("混合 enum：`A = 1, B = 'b', C = A + 5` ⇒ [1,\"b\",6]", () => {
    const { code } = runStrip(
      "export enum E { A = 1, B = 'b', C = A + 5 }\nconsole.log(JSON.stringify([E.A, E.B, E.C]));\n",
    );
    const run = runProduct(code);
    expect(run.status).toBe(0);
    expect(run.stdout).toBe('[1,"b",6]');
  });

  it("字符串 enum：`A = 'a', B = A + 'b'` ⇒ [\"a\",\"ab\"] 且不建反向映射", () => {
    const { code } = runStrip(
      "export enum E { A = 'a', B = A + 'b' }\nconsole.log(JSON.stringify([E.A, E.B]));\n",
    );
    const run = runProduct(code);
    expect(run.status).toBe(0);
    expect(run.stdout).toBe('["a","ab"]');
    // tsc 口径：字符串成员**不**建反向映射
    expect(code).not.toMatch(/E\[E\["B"\] =/);
  });

  it("const enum：`A = 1, B = A * 3` ⇒ [1,3]", () => {
    const { code } = runStrip(
      "export const enum E { A = 1, B = A * 3 }\nconsole.log(JSON.stringify([E.A, E.B]));\n",
    );
    const run = runProduct(code);
    expect(run.status).toBe(0);
    expect(run.stdout).toBe("[1,3]");
  });

  it("strip 的 note 仍声明语义已保住（现在与事实一致）", () => {
    const { notes } = runStrip("export enum E { A = 1, B = A * 10 }\n");
    expect(notes.join("\n")).toContain("TS enum semantics kept");
  });

  it("反向闸：无计算成员的 enum 产物不变（不引入多余改写）", () => {
    const { code } = runStrip(
      "export enum E { A = 1, B }\nconsole.log(JSON.stringify([E.A, E.B, E[1]]));\n",
    );
    expect(code).toContain('E[E["A"] = 1] = "A"');
    expect(code).toContain('E[E["B"] = 2] = "B"');
    const run = runProduct(code);
    expect(run.stdout).toBe('[1,2,"A"]');
  });
});
