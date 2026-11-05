/**
 * Bug 643 —— **CLI 闭环**：`nudo check <被调方> --from <调用方>` 的现场文件
 * **路径**从未到达 `runCheck` ⇒ 静态调用点复核整条失明 ⇒ 门禁**假绿**。
 *
 * 根因链（库级接线已由族 18 · 片 3 落盘，CLI 侧漏了最后一根线）：
 * - `commands/check-command.ts` 的 action 把 `--from` 路径交给
 *   `commands/shared.ts` 的 `collectExternalRecords`，它**塌缩成执行态
 *   `CallRecord[]``**；现场文件「零条执行态记录」时直接回 `undefined`
 *   ⇒ `runCheck` 连「现场文件是哪个」都看不见；
 * - `check-json-map.ts` 的 `staticFromDomainIssues`（按 core 同文件通道的
 *   静态全树扫描判据复核 `--from` 现场文件）与 `check.ts` 的
 *   `RunCheckOptions.fromPaths` 都需要**路径**才能工作 ⇒ 路径不落地 ⇒
 *   静态通道整条失明；
 * - 症状：调用点被包在**函数体 / 箭头 / 方法体**里时（执行态采集拿不到
 *   记录），`nudo check <被调方> --from <调用方>` **exit 0 绿**，而
 *   `nudo check <调用方>` **exit 1 红** —— 谁被检查谁决定颜色。
 *
 * 本钉走**产品面**（共享脚手架 `helpers/run-cli.ts` 的 CLI runner）：
 * ① `--from` ⇒ 被调方红（exit 1）+ 恰一条 `nudo:interface-domain-exceeds`；
 * ② `--json` 面同判（ok:false / summary.errors=1 / issues 恰一条）；
 * ③ 归因到**被调方导出名**（`fn: "f"` / actual `-1`）；
 * ④ `--from <目录>` 同判（现场文件集合按目录展开）；
 * ⑤ 控制组：直接 check **调用方** ⇒ 仍 1 条 `nudo:constraint-violated`
 *    （跨文件面不得污染同文件面）；
 * ⑥ 控制组：**不带** `--from` ⇒ 被调方绿（不得凭空造证据）；
 * ⑦ **不重复报告**：顶层调用点（执行态 + 静态两通道同时命中）⇒ 恰一条。
 *
 * 闸④（反向闸）：拷进 HEAD 只读副本必须**大面积失败** —— HEAD 上
 * ① ② ③ ④ 四条全红（CLI 假绿），⑤ ⑥ ⑦ 三条控制组仍绿。
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

/** 出现次数（诊断码计数用） */
function countOf(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/**
 * 人类面 issues 段里的诊断码（**只取 issue 行**）。
 *
 * 人类面里同一个码会出现**两次**：issue 行（`[ERROR ...] ... (nudo:xxx)`）
 * 与 docs 深链行（`nudo:xxx → https://...`）⇒ 计「条数」必须排除深链行。
 */
function issueCodes(out: string): string[] {
  const codes: string[] = [];
  for (const line of out.split("\n")) {
    if (!line.trimStart().startsWith("[")) continue;
    const m = /\((nudo:[a-z0-9:-]+)\)\s*$/.exec(line);
    if (m) codes.push(m[1]);
  }
  return codes;
}

/** `--json` 面的最小可读形状（只取本钉断言用到的字段） */
type CheckJsonLike = {
  ok: boolean;
  summary: { errors: number; warnings: number; infos: number };
  issues: Array<{
    severity: string;
    code: string;
    message: string;
    fn?: string;
    actual?: string;
    expected?: string;
  }>;
};

/**
 * 夹具（被调方 + 侧车契约 + 现场文件）：
 * - `lib.js`：被调方（导出 `f`）；
 * - `lib.nudo.js`：手写契约侧车（`x > 0`）——ambient 绑定，无需 import；
 * - `infn.js`：现场文件，调用点**被包在函数体内** ⇒ 执行态采集拿不到记录
 *   ⇒ 只有静态通道能看见它。
 */
function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-b643-cli-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "package.json"),
    `{ "name": "b643cli", "version": "1.0.0", "type": "module" }\n`,
    "utf-8",
  );
  writeFileSync(join(dir, "lib.js"), `export function f(x) { return x; }\n`, "utf-8");
  writeFileSync(
    join(dir, "lib.nudo.js"),
    `export const f = fn({ x: number().gt(0) });\n`,
    "utf-8",
  );
  writeFileSync(
    join(dir, "infn.js"),
    `import { f } from "./lib.js";\nexport function use() { return f(-1); }\n`,
    "utf-8",
  );
  return dir;
}

describe("Bug 643 —— --from 的现场文件路径必须到达 runCheck（CLI 闭环）", () => {
  it("① --from 现场文件（调用点在函数体内）⇒ 被调方门禁红（exit 1 + 恰一条跨文件域超限）", () => {
    const dir = fixture();
    const r = runCliTsx(["check", "lib.js", "--from", "infn.js"], { cwd: dir });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("nudo:interface-domain-exceeds");
    expect(countOf(issueCodes(r.stdout).join("\n"), "nudo:interface-domain-exceeds")).toBe(1);
    // 跨文件面用跨文件面的码（同文件通道的码不得出现在被调方报告里）
    expect(r.stdout).not.toContain("nudo:constraint-violated");
  }, 60000);

  it("② --json 面同判：ok:false + summary.errors=1 + issues 恰一条", () => {
    const dir = fixture();
    const r = runCliTsx(["check", "lib.js", "--from", "infn.js", "--json"], { cwd: dir });
    expect(r.status).toBe(1);
    const json = JSON.parse(r.stdout) as CheckJsonLike;
    expect(json.ok).toBe(false);
    expect(json.summary.errors).toBe(1);
    expect(json.issues.length).toBe(1);
    expect(json.issues[0].code).toBe("nudo:interface-domain-exceeds");
    expect(json.issues[0].severity).toBe("error");
  }, 60000);

  it("③ 违例归因到被调方的导出名（fn=f / actual=-1），不是现场文件的本地名", () => {
    const dir = fixture();
    const r = runCliTsx(["check", "lib.js", "--from", "infn.js", "--json"], { cwd: dir });
    expect(r.status).toBe(1);
    const json = JSON.parse(r.stdout) as CheckJsonLike;
    expect(json.issues[0].fn).toBe("f");
    expect(json.issues[0].actual).toBe("-1");
    expect(json.issues[0].message).toContain("f[x]");
  }, 60000);

  it("④ --from <目录> ⇒ 同判（现场文件集合按目录展开）", () => {
    const dir = fixture();
    const r = runCliTsx(["check", "lib.js", "--from", "."], { cwd: dir });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("nudo:interface-domain-exceeds");
    expect(countOf(issueCodes(r.stdout).join("\n"), "nudo:interface-domain-exceeds")).toBe(1);
  }, 60000);

  it("⑤ 控制组：直接 check 调用方 ⇒ 仍 1 条 nudo:constraint-violated（跨文件面不污染同文件面）", () => {
    const dir = fixture();
    const r = runCliTsx(["check", "infn.js", "--json"], { cwd: dir });
    expect(r.status).toBe(1);
    const json = JSON.parse(r.stdout) as CheckJsonLike;
    const codes = json.issues.map((i) => i.code);
    expect(countOf(codes.join("\n"), "nudo:constraint-violated")).toBe(1);
    expect(countOf(codes.join("\n"), "nudo:interface-domain-exceeds")).toBe(0);
  }, 60000);

  it("⑥ 控制组：不带 --from ⇒ 被调方绿（不凭空造证据）", () => {
    const dir = fixture();
    const r = runCliTsx(["check", "lib.js", "--json"], { cwd: dir });
    expect(r.status).toBe(0);
    const json = JSON.parse(r.stdout) as CheckJsonLike;
    expect(json.ok).toBe(true);
    const codes = json.issues.map((i) => i.code);
    expect(countOf(codes.join("\n"), "nudo:interface-domain-exceeds")).toBe(0);
  }, 60000);

  it("⑦ 不重复报告：顶层调用点（执行态 + 静态两通道同时命中）⇒ 恰一条", () => {
    const dir = fixture();
    writeFileSync(
      join(dir, "top.js"),
      `import { f } from "./lib.js";\nexport const r = f(-1);\n`,
      "utf-8",
    );
    const r = runCliTsx(["check", "lib.js", "--from", "top.js", "--json"], { cwd: dir });
    expect(r.status).toBe(1);
    const json = JSON.parse(r.stdout) as CheckJsonLike;
    const codes = json.issues.map((i) => i.code);
    expect(countOf(codes.join("\n"), "nudo:interface-domain-exceeds")).toBe(1);
  }, 60000);
});
