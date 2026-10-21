/**
 * Bug 491：`export *` barrel 吞掉 `--from` 采集到的跨文件调用点证据 ⇒
 * `nudo:interface-domain-exceeds`（error 级 L1 门禁）静默不报（假绿）。
 *
 * 根因（analyzer-abs-eval.ts 的调用记录归因）：targetModule 填的是**调用方
 * import 的那个模块**——barrel 场景下那是中间 barrel，不是定义文件；归因
 * 判据要求 targetModule 逐字等于被检查文件 ⇒ barrel 转出的记录永远配不上
 * 定义文件 ⇒ 越界证据蒸发。
 *
 * 修法：归因沿**再导出链**解引用到真正定义该绑定的模块（`export * from` /
 * `export { x } from` / `import + export { x }`）。
 *
 * 钉：barrel 形态与直接 import 形态**报同一门禁**；负控制：别处的记录不得
 * 在本文件报门禁；解析不出定义位点时回落 import 目标（不猜、不崩）。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { analyzeFile, collectCallRecords } from "../analyzer.ts";
import { litValue } from "@nudojs/core";
import { withTmpProject, writeTmpFile } from "./tmp-project.ts";

const DOMAIN = "nudo:interface-domain-exceeds";

const LIB = `export function area(x) {
  return x;
}
`;
const SIDECAR = `import { fn, number } from "@nudojs/core";
export const area = fn({ x: number().gt(0) });
`;

describe("Bug 491：再导出链归因（barrel 不再吞掉跨文件调用点证据）", () => {
  it("export * barrel：记录归因到定义文件，domain-exceeds 门禁照报", () =>
    withTmpProject("nudo-b491-", (dir) => {
      const lib = writeTmpFile(dir, "lib.js", LIB);
      writeTmpFile(dir, "lib.nudo.js", SIDECAR);
      writeTmpFile(dir, "barrel.js", 'export * from "./lib.js";\n');
      const use = writeTmpFile(
        dir,
        "use-barrel.js",
        'import { area } from "./barrel.js";\narea(-1);\n',
      );

      const records = collectCallRecords(use, readFileSync(use, "utf-8"));
      const rec = records.find((r) => r.fnName === "area");
      expect(rec).toBeDefined();
      // 归因到**定义文件**（此前是中间 barrel → 门禁证据蒸发）
      expect(rec!.targetModule).toBe(lib);
      expect(litValue(rec!.argAbs[0]!).value).toBe(-1);

      const result = analyzeFile(lib, LIB, undefined, records);
      const issues = result.diagnostics.filter((d) => d.code === DOMAIN);
      expect(issues).toHaveLength(1);
      expect(issues[0]!.severity).toBe("error");
      expect((issues[0]!.data as { actual?: string }).actual).toBe("-1");
    }));

  it("改名再导出 barrel（export { area as area2 }）：记录名跟到定义侧导出名", () =>
    withTmpProject("nudo-b491b-", (dir) => {
      const lib = writeTmpFile(dir, "lib.js", LIB);
      writeTmpFile(dir, "lib.nudo.js", SIDECAR);
      writeTmpFile(dir, "barrel.js", 'export { area as area2 } from "./lib.js";\n');
      const use = writeTmpFile(
        dir,
        "use-barrel.js",
        'import { area2 } from "./barrel.js";\narea2(-1);\n',
      );

      const records = collectCallRecords(use, readFileSync(use, "utf-8"));
      const rec = records.find((r) => r.fnName === "area2");
      expect(rec).toBeDefined();
      expect(rec!.targetModule).toBe(lib);
      expect(rec!.targetExport).toBe("area");

      const result = analyzeFile(lib, LIB, undefined, records);
      const issues = result.diagnostics.filter((d) => d.code === DOMAIN);
      expect(issues).toHaveLength(1);
      expect(issues[0]!.severity).toBe("error");
    }));

  it("负控制：直接 import（无 barrel）行为不变——门禁照报", () =>
    withTmpProject("nudo-b491c-", (dir) => {
      const lib = writeTmpFile(dir, "lib.js", LIB);
      writeTmpFile(dir, "lib.nudo.js", SIDECAR);
      const use = writeTmpFile(
        dir,
        "use-direct.js",
        'import { area } from "./lib.js";\narea(-1);\n',
      );
      const records = collectCallRecords(use, readFileSync(use, "utf-8"));
      const rec = records.find((r) => r.fnName === "area");
      expect(rec!.targetModule).toBe(lib);
      const result = analyzeFile(lib, LIB, undefined, records);
      expect(result.diagnostics.filter((d) => d.code === DOMAIN)).toHaveLength(1);
    }));

  it("负控制：别处的记录不得在本文件报门禁（跨文件污染守卫）", () =>
    withTmpProject("nudo-b491d-", (dir) => {
      const lib = writeTmpFile(dir, "lib.js", LIB);
      writeTmpFile(dir, "lib.nudo.js", SIDECAR);
      const other = writeTmpFile(dir, "other.js", "export function other(x) { return x; }\n");
      const result = analyzeFile(lib, LIB, undefined, [
        {
          fnName: "other",
          argAbs: [{ shape: { k: "prim", type: "number" }, term: { op: "lit", value: -1 }, conf: "exact" }],
          resultAbs: { shape: { k: "prim", type: "number" }, conf: "exact" },
          throwsAbs: { shape: { k: "never" }, conf: "exact" },
          targetModule: other,
          targetExport: "other",
        },
      ]);
      expect(result.diagnostics.filter((d) => d.code === DOMAIN)).toHaveLength(0);
    }));

  it("负控制：模块未导出该名 → 回落 import 目标（不猜、不崩）", () =>
    withTmpProject("nudo-b491e-", (dir) => {
      const barrel = writeTmpFile(dir, "barrel.js", "export const other = 1;\n");
      const use = writeTmpFile(
        dir,
        "use.js",
        'import { area } from "./barrel.js";\narea(-1);\n',
      );
      const records = collectCallRecords(use, readFileSync(use, "utf-8"));
      const rec = records.find((r) => r.fnName === "area");
      expect(rec).toBeDefined();
      // 解析不出定义位点 → 保持 import 目标（不静默丢弃记录）
      expect(rec!.targetModule).toBe(barrel);
      expect(rec!.targetExport).toBe("area");
    }));
});
