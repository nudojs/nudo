/**
 * T9：constraint fn 形状 → refine→error 可测路径。
 * 侧车 `fn({ transform: fn({x: number()}, number()) }, …)` 的 transform 槽
 * 经 constraintToEntryAbs 落成 shape.k==="fn"，generalize 归入 fnRels[source=refine]；
 * 调用点传非可调用实参 → nudo:arg-structure **error**（promote 仍是 warning）。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkSource, pTrue, constraintToEntryAbs, fn, number } from "../index.ts";

describe("constraint fn() → entry Abs is fn shape", () => {
  it("param-level fn() constraint → fn Abs", () => {
    // processItems 的 transform 槽：fnConstraintToEntryReqs 取出的单项约束
    const transformC = fn({ x: number() }, number());
    const entry = constraintToEntryAbs(transformC, "transform");
    expect(entry.shape.k).toBe("fn");
    expect(entry.shape).toMatchObject({ params: ["x"] });
    const fnShape = entry.shape as {
      paramTypes: Array<{ shape: { k: string } }>;
      returnType: { shape: { k: string } };
    };
    expect(fnShape.paramTypes).toHaveLength(1);
    expect(fnShape.paramTypes[0]!.shape.k).toBe("prim");
    expect(fnShape.returnType.shape.k).toBe("prim");
    expect(entry.conf).toBe("path");
  });

  it("top-level fn constraint → fn Abs", () => {
    const c = fn({ x: number() }, number());
    const entry = constraintToEntryAbs(c, "cb");
    expect(entry.shape.k).toBe("fn");
    expect(entry.conf).toBe("path");
  });
});

describe("refine-sourced HOF arg-structure is error", () => {
  it("sidecar fn({transform: fn(...)}) + non-callable arg → error", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-hof-refine-"));
    try {
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({ name: "hof-refine", version: "1.0.0", nudo: {} }),
      );
      const srcPath = join(dir, "lib.js");
      const src = `export function processItems(items, transform) {
  return items.map(transform);
}
export function bad() {
  return processItems([1, 2, 3], 42);
}
`;
      writeFileSync(srcPath, src);
      const side = `import { fn, number, array } from "@nudojs/core";
export const processItems = fn({
  items: array(number()),
  transform: fn({ x: number() }, number()),
}, array(number()));
`;
      writeFileSync(join(dir, "lib.nudo.js"), side);
      const r = checkSource(srcPath, src, pTrue, {
        fromFile: srcPath,
        loadModule: (spec) => (spec.endsWith("lib.nudo.js") ? side : undefined),
        autoBind: true,
        projectDir: dir,
      });
      const hits = r.issues.filter(
        (i) => i.code === "nudo:arg-structure" && i.message?.includes("transform"),
      );
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0]!.severity).toBe("error");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
