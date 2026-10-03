/**
 * findEnclosingCall（P-IDE7）：@babel/traverse 实现 + 完整区间参数下标。
 *
 * 旧手写 visitor 的两处缺陷：
 * - 区间判定只比行号（同行调用尾误命中）；
 * - paramIndex 只看参数 start（跨行参数被「start 在前 → +1」误判）。
 */
import { describe, it, expect } from "vitest";
import { parse } from "@nudojs/parser";
import { findEnclosingCall } from "../server-ide.ts";

const MULTI_LINE = [
  "export function call(a, b, c) { return a; }", // 1
  "export function use() {", // 2
  "  return call(", // 3
  "    1,", // 4
  "    2,", // 5
  "    3,", // 6
  "  );", // 7
  "}", // 8
].join("\n");

const SINGLE_LINE = "export function use() { return call(11, 22); }\n";

/** 1-based line、0-based column（LSP handler 同口径） */
function at(src: string, line: number, column: number) {
  return findEnclosingCall(parse(src), line, column);
}

describe("findEnclosingCall (P-IDE7)", () => {
  it("multi-line args: cursor inside arg i selects param i (old visitor said i+1)", () => {
    // line 4 `    1,`：`1` 区间 [4,5)。旧实现按「start 在 cursor 前 → +1」
    // 判成 1（跨行场景全错）；新实现按完整区间 → 0。
    expect(at(MULTI_LINE, 4, 4)).toMatchObject({
      calleeLine: 3,
      calleeCol: 9,
      currentParamIndex: 0,
    });
    expect(at(MULTI_LINE, 5, 4)?.currentParamIndex).toBe(1);
    expect(at(MULTI_LINE, 6, 4)?.currentParamIndex).toBe(2);
  });

  it("trailing comma: cursor after the last arg selects arity (not beyond)", () => {
    // line 6 (`    3,`)：`3` 区间 [4,5)，逗号 col 5 之后全是「已越过末参」
    expect(at(MULTI_LINE, 6, 6)?.currentParamIndex).toBe(3);
    expect(at(MULTI_LINE, 6, 6)?.currentParamIndex).toBeLessThanOrEqual(3);
  });

  it("cursor before first arg (right after '(') selects param 0", () => {
    // line 3 `  return call(`：`(` col 13，cursor col 14 在首参之前
    expect(at(MULTI_LINE, 3, 14)?.currentParamIndex).toBe(0);
  });

  it("single line: between args (on comma) selects the next param", () => {
    // `call(11, 22)`：11 区间 [36,38)，逗号 col 38，22 区间 [40,42)，`)` col 42
    expect(at(SINGLE_LINE, 1, 36)?.currentParamIndex).toBe(0); // 11 内
    expect(at(SINGLE_LINE, 1, 38)?.currentParamIndex).toBe(1); // 逗号上
    expect(at(SINGLE_LINE, 1, 40)?.currentParamIndex).toBe(1); // 22 内
    expect(at(SINGLE_LINE, 1, 42)?.currentParamIndex).toBe(2); // 22 结尾（`)` 处）
  });

  it("nested calls keep outermost-first semantics (parity with old visitor)", () => {
    const nested = "export function use() { return call(call(1, 2), 3); }\n";
    // 光标在内层 call 的参数 `2`（col 44）上：旧 visitor 取外层（首个命中即停），
    // 保持一致——外层 callee col 31，内层调用表达式是外层第 0 参
    const hit = at(nested, 1, 44);
    expect(hit).toMatchObject({ calleeLine: 1, calleeCol: 31 });
    expect(hit?.currentParamIndex).toBe(0);
  });

  it("positions outside any call yield null; same-line-after-call no longer false-matches", () => {
    expect(at(MULTI_LINE, 1, 6)).toBeNull(); // 函数声明行，无调用包含
    expect(at("const x = 1;\n", 1, 4)).toBeNull();
    // 旧实现只比行号：`call(11, 22); }` 尾部同行会误命中；新实现含列判定
    expect(at(SINGLE_LINE, 1, 44)).toBeNull();
  });
});
