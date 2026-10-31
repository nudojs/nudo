/**
 * BUG-056 回归：`nudo check` 的签名必须是**一次正常求值**的结果。
 *
 * 症状（报告时的形态）：check 通道先跑分析器再跑 core 闸门，两轮共享同一份
 * 模块实例 ⇒ 模块级可变状态被双写，闸门打印的签名取自脏状态：
 * - `let c = 0; export function bump(){ c += 1; return c }` → `bump() => 2`
 *   （原生唯一可能值是 1；`nudo test` / `nudo export` 都给 1）
 * - `once()`（第一次调用必抛）→ `1 throws Error`（应为 `never throws Error`，
 *   发布的 d.ts 也是 `never`）⇒ 门禁面与发布面互相矛盾
 * - 该签名是 `nudo:interface-drift` 的输入 ⇒ 生成段（干净值）与今日域
 *   （脏值）永不收敛：emit 说「无变化」、check 说「漂移」、health 判 FAIL
 *   且提示的重跑无效（CI 卡死，无自愈路径）。
 *
 * 当前树已修好（分析器轮与闸门轮不再共享实例）；本测试钉住**值级结论**防回归：
 * 1. 计数器工厂：check 与 test 两面都给 1（跨动词一致）；
 * 2. 一次性抛：check 给 `never` + `throws Error`（与 d.ts 一致）；
 * 3. 漂移收敛：手写 `lit(1)` 生成段 ⇒ check **不报** `nudo:interface-drift`
 *    且签名 = 1（脏值会让它与生成段打架）。
 *
 * 注：每个用例用**独立**的 `NUDO_CACHE_DIR`——check 有磁盘缓存，复用会让
 * 「值是从缓存来的」与「值是真算出来的」不可区分。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

/** 模块级计数器（无顶层调用）⇒ 原生唯一可能值 1 */
const COUNTER = `let c = 0;

export function bump() {
  c += 1;
  return c;
}
`;

/** 一次性标志 ⇒ 第一次调用必抛（返回面恒 never） */
const ONCE = `let first = true;
export function once() {
  if (first) {
    first = false;
    throw new Error("boom");
  }
  return 1;
}
`;

/** 一次性标志的**有返回值**版本：第一次 1、之后 2（漂移敏感） */
const ONCE_VALUE = `let first = true;
export function once() {
  if (first) {
    first = false;
    return 1;
  }
  return 2;
}
`;

function project(files: Record<string, string>): { cwd: string; cache: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug056-"));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, "utf-8");
  }
  return { cwd: dir, cache: join(dir, ".nudo-cache") };
}

describe("BUG-056: check 签名 = 一次正常求值", () => {
  it("计数器工厂：check 与 test 都给 1", { timeout: 60_000 }, () => {
    const { cwd, cache } = project({ "lib.js": COUNTER });
    const env = { NUDO_CACHE_DIR: cache };
    const check = runCliTsx(["check", "lib.js"], { cwd, env });
    expect(check.stdout).toContain("bump() => 1");
    expect(check.stdout).not.toContain("bump() => 2");
    // 跨动词一致：test 面（分析器单轮）同样是 1
    const test = runCliTsx(["test", "lib.js"], { cwd, env });
    expect(test.stdout).toMatch(/entry@L\d+\s+\(\) => 1/);
  });

  it("一次性抛：check 给 never（与 d.ts 一致），不是 1", { timeout: 60_000 }, () => {
    const { cwd, cache } = project({ "once.js": ONCE });
    const r = runCliTsx(["check", "once.js"], { cwd, env: { NUDO_CACHE_DIR: cache } });
    expect(r.stdout).toContain("once() => never");
    expect(r.stdout).toContain("throws Error");
    expect(r.stdout).not.toContain("once() => 1");
  });

  it("手写 lit(1) 生成段 ⇒ 不报 interface-drift（脏值会与生成段打架）", { timeout: 60_000 }, () => {
    const { cwd, cache } = project({
      "once.js": ONCE_VALUE,
      "once.nudo.js": `import { fn, lit } from "@nudojs/core";
export const once = fn({  }, lit(1));
`,
    });
    const r = runCliTsx(["check", "once.js"], { cwd, env: { NUDO_CACHE_DIR: cache } });
    expect(r.stdout).toContain("once() => 1");
    expect(r.stdout).not.toContain("nudo:interface-drift");
    expect(r.status).toBe(0);
  });
});
