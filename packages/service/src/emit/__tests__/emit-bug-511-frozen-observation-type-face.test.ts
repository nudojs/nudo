// emit-bug-511-frozen-observation-type-face.test.ts — Bug 511：
// `nudo test --freeze` 固化的**无断言**见证**接管了整个函数的返回面**
// ⇒ zod / guard / dts 全变成「单次调用点字面量」，且与 `nudo check` 自相矛盾。
//
// 事实（探针 tmp/probe/fix-r25-s9/engine-511.ts 实测）：
// | 源                                        | combinedAbs（返回面） | cases                        |
// |-------------------------------------------|-----------------------|------------------------------|
// | 无指令（固化前）                          | `number \| string`     | `entry@L1[expected=no]`      |
// | 固化后（**无断言**观测见证 `call@…`）      | **`3`**（单次调用点）  | `call@…[expected=no]`        |
// | 手写断言 `@nudo:case "t" (1,2) => 3`      | `3`（合法）            | `t[expected=yes]`            |
//
// 根因（**已由主 agent 在分析器侧闭环**）：
// - `packages/service/src/analyzer-orchestrate-uncached.ts`
//   无断言的**点观测**见证（实参全是字面量）不再是域声明 ⇒ 该函数仍走
//   entry@/call@ 合成（`SynthCandidate.domainOnly` 隔离其调用点证据），
//   返回面由**推断域**承担 ⇒ 见证不再独占返回面。
// - `packages/service/src/emit/domain-cases.ts`
//   产物面（dts / zod / standard / guard）的域证据只吃「合成证据 +
//   **带断言**的声明」；无断言的 case 指令是见证、不是域声明。
// - `packages/nudojs/src/commands/export.ts`
//   `fn.combinedAbs ?? caseResults[0]?.abs` 的兜底不再拿无断言的观测值当返回面。
//
// ⇒ 本文件从「缺口钉」转为主门禁（`it.fails` 旗标已摘）。
//
// emitter 侧（本分片可写）已保证的性质：固化的见证是**观测**（不带
// `=> expected`），与**断言**在指令文本上可区分 —— 下游据此过滤即可。
import { describe, it, expect } from "vitest";
import { formatShape } from "@nudojs/core";
import { analyzeFile } from "@nudojs/service";
import { buildCaseDirective, insertGeneratedCaseDirectives } from "../case-emitter.ts";

const PATH = "/test/bug-511-type-face.js";

/** 源里某个函数的返回面（combinedAbs 的可读形态） */
function faceOf(source: string): string {
  const result = analyzeFile(PATH, source, undefined, undefined, undefined, "all");
  const fn = result.functions.find((f) => f.name === "add");
  return fn?.combinedAbs ? formatShape(fn.combinedAbs) : "(none)";
}

describe("Bug 511 — 固化的无断言见证不独占返回面", () => {
  it(
    "固化后的无断言观测见证不得独占返回面（返回面由推断域承担）",
    () => {
      // 固化后的源码：一条**无断言**的观测见证
      const frozen = `/**
 * @nudo:case "call@F1usage.js:L2" (1, 2)
 */
export function add(a, b) { return a + b; }
`;
      // 期望：观测见证只是下界证据，返回面仍由函数自身（entry@ 面）承担 ⇒
      // 与固化前、与 `nudo check` 的签名一致。
      expect(faceOf(frozen)).toBe("number | string");
    },
  );

  it("负控制：手写断言（=> 3）合法地定义返回面（修 511 不得动这一条）", () => {
    const asserted = `/**
 * @nudo:case "t" (1, 2) => 3
 */
export function add(a, b) { return a + b; }
`;
    expect(faceOf(asserted)).toBe("3");
  });

  it("负控制：无指令的函数返回面不受影响（entry@ 面）", () => {
    const plain = `export function add(a, b) { return a + b; }
`;
    expect(faceOf(plain)).toBe("number | string");
  });

  it("emitter 侧：固化写出的见证是「观测」而非「断言」（指令里没有 => expected）", () => {
    // 观测：只有实参，没有期望值
    expect(buildCaseDirective("call@F1usage.js:L2", [])).toBe(
      ' * @nudo:case "call@F1usage.js:L2" ()',
    );
    // 断言面由手写指令承担（`=> expected`）——与观测在文本上可区分
    expect(buildCaseDirective("call@F1usage.js:L2", [])).not.toContain("=>");
  });

  it("emitter 侧：固化产物可被 parser 读回，且不带期望值", async () => {
    const { parse, extractDirectives } = await import("@nudojs/parser");
    const source = `export function add(a, b) { return a + b; }
`;
    const analysis = analyzeFile(PATH, source, undefined, undefined, undefined, "all");
    const fn = analysis.functions.find((f) => f.name === "add")!;
    const frozen = insertGeneratedCaseDirectives(
      source,
      {
        ...analysis,
        functions: [
          {
            ...fn,
            entryOnly: false,
            cases: [
              {
                name: "call@F1usage.js:L2",
                argAbs: [],
                abs: fn.cases[0]?.abs ?? { shape: { k: "unknown" }, conf: "partial" },
                throwsAbs: { shape: { k: "never" }, conf: "exact" },
                source: "callsite" as const,
              },
            ],
          },
        ],
      },
    );
    expect(frozen.changed).toBe(true);
    const dirs = extractDirectives(parse(frozen.source))
      .find((f) => f.name === "add")!
      .directives.filter((d) => d.kind === "case");
    expect(dirs).toHaveLength(1);
    // 观测见证不带期望值 ⇒ 下游可据此把它与断言区分开
    expect(dirs[0]!.kind === "case" && dirs[0]!.expected).toBeUndefined();
  });
});
