/**
 * #64 P3：解构形参的契约要上屏。
 *
 * 侧车 `fn({ grade: string(), findings: … })` 绑定 `decide({ grade, findings })` 时，
 * 签名不得落回 `decide(_p0: any)`——应渲染解构形状与字段契约。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { checkSource, pTrue, formatShape } from "../index.ts";
import { resetCheckSourceMemo } from "../check.ts";
import { resetGeneralizeMemo } from "../generalize.ts";
import { resetNudoModuleExecCache } from "../refine.ts";
import { resetSidecarLoadFailureCache, takeInterfaceDiags } from "../interface.ts";
import { takeRefineDiags } from "../refine.ts";
import { generalizeFromAst } from "../generalize.ts";
import { formalParamSignatureNames, formalParamsFromNodes } from "../param-surface.ts";

function makeFiles(files: Record<string, string>) {
  const resolve = (from: string, spec: string): string => {
    if (!spec.startsWith(".")) return spec;
    const parts = from.split("/").slice(0, -1);
    for (const seg of spec.split("/")) {
      if (seg === "" || seg === ".") continue;
      if (seg === "..") parts.pop();
      else parts.push(seg);
    }
    return parts.join("/");
  };
  return {
    loadModule: (spec: string, from: string): string | undefined =>
      files[resolve(from, spec)],
  };
}

describe("#64 P3 destructured param contracts render in signatures", () => {
  beforeEach(() => {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    resetNudoModuleExecCache();
    resetSidecarLoadFailureCache();
    takeRefineDiags();
    takeInterfaceDiags();
  });

  it("formalParamSignatureNames renders pattern as { bound }", () => {
    const formals = formalParamsFromNodes([
      {
        type: "ObjectPattern",
        properties: [
          { type: "ObjectProperty", key: { type: "Identifier", name: "grade" }, value: { type: "Identifier", name: "grade" } },
          { type: "ObjectProperty", key: { type: "Identifier", name: "findings" }, value: { type: "Identifier", name: "findings" } },
        ],
      },
    ] as never);
    expect(formalParamSignatureNames(formals)).toEqual(["{ grade, findings }"]);
  });

  it("sidecar field contracts project onto the pattern param Abs", () => {
    const { loadModule } = makeFiles({
      "/t/decide.nudo.js":
        `import { fn, string, array, shape } from "@nudojs/core";\n` +
        `const finding = shape({ code: string() });\n` +
        `export const decide = fn({ grade: string(), findings: array(finding) }, string());`,
    });
    const src = `export function decide({ grade, findings }) {\n  return grade;\n}\n`;
    const g = generalizeFromAst("decide", src, {
      refine: { loadModule, fromFile: "/t/decide.js" },
    });
    expect(g).toBeDefined();
    // 形参展示名：解构形状，不是 _p0
    expect(formalParamSignatureNames(g!.formals ?? [])).toEqual(["{ grade, findings }"]);
    // typeParams[0] 应是 obj（字段契约合成），不是 any
    const t = g!.typeParams[0]!.value;
    expect(t.shape.k).toBe("obj");
    if (t.shape.k === "obj") {
      expect(Object.keys(t.shape.slots).sort()).toEqual(["findings", "grade"]);
    }
  });

  it("check report shows destructured contract instead of _p0: any", () => {
    const { loadModule } = makeFiles({
      "/t/decide.nudo.js":
        `import { fn, string, array, shape } from "@nudojs/core";\n` +
        `const finding = shape({ code: string() });\n` +
        `export const decide = fn({ grade: string(), findings: array(finding) }, string());`,
    });
    const src = `export function decide({ grade, findings }) {\n  return grade;\n}\n`;
    const r = checkSource("/t/decide.js", src, pTrue, {
      loadModule,
      fromFile: "/t/decide.js",
    });
    const sig = r.signatures.find((s) => s.name === "decide");
    expect(sig).toBeDefined();
    expect(sig!.params[0]).toBe("{ grade, findings }");
    expect(sig!.paramTypes![0]).not.toBe("any");
    expect(sig!.paramTypes![0]).toContain("grade");
  });
});
