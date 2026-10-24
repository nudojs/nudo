/**
 * Bug 647 — `package.json#nudo.env` 的**路径型**条目按**被分析文件所在目录**
 * 解析（不是项目根）⇒ **子目录**里的文件永远拿不到 env ⇒ **假红**
 * （`never` + `nudo:env-unresolved`）+ 误导诊断。
 *
 * 修法（族 18 片 4）：env 名装配**分层**（`assembleEnvs`）——
 * - **项目级**（package.json#nudo.env）按**项目根**解析（相对说明符先绝对化：
 *   收集期的查表基准是「最后一次 preload 的目录」，不绝对化则子目录文件必然
 *   查空）；
 * - **文件级**（`/// @nudo:env <path>`）按**本文件目录**解析；
 * - env 加载失败诊断按**各自**的基准过滤 ⇒ 不再报 check 面从未请求过的路径。
 *
 * oracle（改前 → 改后）：
 *   改前 `nudo check src/lib.js` ⇒ FAILED / `magic() => never` / env-unresolved
 *   改后 `nudo check src/lib.js` ⇒ OK / `magic() => 42` / 无 env 告警
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx as runCli } from "./helpers/run-cli.ts";

/** 项目级 path env（按项目根解析）+ 一个子目录里的被检查文件 */
function project(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-b647-"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "b647",
      version: "1.0.0",
      type: "module",
      nudo: { env: ["./env/web.ts"] },
    }),
    "utf-8",
  );
  mkdirSync(join(dir, "env"), { recursive: true });
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(
    join(dir, "env", "web.ts"),
    `export function defineEnv() {
  return { globals: { MAGIC: 42 } };
}
`,
    "utf-8",
  );
  writeFileSync(
    join(dir, "src", "lib.js"),
    `export function magic() { return MAGIC; }
`,
    "utf-8",
  );
  writeFileSync(
    join(dir, "rootlib.js"),
    `export function magic() { return MAGIC; }
`,
    "utf-8",
  );
  return dir;
}

describe("Bug 647 — 项目级 path env 按项目根解析（子目录文件也拿得到）", () => {
  it("子目录文件：拿到 env ⇒ magic() => 42、无 env 告警、exit 0", { timeout: 90_000 }, () => {
    const dir = project();
    const r = runCli(["check", join(dir, "src", "lib.js")]);
    const out = r.stdout + r.stderr;
    expect(r.status, out).toBe(0);
    expect(out).toContain("magic() => 42");
    expect(out).not.toContain("never");
    // 不得报 check 面从未请求过的路径（分析器通道按文件目录解析的旧记录）
    expect(out).not.toContain("env-unresolved");
  });

  it("根目录文件：口径不变（magic() => 42、exit 0）", { timeout: 90_000 }, () => {
    const dir = project();
    const r = runCli(["check", join(dir, "rootlib.js")]);
    const out = r.stdout + r.stderr;
    expect(r.status, out).toBe(0);
    expect(out).toContain("magic() => 42");
    expect(out).not.toContain("env-unresolved");
  });

  it("项目级 env 文件真缺时仍必须可见（nudo:env-unresolved 不许被过滤掉）", { timeout: 90_000 }, () => {
    const dir = project();
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        name: "b647",
        version: "1.0.0",
        type: "module",
        nudo: { env: ["./env/missing.ts"] },
      }),
      "utf-8",
    );
    const r = runCli(["check", join(dir, "src", "lib.js")]);
    const out = r.stdout + r.stderr;
    expect(out).toContain("nudo:env-unresolved");
  });
});
