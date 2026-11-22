/**
 * 跨面投影一致性：dts 与 guard / zod / standard 必须对**同一返回观测**给出
 * 同一口径（BUG-370 的回归钉）。
 *
 * 这里不复刻每个渲染器的字符串断言，而是同时驱动四个面：
 * - dts 文本；
 * - zod 源码形态；
 * - standard 校验器**真执行**；
 * - guard **真执行**。
 *
 * 同时钉住「只拓宽输出位」：未经过 `projectValidatorOutput` 的 tuple 仍按
 * 定长契约拒绝超长数组 ⇒ 防止把输出位规则泄漏到形参 / 手工构造的域。
 */
import { describe, it, expect } from "vitest";
import { analyzeFile } from "@nudojs/service";
import { generateDts } from "../dts-generator.ts";
import { projectValidatorOutput } from "../projection-policy.ts";
import { absToSchemaNode, schemaNodeToZod } from "../schema-generator.ts";
import { absToStandardSchema } from "../standard-schema.ts";
import { generateGuardFunctionFromAbs } from "../guard-generator.ts";
import { loadGeneratedModule } from "./fixtures.ts";

type GuardModule = Record<string, (value: unknown) => boolean>;

const analyzeOutput = (name: string, source: string) => {
  const analysis = analyzeFile(`/test/projection-conformance-${name}.ts`, source);
  const fn = analysis.functions.find((f) => f.name === name)?.combinedAbs;
  if (!fn) throw new Error(`missing analysis for ${name}`);
  return { analysis, output: fn };
};

const TUPLE = analyzeOutput("two", `export function two() { return [1, 2]; }\n`);
const EMPTY = analyzeOutput("empty", `export function empty() { return []; }\n`);
const MIXED = analyzeOutput("mixed", `export function mixed() { return [1, "a"]; }\n`);

async function standardValidator(a: ReturnType<typeof projectValidatorOutput>) {
  const { source } = absToStandardSchema(a, { name: "value_out" });
  const mod = await loadGeneratedModule(source);
  return mod.value_out!["~standard"].validate;
}

async function guardValidator(a: ReturnType<typeof projectValidatorOutput>) {
  const source = generateGuardFunctionFromAbs("isValueOutput", a);
  const mod = (await loadGeneratedModule(source)) as unknown as GuardModule;
  const guard = mod.isValueOutput;
  if (!guard) throw new Error("guard export missing");
  return guard;
}

describe("跨面投影一致性（BUG-370）", () => {
  it("dts 的 number[] 与三个 validator 面对观测元组同口径", async () => {
    expect(generateDts(TUPLE.analysis)).toContain("two(): number[];");

    const projected = projectValidatorOutput(TUPLE.output);
    const zod = schemaNodeToZod(absToSchemaNode(projected).node);
    expect(zod).toContain("z.array(");
    expect(zod).not.toContain("z.tuple(");

    const standard = await standardValidator(projected);
    for (const value of [[], [1], [1, 2, 3], [0, -1]]) {
      expect(standard(value).issues, `standard rejected ${JSON.stringify(value)}`).toBeUndefined();
    }
    expect(standard([1, "x"]).issues?.length).toBeGreaterThan(0);

    const guard = await guardValidator(projected);
    expect(guard([])).toBe(true);
    expect(guard([1, 2, 3])).toBe(true);
    expect(guard([1, "x"])).toBe(false);
  });

  it("输出位规则不得泄漏到未投影 tuple：定长契约仍拒绝超长", async () => {
    const zod = schemaNodeToZod(absToSchemaNode(TUPLE.output).node);
    expect(zod).toContain("z.tuple(");

    const standard = await standardValidator(TUPLE.output);
    expect(standard([1, 2]).issues).toBeUndefined();
    expect(standard([1, 2, 3]).issues?.length).toBeGreaterThan(0);

    const guard = await guardValidator(TUPLE.output);
    expect(guard([1, 2])).toBe(true);
    expect(guard([1, 2, 3])).toBe(false);
  });

  it("空元组与混合元组不进入同构拓宽（各自保持既有口径）", () => {
    expect(generateDts(EMPTY.analysis)).toContain("empty(): unknown[];");
    expect(projectValidatorOutput(EMPTY.output)).toBe(EMPTY.output);
    expect(schemaNodeToZod(absToSchemaNode(EMPTY.output).node)).toContain("z.array(");

    expect(generateDts(MIXED.analysis)).toContain("mixed(): [number, string];");
    expect(projectValidatorOutput(MIXED.output)).toBe(MIXED.output);
    expect(schemaNodeToZod(absToSchemaNode(MIXED.output).node)).toContain("z.tuple(");
  });
});
