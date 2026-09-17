import { describe, it, expect } from "vitest";
import {
  runTranspiled,
  callTranspiledExportFull,
  $lit,
  litValue,
  absToString,
} from "@nudojs/core";

function inferCall(src: string, fnName: string, args: Parameters<typeof $lit>[0][] = []) {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, args.map((a) => $lit(a as never)));
}

describe("C2.2 catch param binding", () => {
  it("binds thrown Error.message as exact string literal", () => {
    const src = `
export function caught() {
  try {
    throw new Error("boom");
  } catch (err) {
    return err.message;
  }
}
`;
    const r = inferCall(src, "caught");
    expect(litValue(r.result)).toBe("boom");
  });

  it("exposes err.name from Error brand", () => {
    const src = `
export function caught() {
  try {
    throw new TypeError("bad");
  } catch (err) {
    return err.name;
  }
}
`;
    const r = inferCall(src, "caught");
    expect(litValue(r.result)).toBe("TypeError");
  });

  it("still binds thrown non-Error values", () => {
    const src = `
export function go() {
  try {
    throw { code: 42 };
  } catch (e) {
    return e.code;
  }
}
`;
    const r = inferCall(src, "go");
    expect(litValue(r.result)).toBe(42);
  });

  it("catch of host Error (non-NudoThrow) still yields message slot", () => {
    const src = `
export function go() {
  try {
    throw new RangeError("oob");
  } catch (e) {
    return e.message;
  }
}
`;
    const r = inferCall(src, "go");
    expect(litValue(r.result)).toBe("oob");
  });
});
