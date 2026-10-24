/**
 * Bug 344 回归：两条 `@nudo:import` 绑**同一个本地名** ⇒ 静默取后者。
 *
 * 根因：`collectConstraints` 用 `map.set(name, v)`，后写覆盖先写，零冲突
 * 检测零诊断 ⇒ 契约裁决随**行序**翻转（native ESM 是 SyntaxError：模块
 * 根本不装载）。
 *
 * 修法：**拒绝绑定**该本地名（不猜哪条赢——猜错就是静默的假绿/假红）+
 * 报 error 级诊断（nudo:interface-name-clash）。
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  extractRefinesFromSource,
  setRefineDiagCollector,
  takeRefineDiags,
} from "../refine.ts";
import { makeFiles } from "./nudo-constraints.ts";

beforeEach(() => {
  setRefineDiagCollector(null);
  takeRefineDiags();
});

const SRC = `
/// @nudo:import { positive } from "./a.nudo.js"
/// @nudo:import { positive } from "./b.nudo.js"
/**
 * @nudo:contract x positive
 */
export function inc(x) {
  return x + 1;
}
`;

describe("Bug 344: 同名 @nudo:import 绑定", () => {
  it("报 nudo:interface-name-clash 并点名冲突的本地名与两个来源", () => {
    const diags: Array<{ code: string; message: string }> = [];
    setRefineDiagCollector((d) => diags.push(d));
    const { loadModule } = makeFiles({
      "/t/a.nudo.js": `import { number } from "@nudojs/core";\nexport const positive = number().gt(0);\n`,
      "/t/b.nudo.js": `import { number } from "@nudojs/core";\nexport const positive = number().gt(100);\n`,
    });
    extractRefinesFromSource(SRC, "inc", { loadModule, fromFile: "/t/dup.js" });
    const clash = diags.find((d) => d.code === "nudo:interface-name-clash");
    expect(clash).toBeDefined();
    expect(clash?.message).toContain("'positive'");
    expect(clash?.message).toContain("./a.nudo.js");
    expect(clash?.message).toContain("./b.nudo.js");
  });

  it("拒绝绑定冲突的本地名（不静默取后者）→ 契约段拿不到约束", () => {
    const { loadModule } = makeFiles({
      "/t/a.nudo.js": `import { number } from "@nudojs/core";\nexport const positive = number().gt(0);\n`,
      "/t/b.nudo.js": `import { number } from "@nudojs/core";\nexport const positive = number().gt(100);\n`,
    });
    const entries = extractRefinesFromSource(SRC, "inc", {
      loadModule,
      fromFile: "/t/dup.js",
    });
    expect(entries).toHaveLength(0);
  });

  it("不冲突的 import 仍正常绑定", () => {
    const diags: Array<{ code: string; message: string }> = [];
    setRefineDiagCollector((d) => diags.push(d));
    const ok = `
/// @nudo:import { positive } from "./a.nudo.js"
/**
 * @nudo:contract x positive
 */
export function inc(x) {
  return x + 1;
}
`;
    const { loadModule } = makeFiles({
      "/t/a.nudo.js": `import { number } from "@nudojs/core";\nexport const positive = number().gt(0);\n`,
    });
    const entries = extractRefinesFromSource(ok, "inc", {
      loadModule,
      fromFile: "/t/ok.js",
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.param).toBe("x");
    expect(
      diags.some((d) => d.code === "nudo:interface-name-clash"),
    ).toBe(false);
  });
});
