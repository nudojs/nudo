/**
 * Bug 338 回归：侧车自身的绑定名与**构建器名**同名 ⇒ 侧车根本加载不了。
 *
 * 根因：`execSidecar` 用 `new Function(...Object.keys(sidecarInjects), …)`
 * 把 15 个构建器名当**形参**注入；侧车里的 `const pick = …`
 * （rewriteSidecarSource 把 `export const` 改成 `const`）与形参同名 ⇒
 * SyntaxError「Cannot declare a const variable twice」⇒ 整份侧车加载失败 ⇒
 * 该文件的全部契约丢失、三个运行时产物面退化为「接受一切」。
 *
 * 修法：注入名不再占用**侧车自身的顶层作用域**——外层作用域放注入袋 +
 * 构建器解构 + 依赖绑定，内层 IIFE 放侧车自己的代码（同名 = 遮蔽，不是
 * 重复声明）。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { execNudoModule, setRefineDiagCollector, takeRefineDiags } from "../refine.ts";

beforeEach(() => {
  setRefineDiagCollector(null);
  takeRefineDiags();
});

describe("Bug 338: 侧车绑定名与构建器名同名", () => {
  it("`export const pick = fn(…)`（pick 是构建器名）→ 侧车可加载，导出可见", () => {
    const src = `
import { fn, number } from "@nudojs/core";
export const pick = fn({ flag: number() }, number());
`;
    const out = execNudoModule(src, { fromFile: "/t/lib.nudo.js" });
    expect(Object.keys(out)).toContain("pick");
    const v = out["pick"] as { fn?: unknown } | undefined;
    expect(v).toBeDefined();
    expect(v?.fn).toBeDefined();
  });

  it("侧车里的 `const number = …`（number 是构建器名）→ 可加载，不抛 SyntaxError", () => {
    const src = `
import { fn } from "@nudojs/core";
export const number = fn({ x: 1 }, 1);
`;
    const out = execNudoModule(src, { fromFile: "/t/lib.nudo.js" });
    expect(Object.keys(out)).toContain("number");
  });

  it("构建器仍可用：侧车未遮蔽的名字照常解析（fn / number）", () => {
    const src = `
import { fn, number } from "@nudojs/core";
export const keep = fn({ x: number().gt(0) }, number());
`;
    const out = execNudoModule(src, { fromFile: "/t/lib.nudo.js" });
    const v = out["keep"] as { fn?: { params?: unknown } } | undefined;
    expect(v?.fn).toBeDefined();
  });
});
