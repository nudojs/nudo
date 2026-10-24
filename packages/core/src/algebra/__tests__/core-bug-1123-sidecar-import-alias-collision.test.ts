/**
 * Bug 1123 —— 侧车 import **别名**与注入的 builder 声明冲突 ⇒ 整个 sidecar
 * 装载失败（SyntaxError）⇒ 该文件的全部契约静默丢失（门禁假绿 + 产物面退化）。
 *
 * 根因（packages/core/src/algebra/refine.ts）：
 *   侧车求值包装器在外层作用域声明**全部** builder 名
 *   （`const { number, string, … } = __nudoInjects;`），而 prologue 用 `var`
 *   在**同一外层作用域**绑定显式 import 的本地名
 *   （`import { number as string }` ⇒ `var string = __nudoInjects["number"];`）
 *   ⇒ `const string` + `var string` 同作用域 ⇒ SyntaxError
 *   「Identifier 'string' has already been declared」⇒ 侧车根本装载不了。
 *
 * 修法：把**显式导入的本地名**从 ambient builder 声明中排除（用户显式
 * 导入的名字由 import 绑定，ambient 解构不得再声明同名）。
 *
 * 本文件钉住：
 * - 裸包名别名（`number as string`）⇒ 侧车装载成功、契约照常绑定；
 * - 相对侧车别名（`positive as number`）⇒ 同上；
 * - 别名侧车的约束**真的生效**（case 违例可见）——不得只是「不报错」的假绿。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { resetCheckSourceMemo } from "../check.ts";
import { resetGeneralizeMemo } from "../generalize.ts";
import { resetNudoModuleExecCache, takeRefineDiags } from "../refine.ts";
import { resetSidecarLoadFailureCache, takeInterfaceDiags } from "../interface.ts";
import { resetParseSourceCache } from "../parse-source.ts";
import { resetAbsCallBudget, resetEvalForkBudget } from "../call-budget.ts";
import { makeFiles } from "./nudo-constraints.ts";

beforeEach(() => {
  resetCheckSourceMemo();
  resetGeneralizeMemo();
  resetNudoModuleExecCache();
  resetSidecarLoadFailureCache();
  resetParseSourceCache();
  resetAbsCallBudget();
  resetEvalForkBudget();
  takeRefineDiags();
  takeInterfaceDiags();
});

/** 带 case 的源码：case 违例可见 ⇒ 证明契约真的绑上了（不只是「没报错」） */
const SRC = `
/**
 * @nudo:case "neg" (-5)
 */
export function f(x) {
  return x;
}
`;

describe("Bug 1123: 侧车 import 别名不得与 ambient builder 声明撞名", () => {
  it("裸包别名（number as string）⇒ 侧车装载成功、契约生效", () => {
    const { loadModule } = makeFiles({
      "/t/alias.nudo.js":
        `import { number as string, fn } from "@nudojs/core";\n` +
        `export const f = fn({ x: string().gt(0) }, number());`,
    });
    const r = checkSource("/t/alias.js", SRC, pTrue, { loadModule, fromFile: "/t/alias.js" });
    // 装载失败（SyntaxError）会被报成 nudo:interface-load —— 修复后不得出现
    expect(r.issues.filter((i) => i.code === "nudo:interface-load")).toEqual([]);
    // 契约真的绑上了：case 违例可见
    expect(r.issues.filter((i) => i.code === "nudo:case-inconsistency").length).toBeGreaterThan(0);
  });

  it("相对侧车别名（positive as number）⇒ 侧车装载成功、契约生效", () => {
    const { loadModule } = makeFiles({
      "/t/std.nudo.js": `import { number } from "@nudojs/core";\nexport const positive = number().gt(0);`,
      "/t/alias2.nudo.js":
        `import { positive as number } from "./std.nudo.js";\n` +
        `import { fn, lit } from "@nudojs/core";\n` +
        `export const f = fn({ x: number }, lit(0));`,
    });
    const r = checkSource("/t/alias2.js", SRC, pTrue, { loadModule, fromFile: "/t/alias2.js" });
    expect(r.issues.filter((i) => i.code === "nudo:interface-load")).toEqual([]);
    expect(r.issues.filter((i) => i.code === "nudo:case-inconsistency").length).toBeGreaterThan(0);
  });

  it("同名导入（number）仍走 ambient 解构 ⇒ 不得被排除（零回归）", () => {
    const { loadModule } = makeFiles({
      "/t/plain.nudo.js":
        `import { fn, number } from "@nudojs/core";\n` +
        `export const f = fn({ x: number().gt(0) }, number());`,
    });
    const r = checkSource("/t/plain.js", SRC, pTrue, { loadModule, fromFile: "/t/plain.js" });
    expect(r.issues.filter((i) => i.code === "nudo:interface-load")).toEqual([]);
    expect(r.issues.filter((i) => i.code === "nudo:case-inconsistency").length).toBeGreaterThan(0);
  });
});
