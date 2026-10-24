/**
 * Bug 643 —— `nudo check --from` / `nudo test --from` 的**调用点义务**只覆盖
 * **执行态**调用点 ⇒ 被包在**函数 / 箭头 / 方法**里的违例**静默漏过**
 * （exit 0 绿），而**同一调用点所在文件单独 check 是红的**。
 *
 * 根因：调用点义务有两条通道、判据本应一致——
 * - **同文件**：core 的 `scanLiteralCalls` 做**静态全树扫描** ⇒ 无论调用点
 *   是否被执行过都执法；
 * - **跨文件（`--from`）**：此前只有**执行态** `externalCallRecords`
 *   （`collectExternalRecords` 只收集真正跑过的调用）⇒ 函数体内的调用点
 *   根本没有记录 ⇒ 同一处静态可见的违例，谁被检查谁决定颜色。
 *
 * 修法：复用 core **同文件通道的静态扫描**（`checkSource` 对 `--from` 现场
 * 文件跑一遍）复核调用点义务 ⇒ 两通道同码（`nudo:constraint-violated`）
 * 同判据；现场文件路径经 `RunCheckOptions.fromPaths` 进来（执行态记录上的
 * `callSiteFile` 也能反推现场文件）。
 *
 * 钉：
 * - 现场文件里的调用点被包在**函数体内** ⇒ 被调方的 check 报告必须带上
 *   `nudo:constraint-violated`（error）+ 归因到被调方的导出名；
 * - 控制组：**不带** `--from` 现场文件 ⇒ 被调方自身报告不含该违例
 *   （不得凭空造证据）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { CheckJson } from "@nudojs/core";
import { dedupeFromStaticIssues, staticFromDomainIssues } from "../check-json-map.ts";
import { runCheck } from "../commands/check.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/**
 * 夹具：
 * - `lib.js` 被调方（导出 `f`）；
 * - `lib.nudo.js` 手写契约侧车（`x > 0`）；
 * - `infn.js` 调用点——调用**被包在函数体内** ⇒ 执行态采集拿不到记录。
 */
function fixture(): { dir: string; lib: string; infn: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug643-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "package.json"),
    `{ "name": "b643", "version": "1.0.0", "type": "module" }`,
    "utf-8",
  );
  writeFileSync(join(dir, "lib.js"), `export function f(x) { return x; }\n`, "utf-8");
  // 侧车的 fn()/number() 构造器是 ambient 绑定 ⇒ 无需 import @nudojs/core
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
  return { dir, lib: join(dir, "lib.js"), infn: join(dir, "infn.js") };
}

/** 被调方报告里的「调用点违例」条目（`--from` 面的跨文件域超限码） */
function violationIssues(json: CheckJson | undefined): CheckJson["issues"] {
  return (json?.issues ?? []).filter((i) => i.code === "nudo:interface-domain-exceeds");
}

/** 最小模块说明符解析：只处理相对说明符（夹具内都是相对路径）⇒ 回**路径** */
function resolveRelative(specifier: string, fromFile: string): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  return join(dirname(fromFile), specifier);
}

/** 最小模块装载器：回**源码**（core 的 loadModule 契约） */
function loadRelative(specifier: string, fromFile: string): string | undefined {
  const p = resolveRelative(specifier, fromFile);
  if (p === undefined) return undefined;
  try {
    return readFileSync(p, "utf-8");
  } catch {
    return undefined;
  }
}

describe("Bug 643 —— --from 的调用点义务按静态判据复核", () => {
  it("静态扫描：函数体内的调用点被判为被调方的调用点违例", () => {
    const { lib, infn } = fixture();
    const issues = staticFromDomainIssues({
      targetPath: lib,
      callsites: [{ path: infn, source: readFileSync(infn, "utf-8") }],
      resolveModule: resolveRelative,
      loadModule: loadRelative,
    });
    expect(issues.length).toBe(1);
    expect(issues[0].severity).toBe("error");
    // 归因到**被调方**的导出名（不是现场文件的本地名）
    expect(issues[0].fn).toBe("f");
  });

  it("runCheck 接线：带 --from 现场文件 ⇒ 被调方报告含 error 级调用点违例", async () => {
    const { lib, infn } = fixture();
    const collected: CheckJson[] = [];
    await runCheck(lib, { json: true, jsonCollect: collected, fromPaths: [infn] });
    const violations = violationIssues(collected[0]);
    expect(violations.length).toBe(1);
    expect(violations[0].severity).toBe("error");
    expect(violations[0].fn).toBe("f");
  });

  it("控制组：不带 --from 现场文件 ⇒ 被调方报告不含该违例（不凭空造证据）", async () => {
    const { lib } = fixture();
    const collected: CheckJson[] = [];
    await runCheck(lib, { json: true, jsonCollect: collected });
    expect(violationIssues(collected[0]).length).toBe(0);
  });

  it("去重：执行态通道已报过的同一处事实不被静态通道重复上报", () => {
    const deduped = dedupeFromStaticIssues(
      [
        {
          severity: "error",
          code: "nudo:interface-domain-exceeds",
          message: "f[x]: cross-file call-site domain evidence -1 exceeds handwritten contract",
          fn: "f",
        },
      ],
      [
        {
          severity: "error",
          code: "nudo:interface-domain-exceeds",
          message: "f[x]: cross-file call-site domain evidence -1 exceeds handwritten contract",
        },
      ],
    );
    expect(deduped.length).toBe(0);
  });
});
