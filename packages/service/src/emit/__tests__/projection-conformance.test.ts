/**
 * 跨面投影一致性：dts 与 guard / zod / standard 必须对**同一返回观测**给出
 * 同一口径（BUG-370 的回归钉 + case 域的负控制）。
 *
 * 这里不复刻每个渲染器的字符串断言，而是同时驱动四个面：
 * - dts 文本；
 * - zod 源码形态；
 * - standard 校验器**真执行**；
 * - guard **真执行**。
 *
 * 三种 widen 模式各有负控制：
 * - `observed`：一次采样 ⇒ 标量/对象槽/同构元组都到基类型；
 * - `scalar`：`@nudo:case` 域 ⇒ 只拓宽顶层标量，元组位置保持；
 * - `none`：契约 / 声明字面量 ⇒ 原样保留。
 */
import { describe, it, expect } from "vitest";
import { analyzeFile } from "@nudojs/service";
import { generateDts } from "../dts-generator.ts";
import { projectValidatorOutput, type ReturnWidenMode } from "../projection-policy.ts";
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

const SIGNATURES = {
  tuple: analyzeOutput("tupleFn", `export function tupleFn() { return [1, 2]; }\n`),
  empty: analyzeOutput("emptyFn", `export function emptyFn() { return []; }\n`),
  mixed: analyzeOutput("mixedFn", `export function mixedFn() { return [1, "a"]; }\n`),
  scalar: analyzeOutput("scalarFn", `export function scalarFn() { return 1; }\n`),
  object: analyzeOutput("objectFn", `export function objectFn() { return { a: 1 }; }\n`),
  objTuple: analyzeOutput(
    "objTupleFn",
    `export function objTupleFn() { return [{ a: 1 }, { a: 2 }]; }\n`,
  ),
};

const DIRECTIVE_TUPLE = analyzeOutput(
  "directiveTuple",
  `/**\n * @nudo:case "x" () => [1, 2]\n */\nexport function directiveTuple() { return [1, 2]; }\n`,
);
const DIRECTIVE_SCALAR = analyzeOutput(
  "directiveScalar",
  `/**\n * @nudo:case "x" () => 1\n */\nexport function directiveScalar() { return 1; }\n`,
);

const projected = (a: ReturnWidenMode, output: (typeof SIGNATURES.tuple)["output"]) =>
  projectValidatorOutput(output, a);

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
  it("observed：dts 的 number[] 与三个 validator 面同口径", async () => {
    expect(generateDts(SIGNATURES.tuple.analysis)).toContain("tupleFn(): number[];");

    const a = projected("observed", SIGNATURES.tuple.output);
    const zod = schemaNodeToZod(absToSchemaNode(a).node);
    expect(zod).toContain("z.array(");
    expect(zod).not.toContain("z.tuple(");

    const standard = await standardValidator(a);
    for (const value of [[], [1], [1, 2, 3], [0, -1]]) {
      expect(standard(value).issues, `standard rejected ${JSON.stringify(value)}`).toBeUndefined();
    }
    expect(standard([1, "x"]).issues?.length).toBeGreaterThan(0);

    const guard = await guardValidator(a);
    expect(guard([])).toBe(true);
    expect(guard([1, 2, 3])).toBe(true);
    expect(guard([1, "x"])).toBe(false);
  });

  it("observed：标量 / 对象槽 / 对象元组都到基类型（dts 同口径）", async () => {
    expect(generateDts(SIGNATURES.scalar.analysis)).toContain("scalarFn(): number;");
    const scalar = projected("observed", SIGNATURES.scalar.output);
    expect(schemaNodeToZod(absToSchemaNode(scalar).node)).not.toContain("z.literal(1)");
    const scalarStd = await standardValidator(scalar);
    expect(scalarStd(2).issues).toBeUndefined();
    const scalarGuard = await guardValidator(scalar);
    expect(scalarGuard(2)).toBe(true);

    expect(generateDts(SIGNATURES.object.analysis)).toContain("objectFn(): { a: number };");
    const object = projected("observed", SIGNATURES.object.output);
    expect(schemaNodeToZod(absToSchemaNode(object).node)).not.toContain("z.literal(1)");
    const objectStd = await standardValidator(object);
    expect(objectStd({ a: 2 }).issues).toBeUndefined();
    const objectGuard = await guardValidator(object);
    expect(objectGuard({ a: 2 })).toBe(true);

    expect(generateDts(SIGNATURES.objTuple.analysis)).toContain(
      "objTupleFn(): { a: number }[];",
    );
    const objTuple = projected("observed", SIGNATURES.objTuple.output);
    expect(schemaNodeToZod(absToSchemaNode(objTuple).node)).toContain("z.array(");
    const objTupleStd = await standardValidator(objTuple);
    expect(objTupleStd([{ a: 3 }, { a: 4 }]).issues).toBeUndefined();
    const objTupleGuard = await guardValidator(objTuple);
    expect(objTupleGuard([{ a: 3 }, { a: 4 }])).toBe(true);
  });

  it("scalar：case 域只拓宽顶层标量，元组位置保持定长", async () => {
    expect(generateDts(DIRECTIVE_TUPLE.analysis)).toContain("directiveTuple(): [1, 2];");
    const tuple = projected("scalar", DIRECTIVE_TUPLE.output);
    expect(tuple.shape.k).toBe("tuple");
    expect(schemaNodeToZod(absToSchemaNode(tuple).node)).toContain("z.tuple(");
    const tupleStd = await standardValidator(tuple);
    expect(tupleStd([1, 2]).issues).toBeUndefined();
    expect(tupleStd([1, 2, 3]).issues?.length).toBeGreaterThan(0);
    const tupleGuard = await guardValidator(tuple);
    expect(tupleGuard([1, 2])).toBe(true);
    expect(tupleGuard([1, 2, 3])).toBe(false);

    expect(generateDts(DIRECTIVE_SCALAR.analysis)).toContain("directiveScalar(): number;");
    const scalar = projected("scalar", DIRECTIVE_SCALAR.output);
    expect(schemaNodeToZod(absToSchemaNode(scalar).node)).not.toContain("z.literal(1)");
    const scalarStd = await standardValidator(scalar);
    expect(scalarStd(2).issues).toBeUndefined();
  });

  it("none：契约 / 声明字面量原样保留", () => {
    const scalar = projected("none", SIGNATURES.scalar.output);
    expect(scalar).toBe(SIGNATURES.scalar.output);
    expect(schemaNodeToZod(absToSchemaNode(scalar).node)).toContain("z.literal(1)");
  });

  it("空元组与混合元组不进入同构折叠（各自保持既有口径）", () => {
    expect(generateDts(SIGNATURES.empty.analysis)).toContain("emptyFn(): unknown[];");
    expect(projected("observed", SIGNATURES.empty.output).shape.k).toBe("tuple");
    expect(schemaNodeToZod(absToSchemaNode(SIGNATURES.empty.output).node)).toContain("z.array(");

    expect(generateDts(SIGNATURES.mixed.analysis)).toContain("mixedFn(): [number, string];");
    const mixed = projected("observed", SIGNATURES.mixed.output);
    expect(mixed.shape.k).toBe("tuple");
    expect(schemaNodeToZod(absToSchemaNode(mixed).node)).toContain("z.tuple(");
  });
});
