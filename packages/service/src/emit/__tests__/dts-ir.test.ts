import { describe, it, expect } from "vitest";
import { renderDtsParams, type DtsParam } from "../dts-ir.ts";

const p = (
  name: string,
  type: string,
  extra: Partial<DtsParam> = {},
): DtsParam => ({ name, type, optional: false, ...extra });

describe("dts 参数 IR 打印器", () => {
  it("尾部可选位发 `?`", () => {
    expect(renderDtsParams([p("a", "number"), p("b", "string", { optional: true })])).toEqual([
      "a: number",
      "b?: string",
    ]);
  });

  it("可选位后仍有必填位 ⇒ 降级成 `T | undefined`（TS1016）", () => {
    expect(renderDtsParams([p("a", "number", { optional: true }), p("b", "string")])).toEqual([
      "a: number | undefined",
      "b: string",
    ]);
  });

  it("显式 unionText 优先于默认 `| undefined`", () => {
    expect(
      renderDtsParams([
        p("a", "number", { optional: true, unionText: "number | null" }),
        p("b", "string"),
      ]),
    ).toEqual(["a: number | null", "b: string"]);
  });

  it("rest 位不触发 TS1016：可选位后跟 rest 仍用 `?`", () => {
    expect(
      renderDtsParams([
        p("a", "number", { optional: true }),
        p("...rest", "string[]", { isRest: true }),
      ]),
    ).toEqual(["a?: number", "...rest: string[]"]);
  });

  it("纯函数：不改写入参，重复渲染同结果", () => {
    const slots = [p("a", "number", { optional: true }), p("b", "string")];
    const first = renderDtsParams(slots);
    expect(renderDtsParams(slots)).toEqual(first);
    expect(slots[0]).toEqual({ name: "a", type: "number", optional: true });
  });
});
