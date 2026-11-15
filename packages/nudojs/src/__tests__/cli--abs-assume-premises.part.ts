/**
 * BUG-085 回归：`check --abs` 必须与 `check --json` 的 `abs` **同源** ——
 * 源码级 `@nudo:assume d <= max` 的用户引理不得在观察面丢掉。
 *
 * 症状（修前）：同一份源码，`check --json` 的 `abs` 是
 * `number = /(d, max) where /(d, max) ≤ 1 #path`（有 pred），而 `check --abs`
 * 打印 `number / term: /(d, max) / conf: path`（**无 pred**）；把 `@nudo:assume`
 * 那行删掉两面又逐字一致 ⇒ 差异精确来自这条指令，不是观察面固有的精度差。
 *
 * 根因：门禁（core `checkSource`）在目标函数入口用 `withAssumePremises` 种
 * **前提槽**（issue #152 引理；不随调用链继承），而 `runAbsView` 只种 CLI
 * `--assume` 的 **phi**（路径条件），从不看源码指令 ⇒ 同一命令两个面互斥。
 *
 * 断言面：
 * 1. 带 `@nudo:assume`：`--abs` 面出现与 `--json` 面**同一句** pred
 *    （`/(d, max) ≤ 1`）；
 * 2. 对照组（删掉 assume 行）：两面都不出现该 pred（差异确实由指令引起）；
 * 3. `nudo test --abs` 走同一 `runAbsView` ⇒ 同样可见（第三处观察面）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** 侧车契约：分母恒正（div 关系折叠的 posDen 前提） */
const SIDECAR = `import { fn, number } from "@nudojs/core";
export const ratio = fn({ d: number(), max: number().gt(0) }, number());
`;

function fixture(assumeLine: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-b085-"));
  dirs.push(dir);
  writeFileSync(join(dir, "ratio.js"), `/**\n * ${assumeLine}\n */\nexport function ratio(d, max) {\n  return d / max;\n}\n`, "utf-8");
  writeFileSync(join(dir, "ratio.nudo.js"), SIDECAR, "utf-8");
  return join(dir, "ratio.js");
}

/** 每次调用独立的缓存目录：`nudo check` 有落盘缓存，串用会掩盖回归 */
function cacheDir(): Record<string, string> {
  const dir = mkdtempSync(join(tmpdir(), "nudo-b085-cache-"));
  dirs.push(dir);
  return { NUDO_CACHE_DIR: dir };
}

/** `--abs` 观察面里 pred 行的规范文本（`pred: /(d, max) ≤ 1`） */
const PRED_LINE = "pred: /(d, max) ≤ 1";

describe("BUG-085 — @nudo:assume 前提在 --abs 观察面可见（与 --json 同源）", () => {
  it("带 assume：--abs 与 --json 的 abs 面出现同一句 pred", () => {
    const file = fixture("@nudo:assume d <= max");

    const abs = runCliTsx(["check", "--abs", file], { env: cacheDir() });
    expect(abs.status).toBe(0);
    expect(abs.stdout).toContain(PRED_LINE);

    const json = runCliTsx(["check", "--json", file], { env: cacheDir() });
    expect(json.status).toBe(0);
    // 机器面同一事实（单行 `formatAbs`：`where /(d, max) ≤ 1`）
    expect(json.stdout).toContain("where /(d, max) ≤ 1");
  }, 90_000);

  it("对照组（无 assume 行）：两面都不出现该 pred", () => {
    const file = fixture("ratio: d / max");

    const abs = runCliTsx(["check", "--abs", file], { env: cacheDir() });
    expect(abs.status).toBe(0);
    // 观察面仍在算（term 可见），只是没有前提可折 ⇒ 无 pred
    expect(abs.stdout).toContain("term: /(d, max)");
    expect(abs.stdout).not.toContain(PRED_LINE);

    const json = runCliTsx(["check", "--json", file], { env: cacheDir() });
    expect(json.status).toBe(0);
    expect(json.stdout).not.toContain("where /(d, max) ≤ 1");
  }, 90_000);

  it("`nudo test --abs` 走同一观察面 ⇒ 前提同样可见", () => {
    const file = fixture("@nudo:assume d <= max");
    const r = runCliTsx(["test", "--abs", file], { env: cacheDir() });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(PRED_LINE);
  }, 90_000);
});
