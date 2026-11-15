/**
 * Bug 1037 — `nudo check` 的 env 模块装配用**对象展开**代替
 * `mergeHarvestUnderEnv` ⇒ 手写 env 与 harvest **同名模块**时，harvest 的
 * **非冲突导出被整体丢弃** ⇒ check 面报 `unknown` + 误导诊断
 * （`nudo:unknown-inference`），而 test 面报**精确值** ⇒ 两个产品面互相矛盾。
 *
 * 修法（族 18 片 4）：check 面的模块图合并走 `mergeHarvestUnderEnv`
 * （与 test/service 面同口径）：env 赢**同名槽**，harvest 填 env 的**空位**
 * （B8）。
 *
 * oracle（改前 → 改后）：
 *   改前 `nudo check lib.js` ⇒ `harvested(a: any) => unknown` + unknown-inference 告警
 *   改后 `nudo check lib.js` ⇒ `harvested(a: any) => string` + 无 unknown-inference 告警
 *   （`nudo test lib.js` 两边都是 `(any) => string` ⇒ 两面一致）
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx as runCli } from "./helpers/run-cli.ts";

/**
 * 夹具：`util` 同时被**手写 env**（`@nudo:env node` 提供 `format`）与
 * **harvest**（node_modules/util/index.d.ts 提供 `onlyHarvest`）覆盖。
 * 合并口径：env 赢同名槽、harvest 填空位 ⇒ 两个导出都可用。
 */
function project(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-b1037-"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "b1037", version: "1.0.0", type: "module" }),
    "utf-8",
  );
  mkdirSync(join(dir, "node_modules", "util"), { recursive: true });
  writeFileSync(
    join(dir, "node_modules", "util", "package.json"),
    JSON.stringify({ name: "util", version: "1.0.0", types: "index.d.ts" }),
    "utf-8",
  );
  writeFileSync(
    join(dir, "node_modules", "util", "index.d.ts"),
    `export declare function onlyHarvest(a: string): string;
export declare function format(...args: unknown[]): string;
`,
    "utf-8",
  );
  writeFileSync(
    join(dir, "node_modules", "util", "index.js"),
    `module.exports = { onlyHarvest: (a) => a };
`,
    "utf-8",
  );
  writeFileSync(
    join(dir, "lib.js"),
    `/// @nudo:env node
import { onlyHarvest, format } from "util";

export function harvested(a) {
  return onlyHarvest(a);
}
export function key(dir, name) {
  return format(dir, name);
}
`,
    "utf-8",
  );
  return dir;
}

describe("Bug 1037 — env 模块合并须走 mergeHarvestUnderEnv（harvest 填空位）", () => {
  it("check 面：harvest 的非冲突导出不再被丢弃（unknown ⇒ string）", { timeout: 90_000 }, () => {
    const dir = project();
    const r = runCli(["check", join(dir, "lib.js")]);
    const out = r.stdout + r.stderr;
    expect(r.status, out).toBe(0);
    expect(out).toContain("harvested(a: any) => string");
    expect(out).not.toContain("harvested(a: any) => unknown");
    // 误导诊断（真 unknown）必须消失
    expect(out).not.toContain("nudo:unknown-inference");
  });

  it("check 面与 test 面结论一致（同一文件、同一个精确签名）", { timeout: 90_000 }, () => {
    const dir = project();
    const file = join(dir, "lib.js");
    const c = runCli(["check", file]);
    const t = runCli(["test", file]);
    // check 面签名表：harvested(a: any) => string（改前是 => unknown）
    expect(c.stdout + c.stderr).toContain("harvested(a: any) => string");
    // test 面 case 表：(any) => string
    expect(t.stdout + t.stderr).toContain("(any) => string");
    expect(c.stdout + c.stderr).not.toContain("=> unknown");
  });
});
