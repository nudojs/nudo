import { describe, it, expect } from "vitest";
import { collectBPathDiagnostics } from "../bpath-diagnostics.ts";

describe("C2.2 catch params are not builtin-unknown", () => {
  it("does not flag catch (e) body references", () => {
    const src = `
export function f() {
  try {
    throw new Error("x");
  } catch (e) {
    return e.message;
  }
}
`;
    const d = collectBPathDiagnostics(src);
    expect(d.builtinUnknown.map((x) => x.name)).not.toContain("e");
  });

  it("still flags free unknown globals", () => {
    const src = `
export function f() {
  return WeakRef;
}
`;
    const d = collectBPathDiagnostics(src);
    expect(d.builtinUnknown.some((x) => x.name === "WeakRef")).toBe(true);
  });
});
