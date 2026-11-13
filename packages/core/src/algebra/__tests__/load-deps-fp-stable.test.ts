/**
 * ABS-18 · 依赖指纹的**分析稳定投影**（`stableAnalyzeKeySource`）。
 *
 * 入口自身的缓存键早已忽略「尾部无 `@nudo` 的注释/空白」，依赖侧此前直接
 * hash 原始字节 ⇒ 只改依赖末尾注释也会让整条依赖链 miss（watch 里就是
 * 1.0–3.3s 的全链重算）。本夹具钉住对齐后的口径：
 * - inert 编辑（尾部注释 / 空白 / 换行）⇒ fp 与 contents **逐字不变**；
 * - `@nudo` 指令、真实代码、依赖集合变化 ⇒ fp 必须翻转（不得吞真变更）；
 * - 传递依赖与 ambient 侧车同样按此口径。
 */
import { describe, it, expect } from "vitest";
import { loadModuleDepsFingerprint } from "../key/load-deps-fp.ts";

/** 与既有 load-deps-fp 夹具同款虚拟 loader（相对说明符按 fromFile 所在目录解析）。 */
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

const ENTRY = `import { f } from "./dep.js";\nexport const g = f;\n`;

function fpOf(files: Record<string, string>) {
  return loadModuleDepsFingerprint(ENTRY, makeLoad(files), "/proj/entry.js");
}

describe("ABS-18 · dep 指纹忽略尾部 inert 注释/空白", () => {
  const baseDep = `export function f(x) {\n  return x + 1;\n}\n`;

  it("尾部 `//` 注释（无 @nudo）不翻转指纹与 contents", () => {
    const before = fpOf({ "/proj/dep.js": baseDep });
    const after = fpOf({ "/proj/dep.js": `${baseDep}// updated note\n` });
    expect(after.fp).toBe(before.fp);
    expect(after.contents).toEqual(before.contents);
  });

  it("尾部多行 `//` 注释 / 空行 / 空白不翻转指纹", () => {
    const before = fpOf({ "/proj/dep.js": baseDep });
    const after = fpOf({ "/proj/dep.js": `${baseDep}// a\n// b\n\n   \n` });
    expect(after.fp).toBe(before.fp);
  });

  it("尾部块注释（无 @nudo）不翻转指纹", () => {
    const before = fpOf({ "/proj/dep.js": baseDep });
    const after = fpOf({ "/proj/dep.js": `${baseDep}/* trailing note */\n` });
    expect(after.fp).toBe(before.fp);
  });

  it("contents 是稳定投影：尾部注释已剔除，null（miss）语义不变", () => {
    const fp = fpOf({ "/proj/dep.js": `${baseDep}// note\n` });
    const dep = fp.contents.find((c) => c.path === "/proj/dep.js");
    expect(dep?.content).not.toContain("note");
    expect(dep?.content?.endsWith("\n")).toBe(true);

    const miss = loadModuleDepsFingerprint(
      `import { x } from "./gone.js";\n`,
      makeLoad({}),
      "/proj/entry2.js",
    );
    expect(miss.contents).toEqual([{ path: "/proj/gone.js", content: null }]);
  });
});

describe("ABS-18 · 真变更仍然翻转指纹", () => {
  const baseDep = `export function f(x) {\n  return x + 1;\n}\n`;

  it("尾部 `@nudo` 指令被保留（改它必须翻转）", () => {
    const before = fpOf({ "/proj/dep.js": `${baseDep}// @nudo:case "c" () => 1\n` });
    const after = fpOf({ "/proj/dep.js": `${baseDep}// @nudo:case "c" () => 2\n` });
    expect(after.fp).not.toBe(before.fp);
  });

  it("代码变更翻转（x + 1 → x + 2）", () => {
    const before = fpOf({ "/proj/dep.js": baseDep });
    const after = fpOf({ "/proj/dep.js": `export function f(x) {\n  return x + 2;\n}\n` });
    expect(after.fp).not.toBe(before.fp);
  });

  it("行号变化的中间注释翻转（不是尾部注释，不得被剔除）", () => {
    const before = fpOf({ "/proj/dep.js": baseDep });
    const after = fpOf({
      "/proj/dep.js": `export function f(x) {\n  // shift lines\n  return x + 1;\n}\n`,
    });
    expect(after.fp).not.toBe(before.fp);
  });

  it("传递依赖的尾部注释不翻转；其代码变更翻转", () => {
    const files = (leaf: string) => ({
      "/proj/dep.js": `import { h } from "./leaf.js";\nexport function f(x) {\n  return h(x);\n}\n`,
      "/proj/leaf.js": leaf,
    });
    const before = fpOf(files(`export function h(x) {\n  return x;\n}\n`));
    const inert = fpOf(files(`export function h(x) {\n  return x;\n}\n// note\n`));
    const real = fpOf(files(`export function h(x) {\n  return x + 1;\n}\n`));
    expect(inert.fp).toBe(before.fp);
    expect(real.fp).not.toBe(before.fp);
  });

  it("ambient 侧车同样按稳定投影口径", () => {
    const dep = `export function f(x) {\n  return x + 1;\n}\n`;
    const sidecar = `export const c = (x) => x;\n`;
    const before = fpOf({ "/proj/dep.js": dep, "/proj/entry.nudo.js": sidecar });
    const inert = fpOf({
      "/proj/dep.js": dep,
      "/proj/entry.nudo.js": `${sidecar}// sidecar note\n`,
    });
    const real = fpOf({
      "/proj/dep.js": dep,
      "/proj/entry.nudo.js": `export const c = (x) => x + 1;\n`,
    });
    expect(before.fp).toContain("sidecar:");
    expect(inert.fp).toBe(before.fp);
    expect(real.fp).not.toBe(before.fp);
  });
});
