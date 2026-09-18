import { describe, it, expect } from "vitest";
import { makeBufferAwareLoadModule } from "../validation.ts";

describe("P0 makeBufferAwareLoadModule sibling sidecar contamination", () => {
  it("does not serve parent sidecar buffer for a different .nudo.js spec", () => {
    const lib = "/proj/lib.js";
    const libSc = "/proj/lib.nudo.js";
    const stdSc = "/proj/std.nudo.js";
    const openText = (p: string) => {
      if (p === libSc) return "export const x = fn({});\n";
      return undefined;
    };
    const load = makeBufferAwareLoadModule(openText);
    // std.nudo.js 未打开 → 不得把 lib.nudo.js buffer 当作 std 返回
    const hit = load("./std.nudo.js", lib);
    // disk miss → undefined（std 不在磁盘测试环境）
    expect(hit).toBeUndefined();
  });

  it("serves parent sidecar buffer for own ambient sidecar spec", () => {
    const lib = "/proj/lib.js";
    const libSc = "/proj/lib.nudo.js";
    const openText = (p: string) =>
      p === libSc ? "export const f = fn({});\n" : undefined;
    const load = makeBufferAwareLoadModule(openText);
    expect(load("./lib.nudo.js", lib)).toBe("export const f = fn({});\n");
  });
});
