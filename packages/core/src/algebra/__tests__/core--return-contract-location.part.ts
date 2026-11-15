/**
 * Bug 369 回归钉 —— 返回契约类诊断**不带 `line` / `column`** ⇒ LSP 把诊断画在
 * **第 1 行第 0 列**、vite 打印 `:1:0`、JSON 里 `line=null`。
 *
 * 根因（族 07 片 S4 实测）：`checkReturnConstraint` 的 `push` 构造 issue 时只带
 * `fn`，**位置信息在 issue 构造处就丢了** ⇒ 消费面（LSP / vite / GHA / GitLab /
 * JSON）一律兜底到首行。**不是**消费面算错（同一文件里带位置的
 * `nudo:entry-may-throw` 定位正确）。
 *
 * 修法：issue 构造处补上**被违约函数的声明位置**（line 1 基 / column 0 基，
 * 与 core 其它 issue 同口径 ⇒ 消费面各自换算）。
 *
 * 钉：函数在第 10 行 ⇒ 返回契约违例的 issue 必须带 `line: 10` / `column: 7`
 * （改前 `line` / `column` 皆 undefined ⇒ 反向闸红）。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";

/** 前 9 行是注释 ⇒ 函数声明落在第 10 行（与 tmp/probe/fix-r57/fx/gha/h.js 同形） */
const SRC = `// line 1
// line 2
// line 3
// line 4
// line 5
// line 6
// line 7
// line 8
// line 9
export function deep(x) {
  return x - 1;
}
`;

/** 侧车：`deep` 的返回契约 `number().gt(0)`（`x - 1` 违例） */
const sidecar = `import { fn, number } from "@nudojs/core";
export const deep = fn({ x: number().gt(0) }, number().gt(0));
`;

const opts = {
  loadModule: (spec: string): string | undefined =>
    spec.endsWith(".nudo.js") ? sidecar : undefined,
  fromFile: "/t/bug369.js",
};

describe("Bug 369 — 返回契约类诊断带 line/column", () => {
  it("L1 违例 issue 带函数声明位置（不得是首行 / 不得缺字段）", () => {
    const r = checkSource("/t/bug369.js", SRC, pTrue, opts);
    const violated = r.issues.find((i) => i.code === "nudo:constraint-violated");
    expect(violated).toBeDefined();
    expect(violated!.line).toBe(10);
    expect(violated!.column).toBe(7);
  });

  it("返回契约**证得**时的公理审计标注也带位置", () => {
    const src = `// 1
// 2
// 3
// 4
// 5
// 6
// 7
// 8
// 9
/**
 * @nudo:assume d <= max
 */
export function sim(d, max) {
  return max === 0 ? 1 : 1 - d / max;
}
`;
    const sc = `import { fn, number } from "@nudojs/core";
export const sim = fn({ d: number().ge(0), max: number().ge(1) }, number().ge(0).le(1));
`;
    const r = checkSource(
      "/t/bug369-info.js",
      src,
      pTrue,
      {
        loadModule: (spec: string): string | undefined =>
          spec.endsWith(".nudo.js") ? sc : undefined,
        fromFile: "/t/bug369-info.js",
      },
    );
    const relied = r.issues.find((i) => i.code === "nudo:assume-relied");
    expect(relied).toBeDefined();
    expect(relied!.line).toBe(13);
    expect(relied!.column).toBe(7);
  });
});
