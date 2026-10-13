/**
 * 短路/三元 mutator 臂隔离 + fork join 绑定（P2：不用 undefined 当哨兵）。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { callLit as call } from "./eval-helpers.ts";

describe("short-circuit mutator fork join", () => {
  it("concrete true && pop still mutates; false does not", () => {
    expect(
      litValue(
        call(
          `
export function f() {
  const a = [1, 2, 3];
  true && a.pop();
  return a.length;
}
`,
          "f",
        ).result,
      ),
    ).toEqual({ ok: true, value: 2 });
    expect(
      litValue(
        call(
          `
export function f() {
  const a = [1, 2, 3];
  false && a.pop();
  return a.length;
}
`,
          "f",
        ).result,
      ),
    ).toEqual({ ok: true, value: 3 });
  });

  it("ternary arms isolate mutators", () => {
    expect(
      litValue(
        call(
          `
export function f() {
  const a = [1, 2, 3];
  const x = false ? a.pop() : 0;
  return a.length;
}
`,
          "f",
        ).result,
      ),
    ).toEqual({ ok: true, value: 3 });
  });
});
