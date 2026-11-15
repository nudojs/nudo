/**
 * Bug 623 — 产物面把「函数名 → 校验器」建成**以函数名为键**的映射 ⇒ 同名
 * 函数后者覆盖前者；standard 面则把**同一个文件写两次**（后者静默覆盖前者，
 * CLI 零告警）。
 *
 * 钉（写盘面）：同一个类里两个同名方法 ⇒ standard 产物**两份都在**
 * （`C.m.nudo.standard.ts` + `C.m.2.nudo.standard.ts`），先写的那份不被覆盖。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliNode as runCli } from "./helpers/run-cli.ts";

const DUP = `export class C {
  /**
   * @nudo:case "m1" (1) => 2
   */
  m(a) { return a + 1; }
  /**
   * @nudo:case "m2" (3) => 4
   */
  m(b) { return b + 2; }
}
`;

describe("nudo export --out · Bug 623 · 同名函数的产物不互相覆盖", () => {
  it("同一文件里两个同名方法 ⇒ 两份 standard 产物都在", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug-623-"));
    const file = join(dir, "lib.js");
    writeFileSync(file, DUP, "utf-8");
    const out = join(dir, "out");

    const r = runCli(["export", file, "--format", "standard", "--out", out]);
    expect(r.status).toBe(0);
    const files = readdirSync(out).filter((f) => f.endsWith(".nudo.standard.ts"));
    // 两个同名方法 ⇒ 两份产物（不是同一个文件写两次）
    expect(files).toHaveLength(2);
    expect(files).toContain("C.m.nudo.standard.ts");
    // 两份内容不同（各带自己那条 case 的见证）
    const bodies = files.map((f) => readFileSync(join(out, f), "utf-8"));
    expect(bodies[0]).not.toBe(bodies[1]);
    // 两行 wrote ⇒ 两个不同路径（不是同一路径写两次）
    const wrote = r.stdout.split("\n").filter((l) => l.startsWith("wrote "));
    expect(wrote).toHaveLength(2);
    expect(new Set(wrote).size).toBe(2);
  }, 60000); // 1 个 CLI 子进程（tsx 冷启动）
});
