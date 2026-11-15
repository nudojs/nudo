/**
 * BUG-069 —— `nudo test --freeze`（默认 `add` 模式）**不幂等**：固化把 JSDoc 块
 * 插到函数声明之上 ⇒ 同一调用点的行号整体下移 ⇒ 见证名 `call@L6` → `call@L9`
 * ⇒ 「已固化」判定（只比名字）命中不了 ⇒ 再写一条语义重复的 `@nudo:case`
 * ⇒ 源码每跑一次长一条（无界增长），且 `--freeze --dry-run --exit-on-diff`
 * 第二次就 exit 1（CI 假红）。
 *
 * 判据：见证等价判定不能只看名字 —— 实参载荷（经指令文法规范化）相同即同一条
 * 见证 ⇒ 第二次固化是 **no-op**（跳过原因 `already-generated`）。
 *
 * 本钉按**真实 CLI 路径**建模：第二次插入的 analysis 来自**改写后的源码**
 * （行号已漂），而不是复用第一次的 analysis（那会因名字仍相同而假绿）。
 */
import { describe, it, expect } from "vitest";
import { analyzeFile } from "@nudojs/service";
import {
  insertGeneratedCaseDirectives,
  serializeCaseArgs,
  buildCaseDirective,
} from "../case-emitter.ts";

const SOURCE = `export function double(n) {
  return n * 2;
}

export function caller() {
  return double(3);
}
`;

/** 源码里 `@nudo:case` 指令条数 */
function caseCount(source: string): number {
  return (source.match(/@nudo:case/g) ?? []).length;
}

describe("BUG-069 —— 二次固化必须是被行号漂移免疫的 no-op", () => {
  it("第二次固化（重新分析改写后的源码）不再写重复指令", () => {
    const first = insertGeneratedCaseDirectives(SOURCE, analyzeFile("/t/one.js", SOURCE));
    expect(first.written.length).toBe(1);
    expect(caseCount(first.source)).toBe(1);

    // 关键：第二次的 analysis 来自**改写后的源码**（调用点行号已下移）
    const second = insertGeneratedCaseDirectives(
      first.source,
      analyzeFile("/t/one.js", first.source),
    );
    expect(second.written).toEqual([]);
    expect(second.source).toBe(first.source);
    expect(caseCount(second.source)).toBe(1);
    expect(second.skipped).toContainEqual({ fn: "double", reason: "already-generated" });
  });

  it("第三、四次固化同样 no-op（源码不再增长）", () => {
    let source = SOURCE;
    for (let i = 0; i < 4; i++) {
      const out = insertGeneratedCaseDirectives(source, analyzeFile("/t/one.js", source));
      if (i === 0) {
        expect(out.written.length).toBe(1);
      } else {
        expect(out.source).toBe(source);
      }
      source = out.source;
    }
    expect(caseCount(source)).toBe(1);
    expect(source).toBe(
      `/**
 * @nudo:case "call@L6" (3)
 */
` + SOURCE,
    );
  });

  it("同实参、不同名字的见证不重复写（两个调用点传同样的值）", () => {
    const src = `export function double(n) {
  return n * 2;
}

export function caller() {
  return double(3);
}

export function caller2() {
  return double(3);
}
`;
    const out = insertGeneratedCaseDirectives(src, analyzeFile("/t/two.js", src));
    expect(out.written.length).toBe(1);
    expect(caseCount(out.source)).toBe(1);
  });

  it("不同实参的见证仍然各自落地（不误合并）", () => {
    const src = `export function double(n) {
  return n * 2;
}

export function caller() {
  return double(3);
}

export function caller2() {
  return double(4);
}
`;
    const out = insertGeneratedCaseDirectives(src, analyzeFile("/t/three.js", src));
    expect(out.written.length).toBe(1);
    expect(caseCount(out.source)).toBe(2);
    expect(out.source).toContain("(3)");
    expect(out.source).toContain("(4)");
  });

  it("`serializeCaseArgs` 是载荷口径的唯一真源（buildCaseDirective 复用它）", () => {
    const abs = analyzeFile("/t/one.js", SOURCE).functions[0]!.cases[0]!.argAbs!;
    expect(buildCaseDirective("call@L1", abs)).toBe(
      ` * @nudo:case "call@L1" (${serializeCaseArgs(abs)})`,
    );
  });
});
