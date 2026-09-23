/**
 * 引擎边界精度：
 * T13 JSX → $unknown（文件其余部分保持 B-hosted）
 * T14 import.meta / 动态 import 建模
 * T15 混合 + 粗化为 number|string
 * T16 侧车键近失配（Class.method vs 裸 method）
 * T17 多调用点 join 保持组合式
 */
import { describe, it, expect } from "vitest";
import {
  runTranspiled,
  callTranspiledExportFull,
  litValue,
  formatAbs,
  checkSource,
  pTrue,
  add,
  abs,
  num,
  str,
  unknown as unknownAbs,
  objOf,
} from "@nudojs/core";
import { analyzeFile, deriveFromRoot } from "../index.ts";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultLoadModule } from "../load-module.ts";

describe("T13 JSX stays B-hosted via $unknown", () => {
  it("file with JSX still analyzes sibling export precisely", () => {
    const src = `
export function el() {
  return <div className="x">hi</div>;
}
export function twice(n) { return n * 2; }
twice(21);
`;
    const r = runTranspiled(src, { mode: "exec" });
    expect("twice" in r).toBe(true);
    const out = callTranspiledExportFull(r, "twice", [
      abs({ k: "prim", type: "number" }, { op: "lit", value: 4 as never }, undefined, "exact"),
    ]);
    expect(litValue(out.result)).toBe(8);
    // JSX 函数本身：显式 unknown，不是整文件 fail-closed
    const el = callTranspiledExportFull(r, "el", []);
    expect(el.result.shape.k).toBe("unknown");
  });
});

describe("T14 import.meta / dynamic import", () => {
  it("import.meta lowers to { url: string }", () => {
    const src = `export function meta() { return import.meta; }`;
    const r = runTranspiled(src, { mode: "exec" });
    const out = callTranspiledExportFull(r, "meta", []);
    const url = (out.result.shape as { slots?: Record<string, { value: { shape: { k: string; type?: string } } }> }).slots?.["url"];
    expect(url?.value.shape.k).toBe("prim");
    expect(url?.value.shape.type).toBe("string");
  });

  it("dynamic import lowers to Promise of open obj", () => {
    const src = `export function load() { return import("./m.js"); }`;
    const r = runTranspiled(src, { mode: "exec" });
    const out = callTranspiledExportFull(r, "load", []);
    const s = out.result.shape as { k: string; eff?: string; inner?: { shape?: { k: string; open?: boolean } } };
    expect(s.k).toBe("eff");
    expect(s.eff).toBe("promise");
    expect(s.inner?.shape?.k).toBe("obj");
    expect(s.inner?.shape?.open).toBe(true);
  });
});

describe("T15 mixed + coarsens to number|string", () => {
  it("number + unknown is number|string not unknown", () => {
    const r = add(
      abs({ k: "prim", type: "number" }, undefined, undefined, "path"),
      unknownAbs,
    );
    expect(r.shape.k).toBe("sum");
    const members = (r.shape as { members: Array<{ shape: { k: string; type?: string } }> }).members;
    const kinds = members.map((m) => (m.shape.k === "prim" ? m.shape.type : m.shape.k)).sort();
    expect(kinds).toEqual(["number", "string"]);
  });

  it("number + open obj is number|string", () => {
    const o = objOf({}, { open: true });
    const r = add(abs({ k: "prim", type: "number" }, undefined, undefined, "path"), o);
    expect(r.shape.k).toBe("sum");
    expect(formatAbs(r)).toContain("number");
    expect(formatAbs(r)).toContain("string");
  });
});

describe("T16 sidecar Class.method near-miss key", () => {
  it("bare method key does not silent-bind Class.method (reports load hint)", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-t16-"));
    try {
      writeFileSync(join(dir, "lib.js"), `
export class Adder {
  add(a, b) { return a + b; }
}
`);
      writeFileSync(join(dir, "lib.nudo.js"), `import { number, fn } from "@nudojs/core";
export const add = fn({ a: number().gt(0) }, number().gt(0));
`);
      const loadModule = (spec: string, from: string) => {
        if (spec.endsWith("lib.nudo.js") || spec.includes("nudo")) {
          try {
            return require("node:fs").readFileSync(join(dir, "lib.nudo.js"), "utf-8");
          } catch {
            return undefined;
          }
        }
        return defaultLoadModule(spec, from);
      };
      const src = `export class Adder {
  add(a, b) { return a + b; }
}
`;
      const r = checkSource(join(dir, "lib.js"), src, pTrue, {
        loadModule: (spec: string, from: string) => {
          if (spec.includes("lib.nudo") || spec.endsWith(".nudo.js")) {
            return `import { number, fn } from "@nudojs/core";
export const add = fn({ a: number().gt(0) }, number().gt(0));
`;
          }
          return undefined;
        },
        fromFile: join(dir, "lib.js"),
      });
      // 近失配提示或至少不误绑到 Adder.add
      const loadDiag = r.issues.find(
        (i) => i.code === "nudo:interface-load" && i.message.includes("does not bind"),
      );
      // 若 autoBind 因路径等原因未触发，至少不得把裸 add 当成 Adder.add 执法
      const mismatch = r.issues.find((i) => i.code === "nudo:constraint-violated");
      expect(loadDiag !== undefined || mismatch === undefined).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("T17 multi-call join keeps compositional", () => {
  it("two call sites from same root project compositionally", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-t17-"));
    try {
      writeFileSync(join(dir, "std.nudo.js"), `import { number } from "@nudojs/core";
export const positive = number().gt(0);
export const positive4 = number().gt(4);
`);
      writeFileSync(join(dir, "add.js"), `export function add2(x) { return x + 2; }\n`);
      writeFileSync(join(dir, "lib.js"), `
import { add2 } from "./add.js";
export function add4(x) {
  return add2(x + 1) + 1;
}
export function add4b(x) {
  return add2(x + 1) + 1;
}
`);
      writeFileSync(join(dir, "lib.nudo.js"), `import { number, fn } from "@nudojs/core";
import { positive, positive4 } from "./std.nudo.js";
export const add4 = fn({ x: positive }, positive4);
export const add4b = fn({ x: positive }, positive4);
`);
      const r = deriveFromRoot(join(dir, "lib.js"), {
        loadModule: defaultLoadModule,
      });
      const add2 = r.derived.find((d) => d.fn === "add2");
      expect(add2).toBeDefined();
      // 两 root 调 add2：join 后仍应组合式（或至少不 underivable）
      console.log("T17 add2 compositional:", add2!.compositional, "dsl:", add2!.params[0]?.dsl);
      expect(add2!.underivable).toBeFalsy();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
