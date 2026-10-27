/**
 * BUG-196 —— `nudo contract --emit` 的**派生分支**与**直写分支**抢同一侧车的
 * 同一段：两个写者、两种段格式 ⇒
 * ① 派生分支算出的 `// derived-from:` 溯源行**永不落盘**（被直写分支整段覆盖）；
 * ② 落盘字节不变，报告却说「Updated」（台账与文件不符）；
 * ③ `--dry-run` 预览要求加一行**真实写盘从不产生**的行 ⇒ 预览与写盘相反，
 *    `--exit-on-diff` 因此**永不收敛**（恒 exit 1 ⇒ CI 漂移门禁永远红）。
 *
 * 钉（单写者 + 同源）：
 * - 根侧车**只有 CLI 一个写者**：直写分支永远 dry-run（只算），派生分支
 *   `skipWrite` 跳过该文件；最终文本在 CLI 里一次决定、一次落盘。
 * - 段级合并：直写正文**优先**，派生分支只把 `// derived-from:` 标签行并进去。
 * - 判定 = 落盘内容 vs 写前内容（逐字）⇒ **预览 == 写盘**（字节级）。
 * - 幂等：连跑两次 `--emit --all`，第二次无 `Updated` 且 md5 不变；
 *   收敛后 `--dry-run --exit-on-diff` ⇒ exit 0。
 *
 * 夹具（与 `tmp/repro/bug-196` 同形，但测试自建临时目录 ⇒ 不读写 tmp/）：
 * `lib.js` 里 `@nudo:contract` 让 `bar` 成为 root ⇒ 派生推导点名下游导出
 * `foo`（派生段 = `fn({ a: lit(1) }, lit(2))`），而 `foo` 同时被直写分支覆盖
 * （`fn({ a: number() }, number())`）⇒ 同一段两个写者。
 *
 * ⚠ CLI 子进程的 `@nudojs/service/emit` 解析会按 **cwd** 找 tsconfig：cwd 是
 * 临时夹具 ⇒ 落到 `packages/service/dist/`（可能是旧构建，BUG-196 的语义
 * 在 service 源码里）⇒ 夹具里写一份 `writeSrcTsconfig` 钉到仓内 src。
 */
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx as runCli, writeSrcTsconfig } from "./helpers/run-cli.ts";

const LIB = `/// @nudo:import { positive } from "./std.nudo.js"
/**
 * @nudo:contract y positive
 */
export function bar(y) {
  return y * 2;
}
export function foo(a) {
  return a + 1;
}
foo(1);
`;

const STD = `import { number } from "@nudojs/core";
export const positive = number().gt(0);
`;

/** 同一段：直写分支的正文（`number()`）+ 派生分支并进来的溯源行 */
const EXPECTED_WRAP = `export const foo = fn({ a: number() }, number());`;

function makeFixture(): { dir: string; sidecar: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-196-"));
  // cwd 是夹具 ⇒ 必须钉住 @nudojs/* 的源码解析（见文件头）
  writeSrcTsconfig(dir);
  writeFileSync(join(dir, "package.json"), `{"name":"fixture","private":true}\n`, "utf-8");
  writeFileSync(join(dir, "lib.js"), LIB, "utf-8");
  writeFileSync(join(dir, "std.nudo.js"), STD, "utf-8");
  return { dir, sidecar: join(dir, "lib.nudo.js") };
}

function md5(path: string): string {
  return createHash("md5").update(readFileSync(path)).digest("hex");
}

/** 取 diff 里的新增行（去掉首列前缀）——用于「预览 == 写盘」字节比对 */
function addedLines(diff: string): string[] {
  return diff
    .split("\n")
    .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
    .map((l) => l.slice(1));
}

describe("nudo contract --emit · BUG-196 · 同一侧车同一段 = 一个写者", () => {
  it("两个分支都命中同一导出 ⇒ 直写正文优先 + `derived-from` 标签行真落盘", () => {
    const { dir, sidecar } = makeFixture();

    const r = runCli(["contract", "lib.js", "--emit", "--all"], { cwd: dir });
    expect(r.status, r.stdout + r.stderr).toBe(0);

    const written = readFileSync(sidecar, "utf-8");
    // 直写分支的正文（`number()`）优先于派生分支的 `lit(1)`
    expect(written).toContain(EXPECTED_WRAP);
    expect(written).not.toContain("lit(1)");
    // 派生分支的溯源行**真的落盘**（旧实现被直写分支整段覆盖 ⇒ 永不出现）
    expect(written).toContain("// derived-from: lib.js:bar");
    // 台账与文件一致：内容真的变了 ⇒ 必须报 Updated
    expect(r.stdout).toContain("Updated");
    expect(r.stdout).toContain("written: foo");
  }, 60000); // 1 个 CLI 子进程

  it("幂等：连跑两次 --emit --all ⇒ 第二次无 Updated 且 md5 不变", () => {
    const { dir, sidecar } = makeFixture();

    const first = runCli(["contract", "lib.js", "--emit", "--all"], { cwd: dir });
    expect(first.status, first.stdout + first.stderr).toBe(0);
    const afterFirst = readFileSync(sidecar, "utf-8");
    const md5First = md5(sidecar);

    const second = runCli(["contract", "lib.js", "--emit", "--all"], { cwd: dir });
    expect(second.status, second.stdout + second.stderr).toBe(0);

    expect(second.stdout).toContain("no interface changes");
    expect(second.stdout).not.toContain("Updated");
    expect(readFileSync(sidecar, "utf-8")).toBe(afterFirst);
    expect(md5(sidecar)).toBe(md5First);
  }, 60000); // 2 个 CLI 子进程

  it("收敛后 --dry-run --exit-on-diff ⇒ exit 0，且不再打印永不落盘的 diff", () => {
    const { dir, sidecar } = makeFixture();

    const real = runCli(["contract", "lib.js", "--emit", "--all"], { cwd: dir });
    expect(real.status, real.stdout + real.stderr).toBe(0);
    const converged = readFileSync(sidecar, "utf-8");

    const dry = runCli(["contract", "lib.js", "--emit", "--all", "--dry-run", "--exit-on-diff"], {
      cwd: dir,
    });
    if (dry.status !== 0) throw new Error(`dry-run status=${dry.status}\n${dry.stdout}${dry.stderr}`);
    expect(dry.stdout).not.toContain("would update");
    expect(dry.stdout).toContain("no interface changes");
    // dry-run 不落盘
    expect(readFileSync(sidecar, "utf-8")).toBe(converged);
  }, 60000); // 2 个 CLI 子进程

  it("预览 == 写盘（字节级）：dry-run 的新增行拼起来就是真实写盘内容", () => {
    const { dir, sidecar } = makeFixture();
    expect(existsSync(sidecar)).toBe(false);

    const dry = runCli(["contract", "lib.js", "--emit", "--all", "--dry-run"], { cwd: dir });
    expect(dry.status, dry.stdout + dry.stderr).toBe(0);
    expect(dry.stdout).toContain("[dry-run] would update lib.nudo.js:");
    // 预览点名要加的溯源行
    expect(dry.stdout).toContain("+// derived-from: lib.js:bar");
    // 预览不落盘
    expect(existsSync(sidecar)).toBe(false);

    const real = runCli(["contract", "lib.js", "--emit", "--all"], { cwd: dir });
    expect(real.status, real.stdout + real.stderr).toBe(0);

    // 全新侧车 ⇒ 预览的新增行按序拼起来 == 真实写盘内容（逐字节）
    const previewed = `${addedLines(dry.stdout.replace(/^\[dry-run\][^\n]*\n/, "")).join("\n")}\n`;
    expect(readFileSync(sidecar, "utf-8")).toBe(previewed);
  }, 60000); // 2 个 CLI 子进程
});
