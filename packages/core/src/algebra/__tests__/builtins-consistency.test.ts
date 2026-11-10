/**
 * ABS-06：内建一致性门禁（host oracle 矩阵）。
 *
 * 门禁：**covered 集合内 wrong-exact = 0**（假精确是唯一门禁项；unknown
 * 保持诚实，不以 100% 覆盖为目标）。报告是生成物（`docs/reports/
 * builtins-consistency.md`），本测试同时钉住它与矩阵同源（freshness）。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  renderMatrixReport,
  runMatrix,
} from "./builtins-consistency-matrix.ts";

const here = dirname(fileURLToPath(import.meta.url));
const reportPath = resolve(here, "../../../../../docs/reports/builtins-consistency.md");

describe("ABS-06 builtin consistency matrix", () => {
  const result = runMatrix();

  it("covered 集合内 wrong-exact = 0（假精确为 0；unknown 诚实保留）", () => {
    const bad = result.rows.filter((r) => r.verdict === "wrong-exact");
    expect(bad.map((r) => `${r.name}: native=${r.native} engine=${r.engine ?? "—"}`)).toEqual(
      [],
    );
  });

  it("覆盖下限（防矩阵静默萎缩）：total ≥ 60 且 modeled ≥ 80%", () => {
    expect(result.total).toBeGreaterThanOrEqual(60);
    expect(result.counts.modeled / result.total).toBeGreaterThanOrEqual(0.8);
  });

  it("关键行分类钉住（诚实 unknown 不得被伪造成 modeled）", () => {
    const byName = new Map(result.rows.map((r) => [r.name, r]));
    expect(byName.get("json.parse-plain")?.verdict).toBe("modeled");
    expect(byName.get("json.parse-reviver")?.verdict).toBe("unknown");
    // 模板标签对象：实际已建模（计划里的「仍标未建模」是陈旧说法）——
    // 矩阵把这一事实钉住，避免文档继续宣称未知。
    expect(byName.get("template-tag-isarray")?.verdict).toBe("modeled");
    expect(byName.get("template-tag-join")?.verdict).toBe("modeled");
    expect(byName.get("intl.numberformat")?.verdict).toBe("unknown");
    // 抛域探针：原生抛 ⇒ 引擎同抛（modeled），不得给具体值/声称不会抛
    for (const name of ["throw.json-parse-bad", "throw.uint8-negative", "throw.array-reduce-empty"]) {
      expect(byName.get(name)?.verdict, name).toBe("modeled");
    }
  });

  it("报告是生成物：磁盘内容与矩阵渲染逐字节一致（freshness）", () => {
    const text = readFileSync(reportPath, "utf-8");
    expect(text).toBe(renderMatrixReport(result));
  });
});
