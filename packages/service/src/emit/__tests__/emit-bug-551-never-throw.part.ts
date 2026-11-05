/**
 * Bug 551 —— standard 产物的 `~standard.validate` 在 bigint / 循环对象上**抛
 * TypeError** ⇒ 违反 Standard Schema v1「`validate` 永不抛」的协议。
 *
 * 修前：`lit` 臂的消息构造直接 `JSON.stringify(运行期入参)` ⇒ bigint 抛
 * `TypeError: Do not know how to serialize a BigInt`、循环结构抛
 * `Converting circular structure to JSON` ⇒ 永远到不了返回 `issues` 那一步。
 *
 * 修后：消息构造走**安全描述**（`describeValue` / `__nudoDescribe`：bigint →
 * `"1n"`、循环结构 → `"<unserializable>"`），且整棵校验包在 try/catch 里
 * （异常降级成一条 issue）⇒ `validate` 永远返回 Result。
 *
 * 负控制：正常值仍放行（兜底不得把合法值误拒）。
 */
import { describe, it, expect } from "vitest";
import { abs, numLit, type Abs } from "@nudojs/core";
import { absToSchemaNode } from "../schema-generator.ts";
import { absToStandardSchema, validateSchemaNode } from "../standard-schema.ts";
import { loadGeneratedModule } from "./fixtures.ts";

const litOne = (): Abs =>
  abs({ k: "unknown" }, { op: "lit", value: 1 }, undefined, "exact");

const circular = (): Record<string, unknown> => {
  const o: Record<string, unknown> = {};
  o.self = o;
  return o;
};

/** 带抛错 getter 的对象（取值本身就会抛）。 */
const throwingGetter = (): Record<string, unknown> => ({
  get boom(): never {
    throw new Error("boom");
  },
});

describe("Bug 551: standard 面 validate 永不抛", () => {
  it("库函数版：bigint / 循环对象 / 抛错 getter 都返回 Result 而非抛异常", () => {
    const { node } = absToSchemaNode(litOne());
    for (const v of [1n, circular(), throwingGetter()]) {
      const r = validateSchemaNode(node, v);
      expect(r.issues).toBeDefined();
      expect(r.issues!.length).toBeGreaterThan(0);
    }
  });

  it("生成产物版：validate(bigint) / validate(循环对象) 不抛", async () => {
    const { source } = absToStandardSchema(litOne(), { name: "fOutput" });
    const mod = await loadGeneratedModule(source);
    let bigintResult: { issues?: ReadonlyArray<{ message: string }> } | undefined;
    expect(() => {
      bigintResult = mod.fOutput!["~standard"].validate(1n);
    }).not.toThrow();
    expect(bigintResult?.issues?.[0]?.message).toContain("1n");
    let circResult: { issues?: ReadonlyArray<{ message: string }> } | undefined;
    expect(() => {
      circResult = mod.fOutput!["~standard"].validate(circular());
    }).not.toThrow();
    expect(circResult?.issues?.length).toBeGreaterThan(0);
  });

  it("负控制：合法值仍放行（兜底不得误拒）", async () => {
    const { node } = absToSchemaNode(litOne());
    expect(validateSchemaNode(node, 1)).toEqual({ value: 1 });
    const { source } = absToStandardSchema(litOne(), { name: "fOutput" });
    const mod = await loadGeneratedModule(source);
    expect(mod.fOutput!["~standard"].validate(1)).toEqual({ value: 1 });
  });

  it("负控制：numLit(42) 的消息仍是可读的类型错（不因兜底变成无信息）", () => {
    const { node } = absToSchemaNode(numLit(42));
    const r = validateSchemaNode(node, "x");
    expect(r.issues?.[0]?.message).toContain("expected 42");
  });
});
