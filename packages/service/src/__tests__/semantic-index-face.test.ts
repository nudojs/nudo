/**
 * ADR 0001 阶段 1 · 切片 2/3：service 普查面消费 `@nudojs/core/internal`
 * 绑定索引的接线验收。
 *
 * 切片 3 起 `check` 索引面默认开启，但 service 的**只读快照**仍由独立的
 * `shadowEnabled` 控制：默认不建索引，保证分析热路径零额外遍历。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { checkSource, pTrue } from "@nudojs/core";
import {
  buildSemanticIndex,
  listTopFunctions,
  setSemanticIndexEntryFace,
  setSemanticIndexShadow,
} from "@nudojs/core/internal";
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
/** 形态：BUG-108 后 service 普查也收 default 对象成员 `m`，两面一致。 */
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

  it("default 对象成员 m：索引与 service 普查同面（旧版普查遗漏，阴影会报分歧）", () => {
    setSemanticIndexShadow(true);
    analyzeFile("/test/face-on.js", DEFAULT_OBJECT);
    const snapshot = takeServiceEntryFace();
    expect(snapshot).toBeDefined();
    expect(snapshot!.indexed).toContain("m");
    expect(snapshot!.added).not.toContain("m");
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

describe("对象字面量展开的 last-wins / const-only 口径（索引面与普查同面）", () => {
  const indexEntries = (src: string): readonly string[] => buildSemanticIndex(parse(src)).entries;

  it("spread 之后的非可调用覆盖 ⇒ helper 不进入口表，other 保留", () => {
    const entries = indexEntries(`const base = { helper() { return 1; }, other() { return 3; } };
export const api = { ...base, helper: 42 };
`);
    expect(entries).not.toContain("helper");
    expect(entries).toContain("other");
  });

  it("spread 之后的同名对象方法覆盖前者：helper 只登记一次", () => {
    const entries = indexEntries(`const base = { helper() { return 1; } };
export const api = { ...base, helper() { return 2; } };
`);
    expect(entries.filter((n) => n === "helper")).toHaveLength(1);
  });

  it("let/var 对象的初值不入索引：重赋值后 stale / fresh 都不登记", () => {
    const entries = indexEntries(`let base = { stale() { return 1; } };
base = { fresh() { return 2; } };
export const api = { ...base };
`);
    expect(entries).not.toContain("stale");
    expect(entries).not.toContain("fresh");
  });

  it("checkSource 签名面不残留 stale / helper（index ∪ 旧面补齐无陈旧入口）", () => {
    const stale = checkSource(
      "/t/face-stale.js",
      `let base = { stale() { return 1; } };
base = { fresh() { return 2; } };
export const api = { ...base };
`,
      pTrue,
      { fromFile: "/t/face-stale.js" },
    );
    expect(stale.signatures.map((s) => s.name)).not.toContain("stale");

    const overridden = checkSource(
      "/t/face-override.js",
      `const base = { helper() { return 1; }, other() { return 3; } };
export const api = { ...base, helper: 42 };
export function h() { return api.helper(); }
`,
      pTrue,
      { fromFile: "/t/face-override.js" },
    );
    const names = overridden.signatures.map((s) => s.name);
    expect(names).not.toContain("helper");
    expect(names).toContain("other");
  });
});

describe("计算成员键：core 扫描面与服务普查面同名（BUG-385 共享索引）", () => {
  const SRC = `const k = "dyn";
const n = 2;
export class C {
  [k]() { return 1; }
  "str"() { return 2; }
  [n]() { return 3; }
  static s() { return 4; }
  plain() { return 5; }
}
`;

  it("字面量 const 计算键 / 字符串键 / 数字键 / 静态方法两面一致", () => {
    const core = listTopFunctions(SRC);
    const service = collectTopLevelFunctions(parse(SRC)).map((f) => f.name);
    expect(service).toEqual(core);
    expect(core).toEqual(["C.dyn", "C.str", "C.2", "C.s", "C.plain"]);
  });

  it("动态计算键（非字面量 const）仍不进任何一面", () => {
    const src = `let k = "dyn";
export class C { [k]() { return 1; } plain() { return 2; } }
`;
    const core = listTopFunctions(src);
    const service = collectTopLevelFunctions(parse(src)).map((f) => f.name);
    expect(core).not.toContain("C.dyn");
    expect(service).toEqual(core);
  });
});
