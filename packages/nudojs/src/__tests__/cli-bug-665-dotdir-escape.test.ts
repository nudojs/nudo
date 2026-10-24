/**
 * Bug 665 —— `nudo contract --write` 的**项目根边界**用 `rel.startsWith("..")`
 * 判逃逸 ⇒ 项目根下的**合法目录** `..data/` 被判「在项目根之外」⇒ 草稿
 * **拒写**（exit 1）—— 而同一文件在项目根下**正常写出**。
 *
 * 根因：`relative()` 返回的是**相对路径字符串**——「向上逃逸」的判据是
 * 「整段等于 `..`」或「以 `..` + 路径分隔符开头」，**不是**裸
 * `startsWith("..")`：后者把 `..data/` / `...cfg/` 这类**合法**相对路径
 * （目录名以 `..` 开头）误判成父目录逃逸。
 *
 * 修法（族 20 · 片 B · **CLI 半**）：判据改成
 * `rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)`
 * —— 与 service 半（`packages/service/src/emit/interface-draft.ts` 的
 * `writeInterfaceDraft`）**逐字同款**（同一个 bug 的两半 ⇒ 同一片修）。
 *
 * ⚠ 本钉的夹具**全部写在临时目录**里 ⇒ 绝不往仓里写文件。
 * ⚠ 两层钉：
 *   ① **进程内**直调 `runContractDraft`（`@nudojs/service/emit` 在测试里
 *      走 **src** 别名 ⇒ CLI 半 + service 半**两端都是源码**）⇒ 端到端写盘；
 *   ② **CLI 级**（子进程）：断言 CLI 半**不再**用那句 CLI 专属的拒写文案。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliNode as runCli } from "./helpers/run-cli.ts";
import { runContractDraft } from "../commands/contract-draft.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-cli-665-"));
  writeFileSync(
    join(dir, "package.json"),
    '{ "name": "dotdir-probe", "private": true, "type": "module" }\n',
    "utf-8",
  );
  mkdirSync(join(dir, "..data"), { recursive: true });
  writeFileSync(join(dir, "..data", "f.js"), "export function f(x) { return x + 1; }\n", "utf-8");
  writeFileSync(join(dir, "normal.js"), "export function g(x) { return x + 1; }\n", "utf-8");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** 进程内跑一次 `runContractDraft`，收走 console 与 exit code（不污染测试进程）。 */
async function runDraftInProcess(
  file: string,
): Promise<{ stdout: string; stderr: string; exitCode: number | string | null | undefined }> {
  const out: string[] = [];
  const err: string[] = [];
  const origLog = console.log;
  const origError = console.error;
  const prevExitCode = process.exitCode;
  console.log = (...args: unknown[]): void => {
    out.push(args.map((a) => (typeof a === "string" ? a : String(a))).join(" "));
  };
  console.error = (...args: unknown[]): void => {
    err.push(args.map((a) => (typeof a === "string" ? a : String(a))).join(" "));
  };
  let exitCode: number | string | null | undefined;
  try {
    await runContractDraft(file, { fnNames: [], write: true, dryRun: false });
    exitCode = process.exitCode;
  } finally {
    console.log = origLog;
    console.error = origError;
    process.exitCode = prevExitCode;
  }
  return { stdout: out.join("\n"), stderr: err.join("\n"), exitCode };
}

describe("Bug 665 —— contract --draft --write 不得把 `..data/` 判成越出项目根", () => {
  it("进程内：CLI 半 + service 半（都走 src）⇒ `..data/f.js` 的草稿**写出来了**", async () => {
    const file = join(dir, "..data", "f.js");

    const r = await runDraftInProcess(file);

    // 改前：CLI 半就拒了（`is outside project root …; draft write refused`）
    expect(r.stderr).not.toContain("outside project root");
    expect(r.exitCode).not.toBe(1);
    expect(r.stdout).toContain("Draft written →");
    expect(existsSync(join(dir, "..data", "f.nudo.draft.js"))).toBe(true);
  }, 60000); // 进程内分析（不走子进程）

  it("CLI 级：CLI 半**不再**用那句「is outside project root」拒写文案", () => {
    const r = runCli(["contract", "--draft", "--write", "..data/f.js"], { cwd: dir });

    // 改前：stderr = "Error: '…/..data/f.js' is outside project root '…'; draft write refused"
    // （service 半的拒写文案是「draft write refused: outside project root」，
    //   两者**不同** ⇒ 这条断言精确地钉住 **CLI 半**。）
    expect(r.stderr).not.toContain("is outside project root");
  }, 60000); // 1 个 CLI 子进程（tsx 冷启动）

  it("负控制：同一项目根下的普通文件照常写出（不误伤）", () => {
    const r = runCli(["contract", "--draft", "--write", "normal.js"], { cwd: dir });

    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
    expect(r.stdout).toContain("Draft written → normal.nudo.draft.js");
    expect(existsSync(join(dir, "normal.nudo.draft.js"))).toBe(true);
  }, 60000); // 1 个 CLI 子进程（tsx 冷启动）
});
