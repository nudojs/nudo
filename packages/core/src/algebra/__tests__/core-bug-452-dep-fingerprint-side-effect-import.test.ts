/**
 * Bug 452 —— 依赖指纹**漏掉「仅副作用 import」** ⇒ 磁盘缓存键不失效 ⇒
 * `nudo check` 继续吐**上一次的陈旧签名**（`load-deps-fp.ts` 文件头
 * 「more misses, **never a stale hit**」承诺被证伪）。
 *
 * 根因：依赖指纹用**正则**抽说明符、模块图用 **AST** 抽说明符 ⇒ 两者对
 * 「仅副作用 import」的判断**不一致** ⇒ 指纹**低估**真实依赖集。
 *
 * 修法（`packages/core/src/algebra/load-deps-fp.ts`）：指纹的说明符抽取**并入
 * AST 侧**（与模块图同口径）⇒ **正则集 ∪ AST 集** ⇒ 只多 miss，绝不陈旧命中。
 */
import { describe, it, expect } from "vitest";
import { extractAllLoadSpecs, loadModuleDepsFingerprint } from "../load-deps-fp.ts";

/** 假 loader：把 spec 映射到固定内容（相对 spec 按 fromFile 的目录解析） */
function makeLoad(deps: Record<string, string>) {
  return (spec: string, fromFile: string) => {
    const i = fromFile.lastIndexOf("/");
    const base = i >= 0 ? fromFile.slice(0, i) : "";
    const joined = spec.startsWith(".")
      ? `${base}/${spec.replace(/^\.\//, "")}`
      : spec;
    return deps[joined];
  };
}

describe("Bug 452: 仅副作用 import / 模板字符串 require 进依赖指纹", () => {
  it("仅副作用 import（import \"./setup.js\"）进说明符集", () => {
    const specs = extractAllLoadSpecs(`import { n } from "./lib.js";
import "./setup.js";
`);
    expect(specs).toContain("./setup.js");
    expect(specs).toContain("./lib.js");
  });

  it("模板字符串 require（require(`./tpl.js`)）进说明符集", () => {
    const specs = extractAllLoadSpecs("const r = require(`./tpl.js`);");
    expect(specs).toContain("./tpl.js");
  });

  it("具名 import / 动态 import 仍进集合（既有口径不回归）", () => {
    const specs = extractAllLoadSpecs(`import { a } from "./a.js";
const d = await import("./d.js");
`);
    expect(specs).toContain("./a.js");
    expect(specs).toContain("./d.js");
  });

  it("仅副作用 import 的**内容**进依赖指纹：内容变 ⇒ 指纹变（缓存据此失效）", () => {
    const deps: Record<string, string> = {
      "/t/lib.js": "export let n = 0;\n",
      "/t/setup.js": "import { n } from \"./lib.js\";\nn = 41;\n",
    };
    const src = `import { n } from "./lib.js";
import "./setup.js";
export function get() { return n; }
`;
    const r1 = loadModuleDepsFingerprint(src, makeLoad(deps), "/t/main.js");
    expect(r1.truncated).toBe(false);
    expect(r1.paths).toContain("/t/setup.js");
    // 依赖内容变 ⇒ 指纹变（否则磁盘缓存键不变 ⇒ 陈旧命中）
    deps["/t/setup.js"] = "import { n } from \"./lib.js\";\nn = 42;\n";
    const r2 = loadModuleDepsFingerprint(src, makeLoad(deps), "/t/main.js");
    expect(r2.fp).not.toBe(r1.fp);
  });

  it("AST 抽取失败（源语法错）⇒ 正则集仍在（不引入新的低估）", () => {
    const specs = extractAllLoadSpecs(`const broken = ;
import x from "./lib.js";
`);
    expect(specs).toContain("./lib.js");
  });

  it("import.meta / import() 形态不误收（说明符仍是动态 import 的那个）", () => {
    const specs = extractAllLoadSpecs("const u = import.meta.url; const d = import('./dyn.js');");
    expect(specs).toContain("./dyn.js");
    expect(specs).not.toContain("import.meta.url");
  });
});
