/**
 * Bug 910：跨文件**再导出链**被中间模块里一个**未导出的同名本地函数**
 * 短路 ⇒ 被再导出的函数的契约静默失效 ⇒ 真实违约不报（L1 门禁假绿）。
 *
 * 根因：`resolveExportSource` 的短路判据是「源码里出现过这个名字」
 * （listTopFunctions 含**未导出**的本地函数）⇒ 未导出的本地函数被误判成
 * 「该导出名由本模块定义」⇒ 再导出链从不再往下跳。
 * ESM 规则：未导出的本地绑定对模块导出表没有任何影响。
 *
 * 钉住：短路判据 = 「本模块**导出**了这个名字」（localNamedExports）：
 * - 星号再导出 + 同名未导出本地函数 ⇒ 继续往下跳（拿到 dd.js 的定义）
 * - 命名再导出 + 同名未导出本地函数 ⇒ 同上
 * - 端到端：调用点报 nudo:constraint-violated
 */
import { describe, it, expect, beforeEach } from "vitest";
import { resolveExportSource } from "../scan-call-graph.ts";
import { checkSource, pTrue } from "../index.ts";
import { resetCheckSourceMemo } from "../check.ts";
import { makeFiles } from "./nudo-constraints.ts";

const DD = `/// @nudo:import { positive } from "./c.nudo.js"
/**
 * @nudo:contract x positive
 */
export function g(x) { return x; }
`;

const CC_STAR = `function g(x) { return x * 2; }\nexport * from "./dd.js";\n`;
const CC_NAMED = `function g(x) { return x * 2; }\nexport { g } from "./dd.js";\n`;

const CNUDO = `import { number } from "@nudojs/core";
export const positive = number().gt(0);
`;

const MAIN = `import { g } from "./cc.js";
g(0);
`;

describe("Bug 910 再导出链不被未导出的同名本地函数短路", () => {
  beforeEach(() => {
    resetCheckSourceMemo();
  });

  it("resolveExportSource：星号再导出 + 同名未导出本地函数 ⇒ 跳到 dd.js", () => {
    const r = resolveExportSource(
      CC_STAR,
      "g",
      (spec: string) => (spec === "./dd.js" ? DD : undefined),
      0,
      "/t/cc.js",
      "/t/cc.js",
    );
    expect(r.source).toBe(DD);
    expect(r.fromFile).toBe("/t/dd.js");
  });

  it("resolveExportSource：命名再导出 + 同名未导出本地函数 ⇒ 跳到 dd.js", () => {
    const r = resolveExportSource(
      CC_NAMED,
      "g",
      (spec: string) => (spec === "./dd.js" ? DD : undefined),
      0,
      "/t/cc.js",
      "/t/cc.js",
    );
    expect(r.source).toBe(DD);
    expect(r.fromFile).toBe("/t/dd.js");
  });

  it("端到端：跨再导出链的调用点报 nudo:constraint-violated", () => {
    const { loadModule } = makeFiles({
      "/t/c.nudo.js": CNUDO,
      "/t/dd.js": DD,
      "/t/cc.js": CC_STAR,
    });
    const r = checkSource("/t/main.js", MAIN, pTrue, { loadModule, fromFile: "/t/main.js" });
    const violated = r.issues.filter((i) => i.code === "nudo:constraint-violated");
    expect(violated.length).toBe(1);
    expect(r.ok).toBe(false);
  });
});
