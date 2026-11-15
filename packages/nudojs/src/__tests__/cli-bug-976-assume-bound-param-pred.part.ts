/**
 * Bug 976（**CLI 半**，`packages/nudojs/src/commands/shared.ts`）：`--assume`
 * 声明的**界**被顶掉 ⇒ 观察面给出比用户声明**更窄**的结果（说谎）。
 *
 * 根因：core 的 `buildArgsFromAssume` 只拿到**被假设形参的 id 集合** ⇒ 把
 * 形参自己的前提（pred）**写死**成 `x > 0`。用户写 `--assume 'x>-5'` 时，
 * 写死的 `x>0` 反而**更强**（`x>-5 ∧ x>0` ⇒ `x>0`）⇒ 引擎按 `x>0` 剪枝，
 * `x = -1` 的分支被当成不可达 ⇒ 观察面只给出 `"pos"`。
 *
 * 修法（CLI 半，core 半由 core 侧同步）：把**用户声明的界**（按形参名归并、
 * 同一形参多条取合取）**替换**掉那个写死的默认前提 ⇒ 用户界不再被顶掉。
 * （是**替换**不是合取 —— 与写死的 `x>0` 合取仍然是写死的界更强。）
 *
 * 钉：
 * - `--assume 'x>-5'` ⇒ 结果含 `"neg"`（改前只有 `"pos"`）；
 * - `--assume 'x>=-5'` ⇒ 同上（`>=` 口径，Bug 973 的运算符分派不被破坏）；
 * - 负控制：`--assume 'x>0'` ⇒ 仍只有 `"pos"`（写死的界与用户一致时不变）；
 * - 负控制：同一形参多条界取**合取**（`x>0` + `x<10` ⇒ `x=1` 可达 ⇒ 两侧都可达）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAbsViewCaptured } from "./helpers/abs-view.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** `k(x)`：x<0 ⇒ "neg"，否则 "pos"（x 的界直接决定哪一支可达）。 */
function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-b976-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "k.js"),
    `export function k(x) {
  if (x < 0) {
    return "neg";
  }
  return "pos";
}
`,
    "utf-8",
  );
  return join(dir, "k.js");
}

describe("Bug 976（CLI 半）：--assume 的界落到形参前提（不再被写死的 x>0 顶掉）", () => {
  it("--assume 'x>-5' ⇒ x=-1 可达 ⇒ 结果含 \"neg\"", async () => {
    const r = await runAbsViewCaptured(fixture(), { assume: ["x>-5"] });
    expect(r.stdout).toContain("assume: x > -5");
    // 改前：只有 "pos"（写死的 x>0 剪掉了 x<0 分支）
    expect(r.stdout).toContain('"neg" | "pos"');
  });

  it("--assume 'x>=-5' ⇒ 同上（>= 运算符分派不被破坏）", async () => {
    const r = await runAbsViewCaptured(fixture(), { assume: ["x>=-5"] });
    expect(r.stdout).toContain("assume: x >= -5");
    expect(r.stdout).toContain('"neg" | "pos"');
  });

  it("负控制：--assume 'x>0' ⇒ 仍只有 \"pos\"（用户界与写死界一致时口径不变）", async () => {
    const r = await runAbsViewCaptured(fixture(), { assume: ["x>0"] });
    expect(r.stdout).toContain("assume: x > 0");
    expect(r.stdout).toContain('"pos"');
    expect(r.stdout).not.toContain('"neg"');
  });

  it("负控制：同一形参多条界取**合取**（x>-5 且 x>0 ⇒ 更强的 x>0 生效）", async () => {
    const r = await runAbsViewCaptured(fixture(), { assume: ["x>-5", "x>0"] });
    expect(r.stdout).toContain("assume: x > -5, x > 0");
    // 合取后是 x>0 ⇒ x<0 分支不可达（修复不得把界放宽成「取其中一条」）
    expect(r.stdout).toContain('"pos"');
    expect(r.stdout).not.toContain('"neg"');
  });
});
