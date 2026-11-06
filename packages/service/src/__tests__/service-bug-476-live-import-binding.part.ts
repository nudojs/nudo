/**
 * Bug 476 —— 跨模块**活绑定**在 service 合并面被快照化。
 *
 * 改前：`mergeHarvestUnderEnv` 用对象展开搬运导出表（`{ ...exports.named }`）
 * ⇒ **求值**了依赖模块导出槽上的活 getter ⇒ 冻结成快照 ⇒ 依赖模块的内部
 * 变异对导入方不可见。
 *
 * 原生真值（真实 JS）：
 *   m.js:  `export let val = 0; export function setStr() { val = "hello"; }`
 *   entry: `import { val, setStr } from "./m.js";
 *           export function get() { setStr(); return val; }` → "hello"
 * 引擎改前给 0（快照）⇒ 类型面与原生不一致。
 */
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { formatShape } from "@nudojs/core";
import { analyzeFile } from "../analyzer.ts";
import { tmpProject } from "./tmp-project.ts";

const M_JS = `export let val = 0;
export function setStr() { val = "hello"; }
`;

function entryShape(files: Record<string, string>, entry: string): string {
  const dir = tmpProject("nudo-bug476-", files);
  const result = analyzeFile(join(dir, entry), files[entry]);
  const fn = result.functions.find((f) => f.name === "get");
  return fn ? formatShape(fn.cases[0].abs) : "<no-fn>";
}

describe("Bug 476 — 跨模块活绑定（依赖内部变异对导入方可见）", () => {
  it("依赖模块内部改写导出值后，导入方读到当前值", () => {
    const shape = entryShape(
      { "m.js": M_JS, "entry.js": `import { val, setStr } from "./m.js";
export function get() { setStr(); return val; }
` },
      "entry.js",
    );
    // 改前：0（合并面把活 getter 求值成了快照）
    expect(shape).toBe('"hello"');
  });

  it("变异前的读取仍是精确初值（不被前一次调用的残留污染）", () => {
    const shape = entryShape(
      { "m.js": M_JS, "entry.js": `import { val } from "./m.js";
export function get() { return val; }
` },
      "entry.js",
    );
    expect(shape).toBe("0");
  });
});

/** 负控制：不该被这条修复波及的邻近形态 */
describe("Bug 476 — 负控制", () => {
  it("依赖未改写导出值时，导入方读到初值", () => {
    const shape = entryShape(
      { "m.js": M_JS, "entry.js": `import { val, setStr } from "./m.js";
export function get() { return val; }
` },
      "entry.js",
    );
    expect(shape).toBe("0");
  });

  it("同文件内的模块级状态读写不受影响", () => {
    const dir = tmpProject("nudo-bug476-neg-");
    const source = `let n = 0;
export function bump() { n = n + 1; return n; }
export function read() { return n; }
`;
    const result = analyzeFile(join(dir, "same.js"), source);
    const bump = result.functions.find((f) => f.name === "bump");
    const read = result.functions.find((f) => f.name === "read");
    expect(bump ? formatShape(bump.cases[0].abs) : "").toBe("1");
    expect(read ? formatShape(read.cases[0].abs) : "").toBe("0");
  });
});
