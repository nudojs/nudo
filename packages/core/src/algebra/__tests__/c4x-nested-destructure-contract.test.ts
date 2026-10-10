/**
 * #137：侧车点路径键约束嵌套解构形参（`({ card: { grade } })`）。
 * - param-surface：nestedPaths 收集（含 rename / 平铺点键 / 数组元素不可寻址）
 * - locateContractParam：fieldPath 多段；平铺精确匹配先于点路径解析
 * - 端到端：`fn({ 'card.grade': string() })` 零 param-mismatch、签名非
 *   `_p0: any`、违例调用报 constraint-violated（expected 含点路径）；
 *   平铺整对象绑定可用；绑内层平铺叶名仍 fail-closed（param-mismatch）。
 */
import { describe, it, expect } from "vitest";
import * as path from "node:path";
import {
  formalParamsFromNodes,
  contractParamNameSet,
  locateContractParam,
  type FormalParam,
} from "../param-surface.ts";
import { parseSource } from "../parse-source.ts";
import { checkSource, resetCheckSourceMemo } from "../check.ts";
import { pTrue } from "../pred.ts";
import { resetGeneralizeMemo } from "../generalize.ts";

/** 从 `function f(<src>) {}` 解析形参表面（真实 Babel AST，非手搭节点） */
function formalsOf(src: string): FormalParam[] {
  const file = parseSource(`function f(${src}) { return 1; }\n`);
  const decl = file.program.body[0] as unknown as { params?: unknown[] };
  return formalParamsFromNodes(decl.params as never);
}

function patternOf(formals: FormalParam[]) {
  const f = formals[0]!;
  if (f.kind !== "pattern") throw new Error("expected pattern param");
  return f;
}

function makeFiles(files: Record<string, string>) {
  return {
    loadModule: (spec: string, fromFile: string) => {
      const dir = path.dirname(fromFile);
      const joined = path.resolve(dir, spec);
      return files[joined] ?? files[spec];
    },
  };
}

describe("#137 param-surface nested path collection", () => {
  it("({card:{grade}}): card flat-bindable + 'card.grade' path; bare 'grade' unbindable", () => {
    const f = patternOf(formalsOf("{ card: { grade } }"));
    expect(f.bound).toContain("card");
    expect(f.nestedPaths).toEqual(["card.grade"]);
    expect(f.nested).toContain("grade");
    const names = contractParamNameSet([f]);
    expect(names.has("card")).toBe(true);
    expect(names.has("card.grade")).toBe(true);
    expect(names.has("grade")).toBe(false);
    expect(locateContractParam([f], "card")).toEqual({
      index: 0,
      field: "card",
      fieldPath: ["card"],
    });
    expect(locateContractParam([f], "card.grade")).toEqual({
      index: 0,
      field: "card.grade",
      fieldPath: ["card", "grade"],
    });
    expect(locateContractParam([f], "grade")).toBeUndefined();
  });

  it("({card:{grade:g}}) rename: path keyed by source property, not binding name", () => {
    const f = patternOf(formalsOf("{ card: { grade: g } }"));
    expect(f.bound).toContain("card");
    expect(f.nestedPaths).toEqual(["card.grade"]);
    expect(contractParamNameSet([f]).has("g.grade")).toBe(false);
    expect(locateContractParam([f], "card.grade")).toMatchObject({
      index: 0,
      fieldPath: ["card", "grade"],
    });
  });

  it("flat source key 'a.b' keeps single-segment semantics (flat beats path)", () => {
    const f = patternOf(formalsOf("{ 'a.b': x }"));
    expect(f.bound).toContain("a.b");
    expect(f.bound).toContain("x");
    expect(f.nestedPaths).toEqual([]);
    expect(locateContractParam([f], "a.b")).toEqual({
      index: 0,
      field: "a.b",
      fieldPath: ["a.b"],
    });
  });

  it("({a:{'x.y':z}}): dotted segment drops the whole path (ambiguity fail-closed)", () => {
    const f = patternOf(formalsOf("{ a: { 'x.y': z } }"));
    expect(f.nestedPaths).toEqual([]);
  });

  it("({items:[a]}): 'items' flat-bindable whole array; no numeric element path", () => {
    const f = patternOf(formalsOf("{ items: [a] }"));
    expect(f.bound).toContain("items");
    expect(f.nestedPaths).toEqual([]);
    expect(f.nested).toContain("a");
    expect(locateContractParam([f], "items")).toMatchObject({
      index: 0,
      fieldPath: ["items"],
    });
    expect(locateContractParam([f], "items.0")).toBeUndefined();
  });

  it("({a:{b:{c}}}) three levels: intermediate and leaf paths both bindable", () => {
    const f = patternOf(formalsOf("{ a: { b: { c } } }"));
    expect(f.bound).toContain("a");
    expect(f.nestedPaths).toEqual(["a.b", "a.b.c"]);
    expect(locateContractParam([f], "a.b")).toMatchObject({
      index: 0,
      fieldPath: ["a", "b"],
    });
    expect(locateContractParam([f], "a.b.c")).toMatchObject({
      index: 0,
      fieldPath: ["a", "b", "c"],
    });
  });
});

describe("#137 sidecar dot-path key on nested destructure (end-to-end)", () => {
  it("'card.grade': string() binds nested({card:{grade}}): no mismatch, signature not _p0: any", () => {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    const { loadModule } = makeFiles({
      "/t/nested.nudo.js":
        `import { fn, string } from "@nudojs/core";\nexport const nested = fn({ 'card.grade': string() }, string());\n`,
    });
    const src = `
export function nested({ card: { grade } }) {
  return grade + '#';
}
nested({ card: { grade: 'A' } });
`;
    const r = checkSource("/t/nested.js", src, pTrue, {
      loadModule,
      fromFile: "/t/nested.js",
      autoBind: true,
    });
    // 契约名 'card.grade' 在契约面内 → 零 param-mismatch（修前：grade 误报）
    expect(
      r.issues.filter((i) => i.code === "nudo:interface-param-mismatch"),
    ).toEqual([]);
    // 签名参数面：解构渲染 `{ card }`，typeParams 是 obj（grade: string）
    const sig = r.signatures.find((s) => s.name === "nested");
    expect(sig).toBeDefined();
    expect(sig!.params[0]).toContain("card");
    expect(sig!.paramTypes[0]).toContain("card");
    expect(sig!.paramTypes[0]).toContain("grade");
    expect(sig!.paramTypes[0]).toContain("string");
    // 契约挂上后不再是 unknown（unknown-inference 消失）
    expect(
      r.issues.filter((i) => i.code === "nudo:unknown-inference" && i.fn === "nested"),
    ).toEqual([]);
  });

  it("violating call (grade: 5) reports constraint-violated with dot-path expected", () => {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    const { loadModule } = makeFiles({
      "/t/nested2.nudo.js":
        `import { fn, string } from "@nudojs/core";\nexport const nested = fn({ 'card.grade': string() }, string());\n`,
    });
    const src = `
export function nested({ card: { grade } }) {
  return grade + '#';
}
nested({ card: { grade: 5 } });
`;
    const r = checkSource("/t/nested2.js", src, pTrue, {
      loadModule,
      fromFile: "/t/nested2.js",
      autoBind: true,
    });
    const violated = r.issues.filter((i) => i.code === "nudo:constraint-violated");
    expect(violated.length).toBeGreaterThan(0);
    expect(violated.some((v) => String(v.expected ?? "").includes("card.grade"))).toBe(true);
  });

  it("flat whole-object binding card: shape({grade: string()}) works and enforces", () => {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    const { loadModule } = makeFiles({
      "/t/flat.nudo.js":
        `import { fn, string, shape } from "@nudojs/core";\nexport const flat = fn({ card: shape({ grade: string() }) }, string());\n`,
    });
    const src = `
export function flat({ card: { grade } }) {
  return grade + '#';
}
flat({ card: { grade: 'B' } });
flat({ card: { grade: 7 } });
`;
    const r = checkSource("/t/flat.js", src, pTrue, {
      loadModule,
      fromFile: "/t/flat.js",
      autoBind: true,
    });
    expect(
      r.issues.filter((i) => i.code === "nudo:interface-param-mismatch"),
    ).toEqual([]);
    const violated = r.issues.filter((i) => i.code === "nudo:constraint-violated");
    expect(violated.length).toBeGreaterThan(0);
    expect(violated.some((v) => String(v.expected ?? "").includes("card.grade"))).toBe(true);
  });

  it("binding bare inner leaf name 'grade' on nested form still fails closed (param-mismatch)", () => {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    const { loadModule } = makeFiles({
      "/t/inner.nudo.js":
        `import { fn, string } from "@nudojs/core";\nexport const inner = fn({ grade: string() }, string());\n`,
    });
    const src = `
export function inner({ card: { grade } }) {
  return grade + '#';
}
inner({ card: { grade: 'A' } });
`;
    const r = checkSource("/t/inner.js", src, pTrue, {
      loadModule,
      fromFile: "/t/inner.js",
      autoBind: true,
    });
    const mismatch = r.issues.filter(
      (i) => i.code === "nudo:interface-param-mismatch" && i.fn === "inner",
    );
    expect(mismatch.length).toBeGreaterThan(0);
  });
});
