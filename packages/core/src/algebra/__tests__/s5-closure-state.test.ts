import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, litValue, checkSource, pTrue } from "@nudojs/core";

describe("S5 closure cross-call state (B-path)", () => {
  it("increment then getCount sees 1", () => {
    const r = callTranspiledExportFull(
      runTranspiled(
        `export function f() {
          function createCounter() {
            let count = 0;
            return {
              increment() { count = count + 1; return count; },
              getCount() { return count; }
            };
          }
          const c = createCounter();
          c.increment();
          return c.getCount();
        }`,
        { mode: "analyze" },
      ),
      "f",
      [],
    );
    expect(litValue(r.result)).toBe(1);
  });

  it("two increments then getCount sees 2", () => {
    const r = callTranspiledExportFull(
      runTranspiled(
        `export function f() {
          function createCounter() {
            let count = 0;
            return {
              increment() { count = count + 1; return count; },
              getCount() { return count; }
            };
          }
          const c = createCounter();
          c.increment();
          c.increment();
          return c.getCount();
        }`,
        { mode: "analyze" },
      ),
      "f",
      [],
    );
    expect(litValue(r.result)).toBe(2);
  });

  it("check signature of use() is not unknown", () => {
    const src = `
function createCounter() {
  let count = 0;
  return {
    increment() { count = count + 1; return count; },
    getCount() { return count; }
  };
}
export function use() {
  const c = createCounter();
  c.increment();
  return c.getCount();
}
`;
    const r = checkSource("t.js", src, pTrue);
    const useSig = (r.signatures ?? []).find(
      (s: { name?: string }) => s.name === "use",
    ) as { display?: string } | undefined;
    expect(useSig).toBeDefined();
    expect(useSig!.display ?? "").not.toMatch(/^unknown/);
  });
});
