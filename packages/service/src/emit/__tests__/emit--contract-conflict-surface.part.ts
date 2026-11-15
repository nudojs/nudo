/**
 * BUG-081 —— `nudo contract` 把**无解契约**印成**有效契约**并 exit 0，而
 * `nudo check` 报 `nudo:contract-conflict` error（exit 1）、`nudo export` 拒绝
 * 出货（exit 1）⇒ 三个一级动词对同一个事实给出**相反结论**。
 *
 * 根因：`effectiveEntry` 打印 `eff.params` / `eff.returns` 时只调
 * `formatConstraint`，**从不读** `eff.conflict` / `eff.undecidable`（信息早就在
 * 有效契约上，只是没接到打印边界）。
 *
 * 判据：契约面与门禁面同结论 —— 条目带 `conflict` / `undecidable` 字段、
 * 人读行有标记、`--json` 有同名字段、`conflict` ⇒ 非零退出。
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { contractSurface, formatContractSurfaceLine } from "../contract-surface.ts";
import { tmpProject, writeTmpFiles } from "../../__tests__/tmp-project.ts";

const CONFLICT_FILES = {
  "conflict.nudo.js": `import { fn, number } from "@nudojs/core";
export const big = number().ge(5);
export const conflict = fn({ n: number().le(3) });
`,
  "conflict.js": `/// @nudo:import { big } from "./conflict.nudo.js"
/**
 * @nudo:contract n big
 */
export function conflict(n) {
  return n;
}
`,
};

/** 造一个无解契约工程，返回入口文件绝对路径 */
function conflictProject(): string {
  const dir = tmpProject("nudo-bug-081-");
  writeTmpFiles(dir, CONFLICT_FILES);
  return join(dir, "conflict.js");
}

/** 真跑 CLI（退出码是本条 bug 的另一半，字符串断言抓不到） */
function runCli(args: string[]): { status: number; stdout: string; stderr: string } {
  const repoRoot = join(import.meta.dirname, "../../../../..");
  // spawnSync 而非 execFileSync：只读 `contract` 修好 Bug 34 后 exit 0，但
  // 诊断仍写 stderr；execFileSync 的成功分支拿不到 stderr（只有抛错分支有）。
  const r = spawnSync(
    "npx",
    ["tsx", join(repoRoot, "packages/nudojs/src/index.ts"), ...args],
    { cwd: repoRoot, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
  );
  return {
    status: r.status ?? 1,
    stdout: String(r.stdout ?? ""),
    stderr: String(r.stderr ?? ""),
  };
}

describe("BUG-081 —— 契约面与门禁面对无解契约给同一结论", () => {
  it("契约条目透出 conflict（此前被静默跳过 ⇒ 印成有效契约）", async () => {
    const entries = await contractSurface(conflictProject());
    const entry = entries.find((e) => e.fn === "conflict");
    expect(entry).toBeDefined();
    expect(entry!.conflict?.params).toEqual(["n"]);
  });

  it("人读行带 `[unsatisfiable: n]` 标记（不再印成「有效契约」）", async () => {
    const entries = await contractSurface(conflictProject());
    const line = formatContractSurfaceLine(entries.find((e) => e.fn === "conflict")!);
    expect(line).toContain("[unsatisfiable: n]");
  });

  it("`nudo contract` 与 check 同诊断：stderr 报同码 error + 只读命令 exit 0", () => {
    // Bug 34：只读 `contract` 的 exit 契约是「仅用法 / IO 错误时 exit 1」；
    // 契约冲突是被分析代码的状态，诊断照发但不再把进程判失败。
    const file = conflictProject();
    const text = runCli(["contract", file]);
    expect(text.status).toBe(0);
    expect(text.stderr).toContain("nudo:contract-conflict");
    expect(text.stderr).toContain("conflict: handwritten contract conjunction unsatisfiable (n)");
    expect(text.stdout).toContain("[unsatisfiable: n]");
  });

  it("`--json` 机器面：同名字段 + 只读命令 exit 0（stdout 仍是合法 JSON）", () => {
    const file = conflictProject();
    const res = runCli(["contract", "--json", file]);
    expect(res.status).toBe(0);
    const payload = JSON.parse(res.stdout) as Array<{
      entries: Array<{ fn: string; conflict?: { params: string[] } }>;
    }>;
    expect(payload[0]!.entries[0]!.conflict?.params).toEqual(["n"]);
  });

  // ── 负控制：无冲突的契约照旧 exit 0、无标记 ─────────────────────
  it("负控制：普通契约不带标记且 exit 0", async () => {
    const dir = tmpProject("nudo-bug-081-ok-");
    writeTmpFiles(dir, {
      "ok.nudo.js": `import { number } from "@nudojs/core";
export const num = number().ge(5);
`,
      "ok.js": `/// @nudo:import { num } from "./ok.nudo.js"
/**
 * @nudo:contract n num
 */
export function ok(n) {
  return n;
}
`,
    });
    const file = join(dir, "ok.js");
    const entries = await contractSurface(file);
    const line = formatContractSurfaceLine(entries.find((e) => e.fn === "ok")!);
    expect(line).not.toContain("[unsatisfiable");
    expect(line).not.toContain("[conjunction not computable");
    const res = runCli(["contract", file]);
    expect(res.status).toBe(0);
    expect(res.stderr).toBe("");
  });
});
