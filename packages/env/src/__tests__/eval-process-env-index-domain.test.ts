/** process.env / process.versions 的开放对象 + 索引值域声明与读面同源。 */
import { describe, it, expect } from "vitest";
import { defineEnv } from "../node.ts";
import { formatShape, $get, type Abs } from "@nudojs/core";

const processGlobal = (): Abs => {
  const p = defineEnv().globals?.["process"];
  expect(p, "process global missing").toBeTruthy();
  return p!;
};

const slotOf = (o: Abs, key: string): Abs | undefined => {
  const inner = o.shape.k === "brand" ? (o.shape.shape as Abs) : o;
  return inner.shape.k === "obj" ? inner.shape.slots[key]?.value : undefined;
};

const indexValueOf = (o: Abs): Abs | undefined => {
  const inner = o.shape.k === "brand" ? (o.shape.shape as Abs) : o;
  return inner.shape.k === "obj" ? inner.shape.index?.value : undefined;
};

describe("process 开放对象索引值域", () => {
  it("env/versions 声明：open + 索引值域 + 展示面", () => {
    const env = processGlobal();
    const penv = slotOf(env, "env")!;
    const pver = slotOf(env, "versions")!;
    for (const node of [penv, pver]) {
      const inner = node.shape.k === "brand" ? (node.shape.shape as Abs) : node;
      expect(inner.shape.k).toBe("obj");
      expect((inner.shape as { open?: boolean }).open).toBe(true);
      expect(indexValueOf(node)).toBeTruthy();
    }
    expect(formatShape(indexValueOf(penv)!)).toContain("string");
    expect(formatShape(indexValueOf(penv)!)).toContain("undefined");
    expect(formatShape(indexValueOf(pver)!)).toBe("string");
    expect(formatShape(penv)).toContain("string | undefined");
  });

  it("读面与展示面同源：HOME → string | undefined，versions.node → string", () => {
    const penv = slotOf(processGlobal(), "env")!;
    const pver = slotOf(processGlobal(), "versions")!;
    expect(formatShape($get(penv, "HOME"))).toBe("string | undefined");
    expect(formatShape($get(pver, "node"))).toBe("string");
  });
});
