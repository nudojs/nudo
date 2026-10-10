/**
 * 运行时标志折叠（Phase 1）：参数契约 inlay 以表达式原文 /
 * 约束名折叠展示（替代 pred 无损展开——lazy 判别联合展开可达
 * 数万字符），完整 pred 进 tooltip 供 hover 展开。
 * - 侧车 fn() 形参表达式原文（整表达式别名规范化为导入名）
 * - @nudo:contract 指令约束名
 * - 侧车 ∧ 指令并存 → `expr ∧ name`（任一文本缺席 → 整体回落）
 * - 派生形参（spread / computed）→ 回落 pred 全展（无 tooltip）
 */
import { describe, it, expect } from "vitest";
import { collectAbsInlays } from "../inlay.ts";

const loader = (files: Record<string, string>) => (spec: string) =>
  files[spec] ?? undefined;

const POSITIVE_SIDECAR = `import { number } from "@nudojs/core";
export const positive = number().gt(0);
`;

describe("collectAbsInlays 参数契约折叠展示", () => {
  it("侧车表达式原文折叠：label = 原文，tooltip = 完整 pred", () => {
    const src = `export function f(x) {\n  return x;\n}\n`;
    const inlays = collectAbsInlays(src, {
      fromFile: "/t/f.js",
      loadModule: loader({
        "./f.nudo.js": `import { fn, number } from "@nudojs/core";
export const f = fn({ x: number().gt(0) }, number());
`,
      }),
    });
    const p = inlays.find((i) => i.kind === "parameter");
    expect(p).toBeDefined();
    expect(p!.label).toBe("  where number().gt(0)");
    expect(p!.tooltip).toBeDefined();
    expect(p!.tooltip).toContain("x");
    expect(p!.tooltip).toContain(">");
  });

  it("整表达式别名规范化：local alias → 导入名", () => {
    const src = `export function f(x) {\n  return x;\n}\n`;
    const inlays = collectAbsInlays(src, {
      fromFile: "/t/f.js",
      loadModule: loader({
        "./f.nudo.js": `import { fn, string } from "@nudojs/core";
import { myC as C } from "./dep.nudo.js";
export const f = fn({ x: C }, string());
`,
        "./dep.nudo.js": `import { string } from "@nudojs/core";
export const myC = string();
`,
      }),
    });
    const p = inlays.find((i) => i.kind === "parameter");
    expect(p).toBeDefined();
    expect(p!.label).toBe("  where myC");
  });

  it("包裹表达式按原文展示（不做别名规范化）", () => {
    const src = `export function f(x) {\n  return x;\n}\n`;
    const inlays = collectAbsInlays(src, {
      fromFile: "/t/f.js",
      loadModule: loader({
        "./f.nudo.js": `import { fn, nullable, string } from "@nudojs/core";
import { myC } from "./dep.nudo.js";
export const f = fn({ x: nullable(myC) }, nullable(string()));
`,
        "./dep.nudo.js": `import { string } from "@nudojs/core";
export const myC = string();
`,
      }),
    });
    const p = inlays.find((i) => i.kind === "parameter");
    expect(p).toBeDefined();
    expect(p!.label).toBe("  where nullable(myC)");
  });

  it("export default fn({…})：登记在 default 键（C4.4 绑定桥接）", () => {
    const src = `export default function f(x) {\n  return x;\n}\n`;
    const inlays = collectAbsInlays(src, {
      fromFile: "/t/f.js",
      loadModule: loader({
        "./f.nudo.js": `import { fn, number } from "@nudojs/core";
export default fn({ x: number().gt(0) }, number());
`,
      }),
    });
    const p = inlays.find((i) => i.kind === "parameter");
    expect(p).toBeDefined();
    expect(p!.label).toBe("  where number().gt(0)");
  });

  it("指令契约名折叠：label = 约束名", () => {
    const src = `/// @nudo:import { positive } from "./std.nudo.js"
/**
 * @nudo:contract x positive
 */
export function f(x) {
  return x;
}
`;
    const inlays = collectAbsInlays(src, {
      fromFile: "/t/f.js",
      loadModule: loader({ "./std.nudo.js": POSITIVE_SIDECAR }),
    });
    const p = inlays.find((i) => i.kind === "parameter");
    expect(p).toBeDefined();
    expect(p!.label).toBe("  where positive");
    expect(p!.tooltip).toBeDefined();
    expect(p!.tooltip).toContain(">");
  });

  it("侧车 ∧ 指令并存：`expr ∧ name`", () => {
    const src = `/// @nudo:import { positive } from "./std.nudo.js"
/**
 * @nudo:contract x positive
 */
export function f(x) {
  return x;
}
`;
    const inlays = collectAbsInlays(src, {
      fromFile: "/t/f.js",
      loadModule: loader({
        "./std.nudo.js": POSITIVE_SIDECAR,
        "./f.nudo.js": `import { fn, number } from "@nudojs/core";
export const f = fn({ x: number().gt(0) }, number());
`,
      }),
    });
    const p = inlays.find((i) => i.kind === "parameter");
    expect(p).toBeDefined();
    expect(p!.label).toBe("  where number().gt(0) ∧ positive");
  });

  it("派生形参（spread）回落 pred 全展，无 tooltip", () => {
    const src = `export function f(x) {\n  return x;\n}\n`;
    const inlays = collectAbsInlays(src, {
      fromFile: "/t/f.js",
      loadModule: loader({
        "./f.nudo.js": `import { fn, string } from "@nudojs/core";
const base = { x: string() };
export const f = fn({ ...base }, string());
`,
      }),
    });
    const p = inlays.find((i) => i.kind === "parameter");
    expect(p).toBeDefined();
    expect(p!.label).toBe('  where typeof x = "string"');
    expect(p!.tooltip).toBeUndefined();
  });

  it("并存但侧车形参派生（无原文）→ 整体回落 pred 全展", () => {
    const src = `/// @nudo:import { positive } from "./std.nudo.js"
/**
 * @nudo:contract x positive
 */
export function f(x) {
  return x;
}
`;
    const inlays = collectAbsInlays(src, {
      fromFile: "/t/f.js",
      loadModule: loader({
        "./std.nudo.js": POSITIVE_SIDECAR,
        "./f.nudo.js": `import { fn, string } from "@nudojs/core";
const base = { x: string() };
export const f = fn({ ...base }, string());
`,
      }),
    });
    const p = inlays.find((i) => i.kind === "parameter");
    expect(p).toBeDefined();
    // 侧车文本缺席 → 不展示残缺折叠形；指令名单独也不足以代表合取
    expect(p!.label).not.toContain("∧");
    expect(p!.label).not.toBe("  where positive");
    expect(p!.tooltip).toBeUndefined();
  });

  it("无契约参数：无 parameter inlay", () => {
    const src = `export function f(x) {\n  return x;\n}\n`;
    const inlays = collectAbsInlays(src, {
      fromFile: "/t/f.js",
      loadModule: loader({}),
    });
    expect(inlays.find((i) => i.kind === "parameter")).toBeUndefined();
  });

  it("同内容侧车跨路径：exec 缓存命中仍登记折叠文本", () => {
    // exec 缓存键 = 自身内容 hash + 依赖闭包——同内容侧车
    // 在不同路径（复制的契约）命中缓存时不重跑 execSidecar；
    // 命中路径须按当前路径补登记，否则第二个路径查不到
    // 折叠文本、回落 pred 全展
    const src = `export function f(x) {\n  return x;\n}\n`;
    const sidecar = `import { fn, number } from "@nudojs/core";
export const f = fn({ x: number().gt(0) }, number());
`;
    const first = collectAbsInlays(src, {
      fromFile: "/t/a.js",
      loadModule: loader({ "./a.nudo.js": sidecar }),
    });
    const second = collectAbsInlays(src, {
      fromFile: "/t/b.js",
      loadModule: loader({ "./b.nudo.js": sidecar }),
    });
    const p1 = first.find((i) => i.kind === "parameter");
    const p2 = second.find((i) => i.kind === "parameter");
    expect(p1?.label).toBe("  where number().gt(0)");
    expect(p2?.label).toBe("  where number().gt(0)");
    expect(p2?.tooltip).toBeDefined();
  });
});
