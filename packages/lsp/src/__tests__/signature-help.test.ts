import { describe, it, expect } from "vitest";
import {
  relationFn,
  shapeOnlyFn,
  absFunction,
  num,
  str,
  formatShape,
  type Abs,
} from "@nudojs/core";
import { buildSignatureHelp } from "../signature-help.ts";

describe("buildSignatureHelp (LSP-G7)", () => {
  it("projects paramTypes and returnType, not unknown placeholders", () => {
    const fn = relationFn([num(), str()], str(), {
      params: ["ms", "tag"],
    });
    const help = buildSignatureHelp(fn, 0);
    expect(help).not.toBeNull();
    const label = help!.signatures[0]!.label;
    expect(label).toContain("ms");
    expect(label).toContain("number");
    expect(label).toContain("tag");
    expect(label).toContain("string");
    expect(label).not.toContain("unknown");
    expect(help!.activeParameter).toBe(0);
  });

  it("missing paramTypes fall back to any (unconstrained), not unknown", () => {
    const fn = absFunction(["x", "y"], { body: () => num() });
    const help = buildSignatureHelp(fn, 1);
    const label = help!.signatures[0]!.label;
    expect(label).toContain("x: any");
    expect(label).toContain("y: any");
    // 无 returnType → unknown = 推导失败面（诚实）
    expect(label).toContain("=> unknown");
    expect(help!.activeParameter).toBe(1);
  });

  it("rest and optional labels keep markers", () => {
    const fn = shapeOnlyFn([str(), num()], num(), {
      params: ["...paths", "opts?"],
    });
    const label = buildSignatureHelp(fn, 0)!.signatures[0]!.label;
    expect(label).toContain("...paths");
    expect(label).toContain("opts?:");
    expect(label).toContain("=> number");
  });

  it("rejects non-fn Abs", () => {
    expect(buildSignatureHelp(num(), 0)).toBeNull();
    expect(buildSignatureHelp(null as never, 0)).toBeNull();
  });

  it("documentation carries formatShape of the fn", () => {
    const fn = relationFn([num()], num(), { params: ["n"] });
    const help = buildSignatureHelp(fn, 0)!;
    const doc = help.signatures[0]!.documentation;
    expect(doc).toBeDefined();
    const text = typeof doc === "string" ? doc : (doc as { value: string }).value;
    expect(text).toContain(formatShape(fn));
  });

  it("unconstrained display stays any, never unknown, for typed arity-only fns", () => {
    const fn: Abs = {
      shape: { k: "fn", params: ["a", "b"] },
      conf: "exact",
    };
    const label = buildSignatureHelp(fn, 0)!.signatures[0]!.label;
    expect(label).toBe("(a: any, b: any) => unknown");
  });
});
