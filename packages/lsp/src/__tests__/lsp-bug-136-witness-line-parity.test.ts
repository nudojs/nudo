/**
 * Bug 136 —— LSP codeLens 标题与 CLI `nudo test` 见证行**不同形**。
 *
 * 症状（同文件、同分析，两面并排）：
 * - CLI `nudo test` 见证行：`"  entry@L1  (any) => unknown   throws TypeError"`
 *   （2 格容器缩进 + throws 前 **3** 空格）；
 * - LSP lens 标题：`"entry@L1  (any) => unknown  throws TypeError"`
 *   （无容器缩进 + throws 前 **2** 空格）。
 *
 * `agent-tools.ts` 的注释明文承诺「**标题与 test 报告同形**」⇒ 同一事实
 * 两面渲染不一致（非 throws 分支当时是一致的，只有 throws 分支分裂）。
 *
 * 修法：LSP 的 `observationTitle` 与 CLI 的 `formatCaseLine` 采用同一模板
 * （throws 前 3 空格；lens 标题不带容器缩进，CLI 报告在 `caseLines.push` 处加
 * 2 空格）⇒ 比对口径 = `"  " + lens.title`。
 *
 * 钉（同一 fixture、两条**产品**路径，不 spawn CLI）：
 * - CLI 侧：`buildTestReport(file, analyzeFileAsync(...))` 的 `caseLines`；
 * - LSP 侧：`computeObservationLenses(source, file)` 的 `title`；
 * ⇒ 逐字符相等：`caseLines` 含 `"  " + lens.title`（且反向：每条
 * `call@` / `entry@` 见证行都有同标题的 lens）。
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeFileAsync } from "@nudojs/service";
import { buildTestReport } from "../../../nudojs/src/run-test.ts";
import { computeObservationLenses } from "../agent-tools.ts";

/** `tmp/repro/bug-136/half.js` 逐字内容 */
const HALF_SRC = `export function f(x) {
  return x.a.b;
}
f(undefined);
`;

describe("Bug 136 — codeLens 标题与 CLI nudo test 见证行逐字符同形", () => {
  it("每条 lens 标题在 CLI 报告里是 `  <title>`；throws 分支为 3 空格", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug136-"));
    try {
      const file = join(dir, "half.js");
      writeFileSync(file, HALF_SRC, "utf-8");

      const result = await analyzeFileAsync(
        file,
        HALF_SRC,
        undefined,
        undefined,
        undefined,
        "all",
      );
      const report = buildTestReport(file, result);
      const lenses = computeObservationLenses(HALF_SRC, file);

      const titles = lenses.map((l) => l.title);
      expect(titles.length, `lenses 为空 ⇒ 无法对拍`).toBeGreaterThan(0);

      // ① LSP → CLI：每条 lens 标题在报告里逐字符命中（含 2 格容器缩进）
      for (const lens of lenses) {
        expect(
          report.caseLines,
          `lens 标题不在 test 报告里：${JSON.stringify(lens.title)}`,
        ).toContain(`  ${lens.title}`);
      }

      // ② CLI → LSP：报告里每条 call@ / entry@ 见证行都有同标题的 lens
      const witnessLines = report.caseLines.filter((l) => /^ {2}(call@|entry@)/.test(l));
      expect(witnessLines.length).toBeGreaterThan(0);
      for (const line of witnessLines) {
        expect(titles, `报告见证行没有对应 lens：${JSON.stringify(line)}`).toContain(
          line.slice(2),
        );
      }

      // ③ throws 分支的绝对形态：`=> unknown` 与 `throws TypeError` 之间 3 空格
      const throwsLens = lenses.find((l) => l.title.includes("throws"));
      expect(throwsLens, `没有 throws 见证：${JSON.stringify(titles)}`).toBeDefined();
      expect(throwsLens!.title).toContain("=> unknown   throws TypeError");
      // 改前是 2 空格 ⇒ 这条断言把形态钉死（不靠两面互相自证）
      expect(throwsLens!.title).not.toContain("unknown  throws");
      // lens 标题不带容器缩进；报告行 = 2 空格 + 标题
      expect(throwsLens!.title.startsWith("entry@")).toBe(true);
      expect(report.caseLines).toContain(`  ${throwsLens!.title}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
