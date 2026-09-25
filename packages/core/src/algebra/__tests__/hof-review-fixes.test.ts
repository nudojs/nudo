/**
 * Review 修复钉死：
 * 1. $call / applyAbsFn 抛错 → never
 * 2. display 不再出现 arr(A1) = A1 噪音
 * 3. refine 契约优先、不重复提升
 * 4. symbolic 截断 → 不写半截 fnRels
 * 5. 双路径：同一 HOF 经 B 导出调用与 $call 结果一致
 */
import { describe, it, expect } from "vitest";
import { parse } from "@babel/parser";
import {
  abs,
  absFunction,
  anyVar,
  bool,
  checkSource,
  generalizeFromAst,
  getFnImpl,
  num,
  numLit,
  pTrue,
  relationFn,
  runTranspiled,
  callTranspiledExportFull,
  type Abs,
} from "../index.ts";

import { $call } from "../exec/call.ts";
import { withStdImport, stdOpts } from "./nudo-constraints.ts";

/** B 路径驱动：runTranspiled + 导出调用（取代 analyzeFn 的求值面） */
function analyzeExport(src: string, fnName: string, args: Abs[]): Abs {
  const run = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(run, fnName, args).result;
}

const a1 = anyVar("A1");
const arrA1 = abs({ k: "arr", element: a1 }, undefined, undefined, "path");

function throwFnAbs(): Abs {
  const src = 'function boom(x) { throw "bad"; }';
  const ast = parse(src, { sourceType: "script" });
  const decl = ast.program.body[0]!;
  if (decl.type !== "FunctionDeclaration") throw new Error("bad fixture");
  return absFunction(["x"], { body: decl.body });
}

describe("regression: $call / applyAbsFn body throw → never", () => {
  it("$call on throwing body returns never, not intermediate value", () => {
    const f = throwFnAbs();
    expect(getFnImpl(f)?.body).toBeDefined();
    const out = $call(f, [num()]);
    expect(out.shape.k).toBe("never");
    expect(out.conf).toBe("exact");
  });

  it("B export call on throwing named fn also yields never result", () => {
    const src = `
      export function boom(x) {
        throw "bad";
      }
    `;
    const r = analyzeExport(src, "boom", [numLit(1)]);
    expect(r.shape.k).toBe("never");
  });
});

describe("regression: format display has no arr(A1) = A1 noise", () => {
  it("processItems display pins items: arr(A1) without outer α term", () => {
    const src = `
      export function processItems(items, transform, filter) {
        return items.filter(filter).map(transform);
      }
    `;
    const g = generalizeFromAst("processItems", src);
    expect(g).toBeDefined();
    if (!g) return;
    expect(g.display).toContain("items: arr(A1)");
    expect(g.display).not.toContain("arr(A1) = A1");
    expect(g.display).toContain("B:transform");
  });
});

describe("P2: refine contract wins, no re-promotion", () => {
  it("items refined as array → entryShapes source=refine, not promote", () => {
    const src = withStdImport(`
      /**
       * @nudo:contract items positives
       */
      export function processItems(items, transform, filter) {
        return items.filter(filter).map(transform);
      }
    `);
    const g = generalizeFromAst("processItems", src, { refine: stdOpts });
    expect(g).toBeDefined();
    if (!g) return;
    const items = g.entryShapes?.get("items");
    // refine 契约必须落 entryShapes（source=refine），不得被 promote 覆盖
    expect(items).toBeDefined();
    expect(items!.source).toBe("refine");
    // 回调形参仍靠挂载点③提升
    expect(g.fnRels?.has("transform")).toBe(true);
    expect(g.fnRels?.get("transform")!.source).toBe("promote");
  });
});

describe("P2: truncated symbolic discards partial relations", () => {
  it("call-budget truncation → fnRels/entryShapes/hofSites undefined", () => {
    const src = `
      function forever(f) {
        f();
        return forever(f);
      }
    `;
    const g = generalizeFromAst("forever", src);
    expect(g).toBeDefined();
    if (!g) return;
    // 截断后 symbolic 为 opaque → 不可缓存 → 不写半截关系
    // （instantiate→B 实验已回退：B 的递归 partial 与 ast-eval opaque
    // 语义不同——opaque 门保留，静态关系也随门一起走）
    expect(g.symbolic.conf).toBe("opaque");
    expect(g.fnRels).toBeUndefined();
    expect(g.entryShapes).toBeUndefined();
    expect(g.hofSites).toBeUndefined();
  });
});

describe("P1c: true dual-path consistency (same HOF, two hosts)", () => {
  it("processItems via B export call and via $call on relation callbacks agree on β", () => {
    const src = `
      export function processItems(items, transform, filter) {
        return items.filter(filter).map(transform);
      }
    `;
    const transform = relationFn(
      [a1],
      abs({ k: "any" }, { op: "var", id: "B1" }, undefined, "path"),
    );
    const filter = relationFn([a1], bool());
    const viaAst = analyzeExport(src, "processItems", [arrA1, transform, filter]);
    expect(viaAst.shape.k).toBe("arr");
    if (viaAst.shape.k !== "arr") return;
    expect(viaAst.shape.element.term).toEqual({ op: "var", id: "B1" });

    const viaCall = $call(transform, [a1]);
    expect(viaCall.term).toEqual({ op: "var", id: "B1" });
    expect(viaAst.shape.element.term).toEqual(viaCall.term);
  });

  it("$call body-bearing recursive fn truncates (call-budget, no hang)", () => {
    const src = `
      export function loop(n) {
        return loop(n);
      }
    `;
    const r = analyzeExport(src, "loop", [numLit(0)]);
    expect(r.shape.k).toBeDefined();
    expect(
      r.conf === "opaque" || r.shape.k === "unknown" || r.shape.k === "never",
    ).toBe(true);
  });
});

describe("P4: promote source stays warning", () => {
  it("non-fn arg to promote-sourced HOF param is warning, not error", () => {
    // constraint 语言目前无 fn 形状，refine→error 分支暂不可经 checkSource 触达；
    // 钉住 promote→warning，避免误升 error 破坏 commander 零误报门禁。
    const src = `
      export function processItems(items, transform, filter) {
        return items.filter(filter).map(transform);
      }
      function bad() {
        return processItems([1, 2, 3], 42, (x) => x > 0);
      }
    `;
    const r = checkSource("t.js", src, pTrue);
    const hit = r.issues.find(
      (i) => i.code === "nudo:arg-structure" && i.message?.includes("transform"),
    );
    expect(hit).toBeDefined();
    expect(hit!.severity).toBe("warning");
  });
});

describe("instantiate: shape promotion still fires (throwaway collector)", () => {
  it("processItems instantiated with any args promotes items→arr, not stuck unknown", () => {
    const src = `
      export function processItems(items, transform, filter) {
        return items.filter(filter).map(transform);
      }
    `;
    const g = generalizeFromAst("processItems", src);
    expect(g).toBeDefined();
    if (!g) return;
    // 形参仍 any 时，instantiate 重跑靠挂载点①/③ 提升，body 能继续
    const r = g.instantiate([a1, a1, a1]);
    expect(r.shape.k).toBe("arr");
    // 关系不因 instantiate 污染 PolyFn 共享槽
    expect(g.entryShapes?.get("items")?.source).toBe("promote");
  });

  it("instantiate does not mutate typeParams / PolyFn fnRels identity", () => {
    const src = `
      export function processItems(items, transform, filter) {
        return items.filter(filter).map(transform);
      }
    `;
    const g = generalizeFromAst("processItems", src);
    if (!g) return;
    const itemsIdx = g.params.indexOf("items");
    const tpBefore = g.typeParams[itemsIdx]!;
    const relBefore = g.fnRels?.get("transform")?.abs;
    g.instantiate([a1, a1, a1]);
    expect(g.typeParams[itemsIdx]).toBe(tpBefore);
    expect(tpBefore.value.shape.k).toBe("any");
    if (relBefore) {
      expect(g.fnRels?.get("transform")?.abs).toBe(relBefore);
    }
  });
});
