/**
 * BUG-203 —— zod 面把 Abs 的长度界（**UTF-16 码元**）一对一映射成 zod v4 的
 * `.min()/.max()`（**Unicode 码点**）⇒ 含星平面字符时 zod 面与契约 / guard /
 * standard 三面裁决相反（min 假红 / max 假绿）⇒ 四面互斥。
 *
 * 修法：用 `refine` 显式按 UTF-16 长度判定，与 guard 面的 `data.length >= n`、
 * standard 面的 `strMin/strMax` 同口径。
 */
import { describe, it, expect } from "vitest";
import { schemaNodeToZod } from "../emit/schema-generator.ts";

describe("BUG-203 —— zod 长度界按 UTF-16 码元", () => {
  it("strMin / strMax 用 refine 写 .length（不是 .min()/.max()）", () => {
    const min = schemaNodeToZod({
      k: "prim",
      type: "string",
      refinements: [{ kind: "strMin", n: 2 }],
    });
    expect(min).toBe("z.string().refine((s) => s.length >= 2)");
    expect(min).not.toContain(".min(2)");

    const max = schemaNodeToZod({
      k: "prim",
      type: "string",
      refinements: [{ kind: "strMax", n: 1 }],
    });
    expect(max).toBe("z.string().refine((s) => s.length <= 1)");
    expect(max).not.toContain(".max(1)");
  });

  it("对照：无长度界时仍是纯 z.string()", () => {
    expect(schemaNodeToZod({ k: "prim", type: "string", refinements: [] })).toBe("z.string()");
  });
});
