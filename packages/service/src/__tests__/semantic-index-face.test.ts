/**
 * ADR 0001 阶段 1 · 切片 2/3：service 普查面消费 `@nudojs/core/internal`
 * 绑定索引的接线验收。
 *
 * 切片 3 起 `check` 索引面默认开启，但 service 的**只读快照**仍由独立的
 * `shadowEnabled` 控制：默认不建索引，保证分析热路径零额外遍历。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { setSemanticIndexEntryFace, setSemanticIndexShadow } from "@nudojs/core/internal";
import { parse } from "@nudojs/parser";
import { analyzeFile } from "../analyzer.ts";
import { analysisFileCacheKey } from "../analyzer-cache.ts";
import { resetAllAnalysisCaches } from "../index.ts";
import {
  collectTopLevelFunctions,
  recordServiceEntryFace,
  takeServiceEntryFace,
} from "../analyzer-ast.ts";

/** 形态：service 的对象字面量分支已收到 `a`，两面一致。 */
const DESTRUCTURED = `export const { a } = { a: () => 1 };`;
/** 形态：service 普查为空，索引登记 `m`。 */
const DEFAULT_OBJECT = `export default { m() { return 1; } };`;
const CONTROL = `export function f() { return 1; }`;

const FIXTURES: ReadonlyArray<readonly [string, string]> = [
  ["BUG-015 解构导出", DESTRUCTURED],
  ["BUG-016 default 对象", DEFAULT_OBJECT],
  ["BUG-017 匿名 default 类", `export default class { m() { return 1; } }`],
  ["BUG-023 CJS 类", `module.exports = class C { m() { return 1; } };`],
  ["BUG-024 ESM 类表达式", `export const C = class { m() { return 1; } };`],
];

beforeEach(() => {
  resetAllAnalysisCaches();
  takeServiceEntryFace();
  setSemanticIndexEntryFace(true);
});
afterEach(() => {
  setSemanticIndexShadow(false);
  setSemanticIndexEntryFace(true);
  takeServiceEntryFace();
});

describe("ADR 0001 阶段 1 · service 入口面只读索引", () => {
  it("索引面默认开启但影子关闭：分析管线不构建索引、无快照", () => {
    analyzeFile("/test/face-off.js", DESTRUCTURED);
    expect(takeServiceEntryFace()).toBeUndefined();
  });

  it("显式关回旧面后仍无快照（fallback 不触发只读对照）", () => {
    setSemanticIndexEntryFace(false);
    analyzeFile("/test/face-fallback.js", DESTRUCTURED);
    expect(takeServiceEntryFace()).toBeUndefined();
  });

  it("开启影子后经真实分析管线产出分歧：default 对象成员 m 被索引登记", () => {
    setSemanticIndexShadow(true);
    analyzeFile("/test/face-on.js", DEFAULT_OBJECT);
    const snapshot = takeServiceEntryFace();
    expect(snapshot).toBeDefined();
    expect(snapshot!.indexed).toContain("m");
    expect(snapshot!.added).toContain("m");
  });

  it("控制夹具：service 普查与索引一致，added / missing 均为空", () => {
    setSemanticIndexShadow(true);
    analyzeFile("/test/face-control.js", CONTROL);
    const snapshot = takeServiceEntryFace();
    expect(snapshot!.indexed).toContain("f");
    expect(snapshot!.added).toEqual([]);
    expect(snapshot!.missing).toEqual([]);
  });

  it("recordServiceEntryFace 直接对照：非 File 节点不构建索引", () => {
    setSemanticIndexShadow(true);
    recordServiceEntryFace(parse(CONTROL).program, collectTopLevelFunctions(parse(CONTROL)));
    expect(takeServiceEntryFace()).toBeUndefined();
  });

  it("影子对拍：输出 service 面与索引的分歧清单（不修行为、不设门槛、不设白名单）", () => {
    const rows: string[] = [];
    for (const [label, src] of FIXTURES) {
      const census = collectTopLevelFunctions(parse(src));
      setSemanticIndexShadow(true);
      recordServiceEntryFace(parse(src), census);
      const s = takeServiceEntryFace()!;
      setSemanticIndexShadow(false);
      rows.push(
        `${label.padEnd(26)} census=[${census.map((c) => c.name)}] indexed=[${s.indexed}] +[${s.added}] -[${s.missing}]`,
      );
      // 只输出清单：分歧内容不参与相等断言 ⇒ 不设 CI 失败门槛。
      expect(s.indexed).toEqual(expect.any(Array));
    }
    console.info("[service semantic-index shadow diff]\n" + rows.join("\n"));
  });

  it("索引面 / 旧面切换前后分析结论一致（service 只读，不改普查）", () => {
    const before = analyzeFile("/test/face-compare-off.js", CONTROL);
    setSemanticIndexEntryFace(false);
    const after = analyzeFile("/test/face-compare-on.js", CONTROL);
    expect(after.functions.map((f) => f.name)).toEqual(before.functions.map((f) => f.name));
    expect(after.functions.map((f) => f.paramNames)).toEqual(
      before.functions.map((f) => f.paramNames),
    );
    expect(after.functions.map((f) => f.combinedAbs)).toEqual(
      before.functions.map((f) => f.combinedAbs),
    );
  });

  it("analysisFileCacheKey：索引面 / 旧面两档 auxKey 不互为陈旧命中", () => {
    const on = analysisFileCacheKey("/test/cache-face.js", CONTROL).auxKey;
    const onAgain = analysisFileCacheKey("/test/cache-face.js", CONTROL).auxKey;
    setSemanticIndexEntryFace(false);
    const off = analysisFileCacheKey("/test/cache-face.js", CONTROL).auxKey;
    expect(on).toBe(onAgain);
    expect(off).not.toBe(on);
  });
});
