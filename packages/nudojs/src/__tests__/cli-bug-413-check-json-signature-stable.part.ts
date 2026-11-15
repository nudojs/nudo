/**
 * Bug 413 —— `nudo check --json` 把**引擎内部 term id**（`len#N` 一族）渲进
 * 机器可读的签名字段 ⇒ 且编号随**同一次调用内的文件顺序**漂移 ⇒
 * **单个文件的 JSON 载荷是它在参数列表中位置的函数**，不是文件内容的函数
 * （机器消费方拿到的不是可比对的内容）；**同一条命令的人类面**还给出另一个
 * 字符串（`f() => number` vs `number = len#0 where len#0 ≥ 0 #path`）。
 *
 * 本钉钉住 CLI 全链三件事：
 * ① 载荷三字段（display / detail / abs）不得含引擎内部 id；
 * ② **同内容不同参数位置 ⇒ 载荷逐字相同**（换序也不变）；
 * ③ 机器面 `display` 与人类面 `signatures` 行**同源**（口径一致）。
 *
 * 磁盘缓存**必须关**（本仓根 package.json 无 `nudo.cache`、夹具在 tmp 目录 ⇒
 * 默认关）：开着缓存时第二轮直接回放第一轮的载荷 ⇒ ② 会在 HEAD 上假绿。
 *
 * ⚠ **cwd 必须是仓库根**（`runCliTsx` 的默认）：tsx 按 **cwd 的 tsconfig**
 * 解析 `@nudojs/*` ⇒ 仓库根的 `tsconfig.json` 有 `paths` ⇒ 走 **src**；
 * 换到夹具目录（无 tsconfig）就会落到 `packages/core/dist/` 的**旧产物**，
 * 测的就不是本次改动的代码。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

/** 抽象长度：引擎为「未知长度」铸一个**进程级计数器** var（`len#N`） */
const SRC = `export function f() {
  const a = [1, 2, 3];
  a.length = 5000;
  return a.length;
}
`;

type Sig = { display: string; detail: string; abs: string };

function setup(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-413-"));
  for (const name of ["a.js", "b.js", "c.js"]) {
    writeFileSync(join(dir, name), SRC, "utf8");
  }
  return dir;
}

function runCheck(dir: string, files: string[], args: string[] = []) {
  const paths = files.map((f) => join(dir, f));
  // cwd 保持仓库根（tsx 的 tsconfig paths ⇒ @nudojs/* 走 src）
  return runCliTsx(["check", ...paths, ...args]);
}

/** 单文件（裸 CheckJson）/ 多文件（multi 信封）两种形态 → 按文件名归一 */
function byFile(stdout: string): Record<string, Sig[]> {
  const parsed = JSON.parse(stdout) as {
    kind?: string;
    file?: string;
    signatures?: Sig[];
    reports?: Array<{ file: string; signatures: Sig[] }>;
  };
  const reports = parsed.kind === "multi" ? parsed.reports! : [parsed as never];
  const out: Record<string, Sig[]> = {};
  for (const r of reports) out[basename(r.file)] = r.signatures!;
  return out;
}

describe("Bug 413：`nudo check --json` 载荷不得含内部 id 且与参数位置无关", () => {
  it("三个同内容文件的载荷逐字相同（换序也不变）", { timeout: 120_000 }, () => {
    const dir = setup();
    const r1 = runCheck(dir, ["a.js", "b.js", "c.js"], ["--json"]);
    const r2 = runCheck(dir, ["c.js", "b.js", "a.js"], ["--json"]);
    expect(r1.status).toBe(0);
    expect(r2.status).toBe(0);
    const p1 = byFile(r1.stdout);
    const p2 = byFile(r2.stdout);
    expect(Object.keys(p1).sort()).toEqual(["a.js", "b.js", "c.js"]);
    expect(p1["a.js"]).toEqual(p2["a.js"]);
    expect(p1["b.js"]).toEqual(p2["b.js"]);
    expect(p1["c.js"]).toEqual(p2["c.js"]);
  });

  it("载荷三字段不含内部 id", { timeout: 120_000 }, () => {
    const dir = setup();
    const r = runCheck(dir, ["a.js"], ["--json"]);
    expect(r.stdout).not.toContain("len#");
    const sig = byFile(r.stdout)["a.js"]![0]!;
    expect(sig.display).not.toMatch(/#\d+/);
    expect(sig.detail).not.toMatch(/#\d+/);
    expect(sig.abs).not.toMatch(/#\d+/);
  });

  it("机器面 display 与人类面 signatures 行同源", { timeout: 120_000 }, () => {
    const dir = setup();
    const human = runCheck(dir, ["a.js"]);
    const machine = runCheck(dir, ["a.js"], ["--json"]);
    const sig = byFile(machine.stdout)["a.js"]![0]!;
    expect(human.stdout).toContain(`  f() => ${sig.display}`);
  });

  it("--verbose 人类面不得含内部 id", { timeout: 120_000 }, () => {
    const dir = setup();
    const r = runCheck(dir, ["a.js"], ["--verbose"]);
    expect(r.stdout).not.toContain("len#");
  });
});
