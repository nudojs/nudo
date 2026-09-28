/**
 * BUG-004：`export * as ns` 全链导出 ns 槽 + `import * as ns` 命名空间 open+path。
 *
 * 修复前：
 * - ExportNamespaceSpecifier 在 transpile / rewriteExportStatements /
 *   collectAbsExports / localNamedExports 全链被静默丢弃（导出面无 ns）。
 * - bindImports 的 `import * as ns` 造闭 exact 对象，缺失成员被
 *   definitelyUncallableMember 判「运行时缺失」假抛 TypeError。
 */
import { describe, it, expect } from "vitest";
import { parseSource } from "../parse-source.ts";
import { emptyEnv } from "../ast-env.ts";
import {
  bindImports,
  collectAbsExports,
  namespaceAbsOf,
  type AbsModuleExports,
} from "../abs-modules.ts";
import { localNamedExports } from "../interface.ts";
import { runTranspiled, transpile, callTranspiledExportFull, litValue } from "@nudojs/core";
import { abs, num, unknown } from "../abs.ts";
import { v } from "../term.ts";
import { definitelyUncallableMember } from "../exec/member-diag.ts";

function numMod(): AbsModuleExports {
  return {
    named: {
      inc: abs({ k: "fn", params: ["x"] }, undefined, undefined, "exact"),
      k: abs(num().shape, v("k"), undefined, "exact"),
    },
    default: abs(num().shape, undefined, undefined, "exact"),
  };
}

describe("export * as ns — ExportNamespaceSpecifier full chain", () => {
  it("transpile preserves `export * as ns from`", () => {
    const js = transpile(`export * as ns from "./m.js";`, { runtimeImport: "@nudojs/core/exec" });
    expect(js).toContain(`export * as ns from "./m.js";`);
  });

  it("runTranspiled export surface contains ns (open namespace Abs)", () => {
    const r = runTranspiled(`export * as ns from "./m.js";`, {
      mode: "analyze",
      modules: { "./m.js": numMod() },
    });
    expect(Object.keys(r)).toContain("ns");
    const ns = r.ns as { shape?: { k: string; open?: boolean; slots?: Record<string, unknown> }; conf?: string };
    expect(ns.shape?.k).toBe("obj");
    expect(ns.shape?.open).toBe(true);
    expect(ns.conf).toBe("path");
    expect(Object.keys(ns.shape?.slots ?? {}).sort()).toEqual(["default", "inc", "k"]);
  });

  it("collectAbsExports registers ns as namespaceAbsOf(mod)", () => {
    const file = parseSource(`export * as ns from "./m.js";`);
    const env = emptyEnv();
    const mod = numMod();
    const out = collectAbsExports(file, env, { "./m.js": mod });
    expect(out.named.ns).toBeDefined();
    expect(out.named.ns!.shape.k).toBe("obj");
    expect((out.named.ns!.shape as { open?: boolean }).open).toBe(true);
    expect(out.named.ns!.conf).toBe("path");
  });

  it("localNamedExports registers ns name", () => {
    const names = localNamedExports(`export * as ns from "./m.js";`);
    expect(names.has("ns")).toBe(true);
  });

  it("ns member is reachable through the export surface", () => {
    const r = runTranspiled(`export * as ns from "./m.js";`, {
      mode: "analyze",
      modules: { "./m.js": numMod() },
    });
    const ns = r.ns as { shape: { slots: Record<string, { value: unknown }> } };
    // inc 槽为 Abs fn 面（调用桥不炸）
    expect(ns.shape.slots.inc).toBeDefined();
    expect(ns.shape.slots.k).toBeDefined();
  });
});

describe("import * as ns — namespace open+path, missing member no false TypeError", () => {
  it("bindImports namespace is open+path (not closed exact obj)", () => {
    const file = parseSource(`import * as ns from "./m.js";`);
    const imp = file.program.body[0];
    expect(imp.type).toBe("ImportDeclaration");
    const env = emptyEnv();
    bindImports(imp as never, env, { "./m.js": numMod() });
    const ns = env.vars.get("ns")!;
    expect(ns.shape.k).toBe("obj");
    expect((ns.shape as { open?: boolean }).open).toBe(true);
    expect(ns.conf).toBe("path");
  });

  it("missing member on bindImports namespace is NOT definitelyUncallable", () => {
    const file = parseSource(`import * as ns from "./m.js";`);
    const env = emptyEnv();
    bindImports(file.program.body[0] as never, env, { "./m.js": numMod() });
    const ns = env.vars.get("ns")!;
    // 修复前：闭 exact 对象 → definitelyUncallableMember → 假抛 TypeError
    expect(definitelyUncallableMember(ns, "notThere")).toBe(false);
  });

  it("namespaceAbsOf shares the open+path contract with run.ts", () => {
    const ns = namespaceAbsOf(numMod());
    expect(ns.shape.k).toBe("obj");
    expect((ns.shape as { open?: boolean }).open).toBe(true);
    expect(ns.conf).toBe("path");
    expect(definitelyUncallableMember(ns, "missing")).toBe(false);
  });

  it("closed exact obj still counts uncallable (regression guard for the rule itself)", () => {
    const closed = abs({ k: "obj", slots: { a: { value: unknown } } }, undefined, undefined, "exact");
    expect(definitelyUncallableMember(closed, "notThere")).toBe(true);
  });

  it("import * as ns then ns.missing() does not throw TypeError (eval path)", () => {
    const r = runTranspiled(
      `import * as ns from "./m.js";
export function go() { return ns.notThere(); }`,
      { mode: "analyze", modules: { "./m.js": numMod() } },
    );
    const res = callTranspiledExportFull(r, "go", []);
    // open+path：缺失成员是分析视图不完整，不得按「运行时缺失」假抛 TypeError
    expect(res.result).toBeDefined();
    // throws 域不得带 TypeError（假抛）
    const throwsShape = res.throws.shape as { k: string; name?: string; members?: Array<{ shape?: { name?: string } }> };
    if (throwsShape.k === "brand" || throwsShape.k === "prim") {
      expect(throwsShape.name).not.toBe("TypeError");
    }
    if (throwsShape.k === "sum") {
      for (const m of throwsShape.members ?? []) {
        expect(m.shape?.name).not.toBe("TypeError");
      }
    }
  });
});

describe("export * as ns via runTranspiled modules table (re-export slot)", () => {
  it("barrel re-exports namespace under name ns", () => {
    const mA: AbsModuleExports = {
      named: {
        a: abs(num().shape, undefined, undefined, "exact"),
      },
    };
    const r = runTranspiled(`export * as ns from "./m.js"; export const b = 42;`, {
      mode: "analyze",
      modules: { "./m.js": mA },
    });
    expect(r.b).toBeDefined();
    expect(litValue(r.b as never)).toBe(42);
    const ns = r.ns as { shape: { k: string; open?: boolean; slots: Record<string, { value: unknown }> } };
    expect(ns.shape.k).toBe("obj");
    expect(ns.shape.open).toBe(true);
    expect(ns.shape.slots.a).toBeDefined();
  });
});
