/**
 * 模块套件：schema 投影形态面（brand / bigint / 标准面 / 容器槽位 / 可空包装）。
 */
import { describe, it, expect, afterAll, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { formatContractSurfaceLine, contractSurface } from "../contract-surface.ts";
import { num, type Abs, type FormalParam, abs, constraintToEntryAbs, lit, numLit, v, type NudoConstraint, str, gt, ge, lt, le, type Pred, objOf, execNudoModule, effectiveContract, checkSource, pTrue, strLit, absToConstraint, app, number, predToString, formatShape } from "@nudojs/core";
import { absToStandardSchemaFunction, absToStandardSchema, absToStandardSchemaModule, validateSchemaNode } from "../standard-schema.ts";
import { loadGeneratedModule } from "./fixtures.ts";
import { absToSchemaNode, absToSchemaSource, schemaNodeToZod, absToZodSchemaModule, constraintToSchemaNode, } from "../schema-generator.ts";
import ts from "typescript";
import { absToDtsTypeText as absToTSType } from "../dts-type.ts";
import { tscNoEmit } from "./dts-tsc.ts";
import { emitContract } from "../contract-emitter.ts";
import { materializeAction, wrapReturnNullable } from "../quickfix-edits.ts";
import { generateGuardFunctionFromAbs } from "../guard-generator.ts";
import { absLit } from "@nudojs/core/internal";
import { analyzeFile, type AnalysisResult, type FunctionAnalysis } from "@nudojs/service";
import { serializeCaseArg, buildCaseDirective, insertGeneratedCaseDirectives } from "../case-emitter.ts";

// ---------------------------------------------------------------------------
// bigint 字面量契约不得让契约面崩溃
// ---------------------------------------------------------------------------
describe("bigint 字面量契约不得让契约面崩溃", () => {
/**
 * 契约面遇 **bigint 字面量契约** 不得整条命令崩溃。
 *
 * 病灶：`constraintToJson` 用 `JSON.parse(JSON.stringify(c))` 落盘 ⇒ JSON
 * **无法表示 bigint** ⇒ `JSON.stringify` 直接抛 `TypeError: Do not know how
 * to serialize a BigInt` ⇒ `nudo contract` 整条命令 exit 1（裸异常，无文件、
 * 无诊断码）；而 `nudo check` / `health` / `test` 对同一份文件全绿。
 *
 * 本测试钉住：
 * - bigint 字面量契约**正常出结果**（不抛、不崩）；
 * - 缓存落盘用**带类型标签**的编码（bigint 以十进制字符串留存），读回可还原；
 * - 负控制：普通字面量契约的显示与往返不受影响。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function makeFixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "nudo-contract-534-"));
  dirs.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
  }
  return root;
}

/** 递归列出目录下的全部文件（缓存分片目录：<root>/<ns>/<xx>/<hash>.json） */
function collectFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    let names: string[];
    try {
      names = readdirSync(d);
    } catch {
      return;
    }
    for (const name of names) {
      const p = join(d, name);
      let isDir = false;
      try {
        isDir = statSync(p).isDirectory();
      } catch {
        continue;
      }
      if (isDir) walk(p);
      else out.push(p);
    }
  };
  walk(dir);
  return out;
}

const SRC_JS = `export function g(n) {
  return n;
}
`;

const BIGINT_NUDO_JS = `
import { fn, lit } from "@nudojs/core";
export const g = fn({ n: lit(10n) }, lit(10n));
`;

const NUMBER_NUDO_JS = `
import { fn, lit } from "@nudojs/core";
export const g = fn({ n: lit(10) }, lit(10));
`;

const INFINITY_NUDO_JS = `
import { fn, lit } from "@nudojs/core";
export const g = fn({ n: lit(Infinity) }, lit(Infinity));
`;

async function runWithCache(
  file: string,
  cacheDir: string,
): Promise<{ lines: string[]; cacheRaw: string }> {
  const prev = process.env.NUDO_CACHE_DIR;
  process.env.NUDO_CACHE_DIR = cacheDir;
  try {
    const entries = await contractSurface(file);
    const cacheFiles = collectFiles(cacheDir);
    return {
      lines: entries.map(formatContractSurfaceLine),
      cacheRaw: cacheFiles.map((p) => readFileSync(p, "utf8")).join("\n"),
    };
  } finally {
    if (prev === undefined) delete process.env.NUDO_CACHE_DIR;
    else process.env.NUDO_CACHE_DIR = prev;
  }
}


  it("bigint 字面量契约正常出结果（改前：抛 Do not know how to serialize a BigInt）；往返保真：Infinity 字面量读回仍是 Infinity（改前：JSON ⇒ null ⇒ lit(null)）；负控制：普通数字字面量契约显示与往返不变", async () => {
  {
    const root = makeFixture({ "c.js": SRC_JS, "c.nudo.js": BIGINT_NUDO_JS });
    const file = join(root, "c.js");
    const cacheDir = join(root, ".cache");

    const cold = await runWithCache(file, cacheDir);
    expect(cold.lines).toHaveLength(1);
    expect(cold.lines[0]).toContain("g");
    // bigint 保 `n` 后缀（）：`lit(10)` 与 `lit(10n)` 在诊断文本里必须
    // 可区分 —— 否则「expected:」陈述的是**另一条契约**（抄回侧车即得相反契约）。
    // 本用例的诉求是「不崩」，渲染形态按 361 走。
    expect(cold.lines[0]).toContain("n: lit(10n)");

    // 热跑（缓存命中）同样不崩、显示一致
    const hot = await runWithCache(file, cacheDir);
    expect(hot.lines).toEqual(cold.lines);

    // 落盘用带类型标签的编码：bigint 以十进制字符串留存（不被 JSON 丢弃/抛错）
    expect(hot.cacheRaw).toContain('"t":"bigint"');
    expect(hot.cacheRaw).toContain('"v":"10"');
  }
  {
    const root = makeFixture({ "c.js": SRC_JS, "c.nudo.js": INFINITY_NUDO_JS });
    const file = join(root, "c.js");
    const cacheDir = join(root, ".cache");

    const cold = await runWithCache(file, cacheDir);
    expect(cold.lines[0]).toContain("lit(Infinity)");
    const hot = await runWithCache(file, cacheDir);
    expect(hot.lines).toEqual(cold.lines);
    expect(hot.lines[0]).not.toContain("lit(null)");
  }
  {
    const root = makeFixture({ "c.js": SRC_JS, "c.nudo.js": NUMBER_NUDO_JS });
    const file = join(root, "c.js");
    const cacheDir = join(root, ".cache");

    const cold = await runWithCache(file, cacheDir);
    expect(cold.lines[0]).toContain("n: lit(10)");
    const hot = await runWithCache(file, cacheDir);
    expect(hot.lines).toEqual(cold.lines);
    expect(hot.cacheRaw).not.toContain('"t":"bigint"');
  }
});



});

// ---------------------------------------------------------------------------
// standard 入参面不得把解构字段平铺成整参校验器
// ---------------------------------------------------------------------------
describe("standard 入参面不得把解构字段平铺成整参校验器", () => {
/**
 * **standard 面**对**解构形参**把契约的**字段级**条目**平铺成整参
 * 校验器**导出 ⇒ `act_a.validate({a:1,b:2})` 拒绝正确入参、`act_a.validate(1)`
 * 放行错误入参（双向都错）；且导出名与 zod 面（`<fn>Input`）不一致。
 *
 * 修后（产物生成侧，本分片）：入参面口径与 zod 面对齐——
 * - `<fn>Input`：校验**整个入参对象**（入参条目的对象投影）；
 * - `<fn>_<param>`：**整参**校验器（一个形参一个）；
 * - **解构形参的字段不提升为顶层整参校验器**（字段级校验器与整参校验器同名
 * 同形、语义却不同 ⇒ 消费方必然误用）。
 *
 * 负控制：具名形参（`act(a, b)`）的 `<fn>_<param>` 仍是真的整参校验器。
 */





/** 解构形参 `{ a, b }` 的形参表面（core `formalParamsFromNodes` 的形态）。 */
const patternFormals: FormalParam[] = [
  {
    kind: "pattern",
    placeholder: "_p0",
    bound: ["a", "b"],
    propKey: { a: "a", b: "b" },
    nested: [],
    nestedPaths: [],
    index: 0,
  },
];

/** 具名形参 `a, b` 的形参表面。 */
const namedFormals: FormalParam[] = [
  { kind: "id", name: "a", index: 0 },
  { kind: "id", name: "b", index: 1 },
];


  it("解构形参：出 `<fn>Input` 对象校验器，且**不出**字段级顶层校验器；具名形参：`<fn>_<param>` 仍是真的整参校验器（负控制）；返回面口径：恒名 `<fn>Output`（名字不随符号来源翻转——Bug 614）；没有形参表面时，全部条目按整参处理（退化口径不变）", async () => {
  {
    const { source } = absToStandardSchemaFunction({
      fn: "act",
      inputs: [
        { name: "a", abs: num() },
        { name: "b", abs: num() },
      ],
      formals: patternFormals,
      returns: num(),
    });
    // 导出名口径与 zod 面对齐
    expect(source).toContain("export const actInput");
    // 字段级条目**不**提升为顶层整参校验器
    expect(source).not.toContain("export const act_a");
    expect(source).not.toContain("export const act_b");

    const mod = await loadGeneratedModule(source);
    const validate = mod.actInput!["~standard"].validate;
    // 正确入参（整个对象）被接受
    expect(validate({ a: 1, b: 2 }).issues).toBeUndefined();
    // 错误入参（裸数字 = 字段值冒充整参）被拒绝
    expect(validate(1).issues).toBeDefined();
    // 缺字段被拒绝
    expect(validate({ a: 1 }).issues).toBeDefined();
  }
  {
    const { source } = absToStandardSchemaFunction({
      fn: "act",
      inputs: [
        { name: "a", abs: num() },
        { name: "b", abs: num() },
      ],
      formals: namedFormals,
      returns: num(),
    });
    expect(source).toContain("export const act_a");
    expect(source).toContain("export const act_b");
    expect(source).toContain("export const actInput");

    const mod = await loadGeneratedModule(source);
    // 整参校验器校验的是**这个形参的值**（不是整个入参对象）
    expect(mod.act_a!["~standard"].validate(1).issues).toBeUndefined();
    expect(mod.act_a!["~standard"].validate({ a: 1 }).issues).toBeDefined();
    // `<fn>Input` 校验整个入参对象
    expect(mod.actInput!["~standard"].validate({ a: 1, b: 2 }).issues).toBeUndefined();
  }
  {
    const withReturn = absToStandardSchemaFunction({
      fn: "act",
      inputs: [{ name: "a", abs: num() }],
      returns: num(),
    });
    expect(withReturn.source).toContain("export const actOutput");
    expect(withReturn.source).not.toContain("export const actReturn");

    const withOutput = absToStandardSchemaFunction({
      fn: "act",
      inputs: [{ name: "a", abs: num() }],
      output: num(),
    });
    expect(withOutput.source).toContain("export const actOutput");
    expect(withOutput.source).not.toContain("export const actReturn");
  }
  {
    const { source } = absToStandardSchemaFunction({
      fn: "act",
      inputs: [{ name: "a", abs: num() }],
    });
    expect(source).toContain("export const act_a");
    expect(source).toContain("export const actInput");
  }
});




});

// ---------------------------------------------------------------------------
// : standard 节点的字面量序列化必须保真
// ---------------------------------------------------------------------------
describe(": standard 节点的字面量序列化必须保真", () => {
/**
 * / standard 方言用 `JSON.stringify` 序列化 schema 节点。
 *
 * 修前：`JSON.stringify(node)` 把 Abs 的 `lit` 节点整个 JSON 化 ⇒
 * - `Infinity` / `-Infinity` **静默变 `null`**（JSON 没有非有限数表示）⇒
 * 生成的校验器**拒绝函数必返的值**（假红）、**放行函数永不返回的 `null`**
 * （假绿）——导出的 schema 与被导出的函数**完全反向**（）；
 * 报错文案还自相矛盾（「expected null, got null」）。
 * - bigint **直接抛** `TypeError: Do not know how to serialize a BigInt` ⇒
 * `nudo export --format standard` **整条崩溃、零产物**，`--format all` 下
 * **四个方言的产物一起丢**（）。
 *
 * 修后（产物生成侧，本分片）：节点走**保真序列化**（逐节点写源码文本，绝不
 * 经过 JSON 往返）——`Infinity` / `-Infinity` / `NaN` / `10n` 各有对应源码。
 *
 * 负控制：普通字面量的产物文本与判定不变（`42` 仍写 `"value":42`；NaN 仍按
 * zod 面同口径降级成 `prim number`）。
 */






/** 非有限数字面量的 Abs（term = lit(Infinity)）。 */
const litAbs = (value: number): Abs =>
  abs({ k: "unknown" }, { op: "lit", value }, undefined, "exact");

/** bigint 字面量约束 → entry Abs（走契约投影通道，产出 lit 节点）。 */
const bigintEntryAbs = (): Abs => {
  const c: NudoConstraint = {
    __nudoConstraint: true,
    preds: [{ op: "eq", a: v("n"), b: lit(10n) }],
  };
  return constraintToEntryAbs(c, "n");
};

describe("standard 节点的字面量序列化必须保真", () => {
  it("Infinity 不再被写成 null（产物文本层）；Infinity：产物放行真值、拒绝 null（语义层，Bug 1000 的假红/假绿）；-Infinity 同样保真；bigint 字面量：序列化不抛（修前整条 export 崩溃、零产物）；负控制：普通字面量的产物文本与判定不变；负控制：NaN 不落成 lit(null)，而是按 zod 面同口径降级并记账", async () => {
  {
    const { node } = absToSchemaNode(litAbs(Infinity));
    expect(node).toEqual({ k: "lit", value: Infinity });
    const { source } = absToStandardSchema(litAbs(Infinity), { name: "infOutput" });
    expect(source).toContain('"value":Infinity');
    expect(source).not.toContain('"value":null');
  }
  {
    const { source } = absToStandardSchema(litAbs(Infinity), { name: "infOutput" });
    const mod = await loadGeneratedModule(source);
    const validate = mod.infOutput!["~standard"].validate;
    expect(validate(Infinity).issues).toBeUndefined();
    const nul = validate(null);
    expect(nul.issues).toBeDefined();
    // 报错文案不得自相矛盾（「expected null, got null」）
    expect(nul.issues?.[0]?.message).toContain("expected Infinity");
    expect(nul.issues?.[0]?.message).not.toContain("expected null");
  }
  {
    const { source } = absToStandardSchema(litAbs(-Infinity), { name: "negInfOutput" });
    expect(source).toContain('"value":-Infinity');
    const mod = await loadGeneratedModule(source);
    const validate = mod.negInfOutput!["~standard"].validate;
    expect(validate(-Infinity).issues).toBeUndefined();
    expect(validate(Infinity).issues).toBeDefined();
  }
  {
    const entry = bigintEntryAbs();
    const { node } = absToSchemaNode(entry);
    expect(node).toEqual({ k: "lit", value: 10n });
    // 修前：`JSON.stringify(node)` 在这里抛 TypeError ⇒ 零产物
    let mod: ReturnType<typeof absToStandardSchemaModule>;
    expect(() => {
      mod = absToStandardSchemaModule({ bigOut: entry });
    }).not.toThrow();
    expect(mod!.source).toContain('"value":10n');
    const loaded = await loadGeneratedModule(mod!.source);
    const validate = loaded.bigOut!["~standard"].validate;
    expect(validate(10n).issues).toBeUndefined();
    const bad = validate(10);
    expect(bad.issues).toBeDefined();
    expect(bad.issues?.[0]?.message).toContain("expected 10n");
  }
  {
    const { source } = absToStandardSchema(numLit(42), { name: "okOutput" });
    expect(source).toContain('"value":42');
    const mod = await loadGeneratedModule(source);
    const validate = mod.okOutput!["~standard"].validate;
    expect(validate(42).issues).toBeUndefined();
    expect(validate(43).issues).toBeDefined();
  }
  {
    // BUG-137：NaN 是**精确字面量**，必须保真投影（不得放宽成 number 域）
    const { node } = absToSchemaNode(litAbs(NaN));
    expect(node).toEqual({ k: "lit", value: NaN });
    const { source } = absToStandardSchema(litAbs(NaN), { name: "nanOutput" });
    expect(source).toContain('"value":NaN');
    const mod = await loadGeneratedModule(source);
    const validate = mod.nanOutput!["~standard"].validate;
    expect(validate(NaN).issues).toBeUndefined();
    expect(validate(1).issues).toBeDefined();
    expect(validate(Infinity).issues).toBeDefined();
  }
});





});
});

// ---------------------------------------------------------------------------
// : standard 产物必须能过 tsc --noEmit --strict
// ---------------------------------------------------------------------------
describe(": standard 产物必须能过 tsc --noEmit --strict", () => {
/**
 * / **standard 产物面过不了 `tsc --noEmit --strict`**。
 *
 * 修前：产物是 `.ts` 模块，helper 却是裸 JS（`function __nudoCheck(node, value,
 * path, issues)`、`const local = []`、`validate(value)`）⇒ strict 工程里
 * TS7006 / TS7005 / TS7034 一片红（519 记 24 条、989 记 16 条）⇒ 产物在
 * strict 工程里**不可用**；而同一次导出的 zod 面 exit 0 ⇒ 跨产物面不一致。
 *
 * 修后（产物生成侧，本分片）：helper / 局部量带类型标注 + 产物自带
 * `NudoSchemaNode` / `NudoIssue` 等类型别名 ⇒ 一次生成即消除全部错误。
 *
 * 本用例用**真 TypeScript 编译器**（不是比字符串）检查产物：`strict: true`
 * 下 0 诊断。
 *
 * 负控制：修前形态（裸 JS helper）在本检查器下**必须**报 TS7006 —— 证明这条
 * 门禁不是恒绿。
 */








/** 真 tsc：把源码当 .ts 模块过一遍 strict 编译，返回诊断（只算本文件）。 */
function strictDiagnostics(source: string): Array<{ code: number; message: string }> {
  const dir = mkdtempSync(join(tmpdir(), "nudo-strict-check-"));
  const file = join(dir, "product.ts");
  writeFileSync(file, source, "utf-8");
  const program = ts.createProgram([file], {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true,
    types: [],
  });
  return ts
    .getPreEmitDiagnostics(program)
    .filter((d) => d.file?.fileName === file)
    .map((d) => ({
      code: d.code,
      message: ts.flattenDiagnosticMessageText(d.messageText, " "),
    }));
}

/** 覆盖产物里出现的各节点形态：prim / obj 槽 / union / lit / tuple / arr / refinement。 */
const richAbs = (): Abs =>
  abs(
    {
      k: "obj",
      slots: {
        n: { value: num() },
        s: { value: str() },
        lit: { value: numLit(42) },
        list: { value: abs({ k: "arr", element: num() }, undefined, undefined, "exact") },
        tup: {
          value: abs(
            { k: "tuple", elements: [numLit(1), num()] },
            undefined,
            undefined,
            "exact",
          ),
        },
        pick: {
          value: abs(
            { k: "sum", members: [num(), str()] },
            undefined,
            undefined,
            "exact",
          ),
        },
      },
    },
    undefined,
    undefined,
    "exact",
  );

describe("standard 产物必须能过 tsc --noEmit --strict", () => {
  it("生成的 standard 产物在 strict 下 0 诊断；负控制：修前形态（裸 JS helper）在同一检查器下报 TS7006；产物自带类型别名（消费方拿到 unknown 而非 any 的入参面）", () => {
  {
    const { source } = absToStandardSchemaModule({ rich: richAbs() });
    const diags = strictDiagnostics(source);
    expect(diags.map((d) => `${d.code}: ${d.message}`)).toEqual([]);
  }
  {
    // 修前的 helper 签名（无类型标注）——必须被本门禁抓住，否则门禁恒绿。
    const legacy = `function __nudoCheck(node, value, path, issues) {
  function push(msg) {
    issues.push(path.length > 0 ? { message: msg, path: path.slice() } : { message: msg });
  }
  switch (node.k) {
    case "lit": {
      const local = [];
      return local;
    }
    default:
      return;
  }
}
export const rich = {
  "~standard": {
    version: 1,
    vendor: "nudo",
    validate(value) {
      const issues = [];
      __nudoCheck({ k: "lit", value: 42 }, value, [], issues);
      return issues.length ? { issues } : { value };
    },
  },
} as const;
`;
    const codes = strictDiagnostics(legacy).map((d) => d.code);
    expect(codes).toContain(7006); // 隐式 any 形参
    expect(codes).toContain(7005); // 隐式 any[]
  }
  {
    const { source } = absToStandardSchemaModule({ rich: richAbs() });
    expect(source).toContain("type NudoSchemaNode =");
    expect(source).toContain("type NudoIssue =");
    expect(source).toContain("function __nudoCheck(node: NudoSchemaNode, value: unknown");
    expect(source).toContain("validate(value: unknown)");
    // 不得残留隐式 any 的局部量
    expect(source).not.toMatch(/const local = \[\]/);
    expect(source).not.toMatch(/const issues = \[\]/);
  }
});


});
});

// ---------------------------------------------------------------------------
// zod number + numBound 必须覆盖 ±Infinity 的合法端
// ---------------------------------------------------------------------------
describe("zod number + numBound 必须覆盖 ±Infinity 的合法端", () => {
/**
 * zod 面在 number **带数值 refinement** 时不放宽 ±Infinity ⇒
 * 导出的 schema **拒绝被导出函数自己的返回值**。
 *
 * 改前：`number().gt(0)` ⇒ `z.number().gt(0)`，而 zod v4 的 `z.number()` 只收
 * 有限数 ⇒ `Infinity`（`Infinity > 0` 成立）被拒；同一份源码的 standard / guard /
 * dts 三面都接受 ⇒ 跨面矛盾 + 消费方假红。
 *
 * 修法：按 refinement **逐条**判定（`int` 真的排除非有限值 ⇒ 不放宽；
 * `gt/ge/lt/le` 按数学比较 ⇒ 只放宽真正满足界限的那一端）。NaN 一律不放宽
 * （任何 numBound 对 NaN 都为假，与 standard / guard 同判据）。
 */




const numWith = (pred: Pred): Abs =>
  abs({ k: "prim", type: "number" }, { op: "var", id: "x" }, pred, "exact");


  it("gt(0)：放宽 +Infinity，不放宽 -Infinity（-Infinity > 0 为假）；ge(5)：同上（+Infinity 满足 ge）；lt(5)：放宽 -Infinity，不放宽 +Infinity（+Infinity < 5 为假）；le(5)：同上；int 真的排除非有限值 ⇒ 不放宽（`Number.isInteger(±Infinity)` 为假）；多界合取：两端都满足才放宽对应端（gt(0) ∧ lt(10) ⇒ 两端都不满足）；多界合取：同为下", () => {
  {
    const source = absToSchemaSource(numWith(gt(v("x"), lit(0))));
    expect(source).toContain("z.number().gt(0)");
    expect(source).toContain(".or(z.literal(Infinity))");
    expect(source).not.toContain("z.literal(-Infinity)");
  }
  {
    const source = absToSchemaSource(numWith(ge(v("x"), lit(5))));
    expect(source).toContain("z.number().gte(5)");
    expect(source).toContain(".or(z.literal(Infinity))");
    expect(source).not.toContain("z.literal(-Infinity)");
  }
  {
    const source = absToSchemaSource(numWith(lt(v("x"), lit(5))));
    expect(source).toContain("z.number().lt(5)");
    expect(source).toContain(".or(z.literal(-Infinity))");
    expect(source).not.toContain("z.literal(Infinity)");
  }
  {
    const source = absToSchemaSource(numWith(le(v("x"), lit(5))));
    expect(source).toContain("z.number().lte(5)");
    expect(source).toContain(".or(z.literal(-Infinity))");
    expect(source).not.toContain("z.literal(Infinity)");
  }
  {
    // eq((x % 1), 0) 是引擎唯一认得的整性形态
    const intPred: Pred = {
      op: "eq",
      a: { op: "app", fn: "%", args: [{ op: "var", id: "x" }, { op: "lit", value: 1 }] },
      b: { op: "lit", value: 0 },
    };
    const source = absToSchemaSource(numWith(intPred));
    expect(source).toBe("z.number().int()");
  }
  {
    const both = {
      op: "and",
      args: [gt(v("x"), lit(0)), lt(v("x"), lit(10))],
    } as Pred;
    const source = absToSchemaSource(numWith(both));
    // +Infinity < 10 为假、-Infinity > 0 为假 ⇒ 不放宽任何一端（不得假绿）
    expect(source).toBe("z.number().gt(0).lt(10)");
  }
  {
    const lowerBoth = {
      op: "and",
      args: [gt(v("x"), lit(0)), ge(v("x"), lit(2))],
    } as Pred;
    const source = absToSchemaSource(numWith(lowerBoth));
    expect(source).toContain(".or(z.literal(Infinity))");
    expect(source).not.toContain("z.literal(-Infinity)");
  }
  {
    const source = absToSchemaSource(num());
    expect(source).toBe(
      "z.number().or(z.nan()).or(z.literal(Infinity)).or(z.literal(-Infinity))",
    );
  }
  {
    const lit42 = abs(
      { k: "prim", type: "number" },
      { op: "lit", value: 42 },
      undefined,
      "exact",
    );
    expect(schemaNodeToZod({ k: "prim", type: "number", refinements: [] })).toContain("z.nan()");
    expect(absToSchemaSource(lit42)).toBe("z.literal(42)");
  }
});









});

// ---------------------------------------------------------------------------
// 内建类型 brand（纯类型）不得进 z.instanceof
// ---------------------------------------------------------------------------
describe("内建类型 brand（纯类型）不得进 z.instanceof", () => {
/**
 * `nudo export --format schema` 把**内建类型 brand** 渲染成
 * `z.instanceof(Record<string, string>)` ⇒ 产物是 **TS2693 编译不过**的模块
 * （`process.env` 即触发）。
 *
 * 根因（族 02 的 已在本文件被 pin 之前修掉，这里是**回归钉**）：
 * brand 分支曾无条件把 brand **名字**当作用域内的**运行时值**插进产物
 * （`z.instanceof(Record<string, string | undefined>)`）——`Record<…>` /
 * `Map<…>` 这类**纯类型**根本没有运行时类 ⇒ 产物用「类型当值」⇒ TS2693。
 *
 * 现在：brand 名只有落在「运行时全局构造器」表里才允许进 `z.instanceof(...)`；
 * 纯类型 brand（内建泛型别名 / 开放字典）降级 `z.unknown()` + dropped 注释
 * ⇒ 产物**必可编译**（无 TS2693）且**必可 import**。
 *
 * 负控制：真有运行时类的内建（Date / Map / RegExp）**不得**过度降级。
 */




/** brand 形态 Abs（内层形状 + 名字） */
const brandOf = (name: string): Abs =>
  abs({ k: "brand", name, shape: abs({ k: "obj", slots: {} }, undefined, undefined, "exact") }, undefined, undefined, "exact");


  it("Record<string, string | undefined>（process.env 的 brand）不进产物；Record<string, string>（process.versions 的 brand）不进产物；降级进 dropped 台账（brand 不可表达必须可观测）；负控制：有运行时类的内建仍走 z.instanceof", () => {
  {
    const source = absToSchemaSource(brandOf("Record<string, string | undefined>"));
    // 「类型当值」⇒ TS2693：`Record` only refers to a type
    expect(source).not.toContain("z.instanceof(Record");
    expect(source).not.toContain("<");
    expect(source).toBe("z.unknown()");
  }
  {
    const source = absToSchemaSource(brandOf("Record<string, string>"));
    expect(source).not.toContain("z.instanceof(Record");
    expect(source).toBe("z.unknown()");
  }
  {
    const mod = absToZodSchemaModule({ getEnvOutput: brandOf("Record<string, string | undefined>") });
    expect(mod.dropped.some((d) => d.includes("brand not projected"))).toBe(true);
    expect(mod.source).toContain("// dropped preds (not projected into zod):");
    expect(mod.source).not.toContain("z.instanceof(Record");
  }
  {
    expect(absToSchemaSource(brandOf("Date"))).toBe("z.instanceof(Date)");
    expect(absToSchemaSource(brandOf("Map"))).toBe("z.instanceof(Map)");
  }
});




});

// ---------------------------------------------------------------------------
// 用户自定义类的 brand 不得原样进 z.instanceof
// ---------------------------------------------------------------------------
describe("用户自定义类的 brand 不得原样进 z.instanceof", () => {
/**
 * 用户自定义类的 brand 被渲染成 `z.instanceof(<类名>)`：
 * 生成的模块根本无法 import（ReferenceError / TS2304）。
 *
 * 根因（族 02 的 已在本文件被 pin 之前修掉，这里是**回归钉**）：
 * `schema-generator.ts` 的 brand 分支曾把 brand **名字**当作用域内的标识符
 * 插进产物（`z.instanceof(Counter)`），而生成模块**只** import zod ⇒
 * 用户类名在模块作用域内不存在 ⇒ 模块求值期即抛 ReferenceError（TS2304）。
 *
 * 现在：brand 名只有落在「运行时全局构造器」表里才允许进 `z.instanceof(...)`；
 * 其余（用户类名 / `X.prototype` / `GeneratorFunction` / 内建泛型别名）降级
 * `z.unknown()`（放行不拒收）并把损失记进 dropped 台账 ⇒ 产物**必可 import**。
 *
 * 负控制：内建全局构造器（Date / Map / RegExp）**不得**过度降级。
 */




/** brand 形态 Abs（内层形状 + 名字） */
const brandOf = (name: string): Abs =>
  abs({ k: "brand", name, shape: abs({ k: "obj", slots: {} }, undefined, undefined, "exact") }, undefined, undefined, "exact");


  it("用户类名不进产物（模块可 import，无 TS2304）；降级必须进 dropped 台账（损失可观测，不是静默）；负控制：运行时全局构造器仍走 z.instanceof（不得过度降级）；负控制：非 brand 形态不受影响", () => {
  {
    const source = absToSchemaSource(brandOf("Counter"));
    expect(source).not.toContain("z.instanceof(Counter)");
    expect(source).not.toContain("Counter");
    // 降级为放行形态（不是 never ⇒ 不拒收合法值）
    expect(source).toBe("z.unknown()");
  }
  {
    const mod = absToZodSchemaModule({ makeCounterOutput: brandOf("Counter") });
    expect(mod.dropped.some((d) => d.includes("Counter"))).toBe(true);
    expect(mod.source).toContain("brand not projected");
    expect(mod.source).not.toContain("z.instanceof(Counter)");
  }
  {
    expect(absToSchemaSource(brandOf("Date"))).toBe("z.instanceof(Date)");
    expect(absToSchemaSource(brandOf("Map"))).toBe("z.instanceof(Map)");
    expect(absToSchemaSource(brandOf("RegExp"))).toBe("z.instanceof(RegExp)");
  }
  {
    expect(absToSchemaSource(num())).toContain("z.number()");
  }
});




});

// ---------------------------------------------------------------------------
// 内建泛型 brand 补类型实参
// ---------------------------------------------------------------------------
describe("内建泛型 brand 补类型实参", () => {
/**
 * `.d.ts` 把**内建泛型 brand**（`Map` / `Set` / `WeakMap`）渲染成
 * **裸名**（缺类型实参）⇒ TS2314 ⇒ 产出的 `.d.ts` 编译不过。
 *
 * 改前：
 * export declare function mkMap(): Map; ← TS2314
 * export declare function mkSet(): Set; ← TS2314
 * export declare function mkWeak(): WeakMap; ← TS2314
 *
 * 修法：brand 渲染补一张「内建泛型 → TS 类型串」表（实例形状不带 K/V 证据
 * ⇒ 实参落到最宽的合法值；`WeakMap` / `WeakSet` 的键位受 `WeakKey` 约束 ⇒
 * `object` 而非 `unknown`）。用户类 brand 走 `declare class` 路径（）。
 */





const brandOf = (name: string): Abs =>
  abs({ k: "brand", name, shape: objOf({}) }, undefined, undefined, "path");


  it("Map / Set / WeakMap / WeakSet 渲染成带实参的泛型；负控制：非泛型 brand（RegExp / Date）与用户类 brand 原样保留；负控制：非法 brand 名仍落 unknown（不泄漏任意标识符）；产物真的能过 tsc --noEmit --strict（改前 TS2314）；改前形态确实红（裸 Map / Set / WeakMap ⇒ TS2314）", () => {
  {
    expect(absToTSType(brandOf("Map"))).toBe("Map<unknown, unknown>");
    expect(absToTSType(brandOf("Set"))).toBe("Set<unknown>");
    expect(absToTSType(brandOf("WeakMap"))).toBe("WeakMap<object, unknown>");
    expect(absToTSType(brandOf("WeakSet"))).toBe("WeakSet<object>");
  }
  {
    expect(absToTSType(brandOf("RegExp"))).toBe("RegExp");
    expect(absToTSType(brandOf("Date"))).toBe("Date");
    expect(absToTSType(brandOf("User"))).toBe("User");
  }
  {
    expect(absToTSType(brandOf("not-a-name"))).toBe("unknown");
  }
  {
    const dts = `
export declare function mkMap(): Map<unknown, unknown>;
export declare function mkSet(): Set<unknown>;
export declare function mkWeak(): WeakMap<object, unknown>;
export declare function mkWeakSet(): WeakSet<object>;
export declare function mkRe(): RegExp;
`;
    const check = tscNoEmit({ "lib.d.ts": dts });
    expect(check.ok, check.stderr).toBe(true);
  }
  {
    const before = `
export declare function mkMap(): Map;
export declare function mkSet(): Set;
export declare function mkWeak(): WeakMap;
`;
    const check = tscNoEmit({ "before.d.ts": before });
    expect(check.ok).toBe(false);
    expect(check.stderr).toContain("TS2314");
  }
});





});

// ---------------------------------------------------------------------------
// standard 面 brand 必须有运行时判据
// ---------------------------------------------------------------------------
describe("standard 面 brand 必须有运行时判据", () => {
/**
 * standard 面的 brand 节点是**恒真**校验器（假绿）。
 *
 * 修前：`case "brand": return;` ⇒ `mkDateOutput({})` / `([])` / `("x")` 全部
 * 放行，而**同一次导出**的 zod 面 `z.instanceof(Date)` 全部拒绝 ⇒ 跨方言相反
 * 裁决。
 *
 * 修后：brand 名落在**全局构造器名单**（与 zod 面 `RUNTIME_GLOBAL_CTOR_NAMES`
 * 同名单）时施加 `value instanceof Ctor` 判据；名单外的 brand（用户类等）没有
 * 运行时判据 ⇒ 仍放行（`schema-generator` 已把它们降级为 `unknown` 并记
 * `dropped`）。
 *
 * 负控制：不可判定的 brand 不得被误拒（无判据 ⇒ 放行）。
 */






const brandOf = (name: string): Abs =>
  abs({ k: "brand", name, shape: num() }, undefined, undefined, "exact");


  it("库函数版：全局构造器 brand 只放行真实例；生成产物版：与 zod 面 z.instanceof(Date) 同判；负控制：名单外的 brand（用户类）无运行时判据 ⇒ 放行", async () => {
  {
    const { node } = absToSchemaNode(brandOf("Date"));
    expect(validateSchemaNode(node, new Date()).issues).toBeUndefined();
    for (const bad of [{}, [], "x", 0, null]) {
      const r = validateSchemaNode(node, bad);
      expect(r.issues?.[0]?.message).toContain("expected Date");
    }
  }
  {
    const { source } = absToStandardSchema(brandOf("Date"), { name: "mkDateOutput" });
    const mod = await loadGeneratedModule(source);
    expect(mod.mkDateOutput!["~standard"].validate(new Date()).issues).toBeUndefined();
    for (const bad of [{}, [], "x", 0]) {
      const r = mod.mkDateOutput!["~standard"].validate(bad);
      expect(r.issues?.[0]?.message).toContain("expected Date");
    }
  }
  {
    const { node, dropped } = absToSchemaNode(brandOf("User"));
    // 投影层已把它降级为 unknown 并记 dropped（可见性由 dropped 台账承担）
    expect(node.k).toBe("unknown");
    expect(dropped.join(" ")).toContain("User");
    expect(validateSchemaNode(node, { anything: 1 }).issues).toBeUndefined();
  }
});



});

// ---------------------------------------------------------------------------
// 值级 template 不是手写函数契约
// ---------------------------------------------------------------------------
describe("值级 template 不是手写函数契约", () => {
/**
 * LSP codeLens 的契约档位与**它自己那条命令**的结果互相矛盾：
 * `● contract / imp` + `⚡ persist contract`，点下去却是
 * 「handwritten wins — skipping」（**值级 template** 被当成手写**函数**绑定）。
 *
 * 根因：两条通道对「侧车里这个名字算不算手写**函数**绑定」用了两套口径——
 * 档位面（core 的 effectiveContract）只认 **fn(...) 形态**的导出为契约；
 * 发射器面把侧车顶层**一切**声明名都收进冲突集 ⇒ 值级 template（number() 等）
 * 被报成「已有手写绑定」。
 *
 * 本文件的钉：
 * - 值级 template 占着导出名 → **不是** name-clash（文案与判定都要真）；
 * 生成段就地替换它（同名不能并存：重复 export = 非法 ESM）⇒ 侧车可用、
 * 契约生效、且第二次 emit 报「无改动」。
 * - 负控制：真 `fn(...)` 绑定仍报 name-clash（手写优先，既有钉不许回归）。
 */







let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-emit-532-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

// `@nudo:case` 的**纯点观测见证**（实参全是字面量、无断言）不是契约
// 产物 ⇒ 夹具的 case 改为**带断言的域声明**（`=> 期望值`），生成段内容
// （`export const classify = fn(…)`）与 name-clash 语义不变。
const SRC = `/**
 * @nudo:case "c" (1) => true
 */
export function classify(x) { return x > 0; }
`;

const loadModule = (spec: string, from: string): string | undefined => {
  if (!spec.startsWith(".")) return undefined;
  const parts = from.split("/").slice(0, -1);
  for (const seg of spec.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  try {
    return readFileSync(parts.join("/"), "utf-8");
  } catch {
    return undefined;
  }
};


  it("does not report name-clash for a value-level template and persists the contract；the persisted contract is effective (effectiveContract reads it back)；is idempotent: the second emit reports no change；negative control: a real fn(...) binding ", async () => {
  {
  dir = mkdtempSync(join(tmpdir(), "nudo-emit-532-"));


    const file = join(dir, "lib.js");
    writeFileSync(file, SRC);
    const sidecar = join(dir, "lib.nudo.js");
    writeFileSync(sidecar, `import { number } from "@nudojs/core";\n\nexport const classify = number();\n`);

    const r = await emitContract(file, { fnNames: ["classify"], mode: "update" });
    // 值级 template 不是契约 → 不报 name-clash
    expect(r.skipped).toEqual([]);
    expect(r.issues.filter((i) => i.code === "nudo:contract-name-clash")).toEqual([]);
    expect(r.written).toEqual(["classify"]);

    const after = readFileSync(sidecar, "utf-8");
    // 生成段取代了值级绑定（同名不能并存：重复 export = 非法 ESM）
    expect(after).toContain("export const classify = fn(");
    expect(after).not.toContain("export const classify = number()");
    // 侧车必须仍可装载（否则该文件所有契约一起丢）
    expect(() => execNudoModule(after)).not.toThrow();
    const exports = execNudoModule(after);
    expect(Object.keys(exports)).toContain("classify");
  }
  {
  dir = mkdtempSync(join(tmpdir(), "nudo-emit-532-"));


    const file = join(dir, "lib.js");
    writeFileSync(file, SRC);
    const sidecar = join(dir, "lib.nudo.js");
    writeFileSync(sidecar, `import { number } from "@nudojs/core";\n\nexport const classify = number();\n`);
    await emitContract(file, { fnNames: ["classify"], mode: "update" });
    const eff = effectiveContract(SRC, "classify", { loadModule, fromFile: file });
    expect(eff).toBeDefined();
    // 档位与命令结果一致：不再是「implicit + 手写优先」的矛盾组合
    expect(eff!.source).toBe("generated");
    expect(eff!.params.map((p) => p.param)).toEqual(["x"]);
  }
  {
  dir = mkdtempSync(join(tmpdir(), "nudo-emit-532-"));


    const file = join(dir, "lib.js");
    writeFileSync(file, SRC);
    const sidecar = join(dir, "lib.nudo.js");
    writeFileSync(sidecar, `import { number } from "@nudojs/core";\n\nexport const classify = number();\n`);
    await emitContract(file, { fnNames: ["classify"], mode: "update" });
    const after = readFileSync(sidecar, "utf-8");
    const second = await emitContract(file, { fnNames: ["classify"], mode: "update" });
    expect(second.changed).toBe(false);
    expect(readFileSync(sidecar, "utf-8")).toBe(after);
  }
  {
  dir = mkdtempSync(join(tmpdir(), "nudo-emit-532-"));


    const file = join(dir, "lib.js");
    writeFileSync(file, SRC);
    const sidecar = join(dir, "lib.nudo.js");
    writeFileSync(sidecar, `import { fn, number } from "@nudojs/core";\n\nexport const classify = fn({ x: number() });\n`);
    const r = await emitContract(file, { fnNames: ["classify"], mode: "update" });
    expect(r.skipped).toEqual([{ fn: "classify", reason: "name-clash" }]);
    expect(r.issues.some((i) => i.code === "nudo:contract-name-clash" && i.severity === "error")).toBe(
      true,
    );
    expect(r.changed).toBe(false);
    // 手写契约原样保留
    expect(readFileSync(sidecar, "utf-8")).toContain("export const classify = fn({ x: number() });");
  }
  {
  dir = mkdtempSync(join(tmpdir(), "nudo-emit-532-"));


    const file = join(dir, "lib.js");
    writeFileSync(file, SRC);
    const sidecar = join(dir, "lib.nudo.js");
    writeFileSync(sidecar, `import { number } from "@nudojs/core";\n\nexport const classify = number();\n`);
    const r = await emitContract(file, { fnNames: ["classify"], mode: "add" });
    expect(r.written).toEqual(["classify"]);
    const after = readFileSync(sidecar, "utf-8");
    expect(after).toContain("export const classify = fn(");
    expect(after).not.toContain("export const classify = number()");
    expect(() => execNudoModule(after)).not.toThrow();
  }
});





});

// ---------------------------------------------------------------------------
// nullish quickfix 不得吞掉 fn() 的第三实参
// ---------------------------------------------------------------------------
describe("nullish quickfix 不得吞掉 fn() 的第三实参", () => {
/**
 * `nudo check --fix` 的 **nullish quickfix** 吞掉侧车 `fn()` 的**第三
 * 实参 `{ throws }`** ⇒ 自动落盘后**删除用户的 throws 义务** ⇒ 门禁从
 * `constraint-violated` 变成**新的** `entry-may-throw` ⇒ 没修好还制造新错误。
 *
 * 根因：wrapReturnNullable 取「首个顶层逗号」与「`fn(...)` 收尾括号」之间的
 * **全部**文本当 return 位 ⇒ 第三个实参被一起卷进 `nullable(...)`。
 *
 * 本钉：
 * ① 第三实参原样保留（只卷 return 位）
 * ② 改写后门禁真的转绿（引擎复核：无 constraint-violated、无 entry-may-throw）
 * ③ 证不出时降级 [review]（不自动落盘）
 */




const SRC = `export function sim(v) {
  if (v === 0) {
    throw new Error("boom");
  }
  return null;
}
`;

const SIDECAR = `import { fn, number } from "@nudojs/core";
export const sim = fn({ v: number() }, number(), { throws: "Error" });
`;

/** 用引擎复核某份侧车文本下的门禁状态 */
function gate(sidecarText: string): string[] {
  const r = checkSource("/t/sim.js", SRC, pTrue, {
    loadModule: (spec: string) => (spec.includes("nudo") ? sidecarText : undefined),
    fromFile: "/t/sim.js",
  });
  return r.issues.map((i) => `${i.code} fn=${i.fn}`);
}


  it("只卷 return 位：第三实参 { throws } 原样保留；改写后门禁真的转绿（引擎复核：无残留诊断）；改前形态（第三实参被卷进 nullable）会造出新的 entry-may-throw —— 回归有效性自证；quickfix 物化：门禁转绿 ⇒ titleKind=fix（可自动落盘）；证不出时降级 review（不自动落盘）；负控制：只有两个实参时照旧只卷 return 位；负控制：已包过 nullable 的 return 位不重复包（既有行为不变）", () => {
  {
    const next = wrapReturnNullable(SIDECAR, "sim");
    expect(next).toBeDefined();
    expect(next).toContain(
      `export const sim = fn({ v: number() }, nullable(number()), { throws: "Error" });`,
    );
    // 不得把第三实参卷进 nullable(...)
    expect(next).not.toContain("nullable(number(), { throws");
  }
  {
    const next = wrapReturnNullable(SIDECAR, "sim")!;
    expect(gate(next)).toEqual([]);
  }
  {
    const broken = `import { fn, number } from "@nudojs/core";
export const sim = fn({ v: number() }, nullable(number(), { throws: "Error" }));
`;
    expect(gate(broken)).toEqual(["nudo:entry-may-throw fn=sim"]);
    // 改前门禁是 constraint-violated
    expect(gate(SIDECAR)).toEqual(["nudo:constraint-violated fn=sim"]);
  }
  {
    const plan = materializeAction({
      code: "nudo:constraint-violated",
      fn: "sim",
      file: "/t/sim.js",
      source: SRC,
      sidecarPath: "/t/sim.nudo.js",
      sidecarText: SIDECAR,
      action: { kind: "relax", label: "x" },
      expected: "nullish return ⊭ number()",
      suggestion: "use nullable(number()) or union(..., lit(null)) to allow nullish returns",
    });
    expect(plan).toBeDefined();
    expect(plan!.titleKind).toBe("fix");
    expect(plan!.sidecar?.newText).toContain(`{ throws: "Error" }`);
  }
  {
    // 侧车没有 throws 槽：卷 nullable 后 entry-may-throw 仍在 ⇒ 不能算修好
    const noThrows = `import { fn, number } from "@nudojs/core";
export const sim = fn({ v: number() }, number());
`;
    const plan = materializeAction({
      code: "nudo:constraint-violated",
      fn: "sim",
      file: "/t/sim.js",
      source: SRC,
      sidecarPath: "/t/sim.nudo.js",
      sidecarText: noThrows,
      action: { kind: "relax", label: "x" },
      expected: "nullish return ⊭ number()",
      suggestion: "use nullable(number()) or union(..., lit(null)) to allow nullish returns",
    });
    expect(plan).toBeDefined();
    expect(plan!.titleKind).toBe("review");
  }
  {
    const two = `import { fn, number } from "@nudojs/core";
export const sim = fn({ v: number() }, number());
`;
    expect(wrapReturnNullable(two, "sim")).toContain(
      `export const sim = fn({ v: number() }, nullable(number()));`,
    );
  }
  {
    const already = `import { fn, number } from "@nudojs/core";
export const sim = fn({ v: number() }, nullable(number()));
`;
    expect(wrapReturnNullable(already, "sim")).toBeUndefined();
  }
});







});

// ---------------------------------------------------------------------------
// symbol 键槽不得发布成字符串字段
// ---------------------------------------------------------------------------
describe("symbol 键槽不得发布成字符串字段", () => {
/**
 * 三个运行时产物面把 **symbol 键槽**当**字符串自有字段**发布
 * （`"@@sym#1"` / `"@@iterator"`）⇒ 运行时不存在的属性 + zod / guard 产物恒假
 * （dts 面正确：它认 `slot.symbolKey`）。
 *
 * 运行时真值：`o[Symbol("tag")] = 2` ⇒ `Object.keys(o) === ["a"]`、
 * `hasOwn(o, "@@sym#1") === false`。
 *
 * 修法：`internal-slot.ts` 的判据把 `symbolKey === true` 一律判为不可见
 * （不只是 `internal` 的 symbol 槽，用户自定义 symbol 键同样如此）；
 * zod / standard 在节点层摘槽，guard 在 `denoteGuard` 前摘槽。
 */






/** `const o = { a: 1 }; o[Symbol("tag")] = 2;` 的引擎建模 */
const withSymbolProp = (): Abs =>
  abs(
    {
      k: "obj",
      slots: {
        a: { value: numLit(1) },
        "@@sym#1": { value: numLit(2), symbolKey: true },
      },
    },
    undefined,
    undefined,
    "exact",
  );

/** `{ next(), [Symbol.iterator]() {…} }` 的引擎建模（symbol 槽 + internal 协议槽） */
const makeIterLike = (): Abs =>
  abs(
    {
      k: "obj",
      slots: {
        next: {
          value: abs({ k: "fn", params: [] }, undefined, undefined, "exact"),
          internal: true,
        },
        "@@iterator": {
          value: abs({ k: "fn", params: [] }, undefined, undefined, "exact"),
          symbolKey: true,
        },
      },
    },
    undefined,
    undefined,
    "exact",
  );


  it("zod 面不出现 @@sym#1，也不要求该键；standard 面接受运行时真值（own string keys 只有 a）；guard 面接受运行时真值（改前 hasOwn '@@sym#1' 恒假）；迭代器协议槽（symbol + internal）同样不进产物；台账留痕：被摘掉的 symbol 槽进 dropped；负控制：普通字符串槽逐字不变", () => {
  {
    const source = absToSchemaSource(withSymbolProp());
    expect(source).not.toContain("@@sym#1");
    expect(source).toBe("z.object({ a: z.literal(1) })");
  }
  {
    const { node } = absToSchemaNode(withSymbolProp());
    expect(JSON.stringify(node)).not.toContain("@@sym#1");
    const real: Record<PropertyKey, unknown> = { a: 1 };
    real[Symbol("tag")] = 2;
    expect(validateSchemaNode(node, real).issues).toBeUndefined();
  }
  {
    const src = generateGuardFunctionFromAbs("iswithSymbolPropOutput", withSymbolProp());
    expect(src).not.toContain("@@sym#1");
    const js = src
      .replace("(value: unknown): boolean", "(value)")
      .replace("const data = value as Record<string, any>;", "const data = value;")
      .replace("export function ", "function ");
    const guard = new Function(`${js}; return iswithSymbolPropOutput;`)() as (v: unknown) => boolean;
    const real: Record<PropertyKey, unknown> = { a: 1 };
    real[Symbol("tag")] = 2;
    expect(guard(real)).toBe(true);
    // 负控制：缺 a 仍被拒（不是无条件放行）
    expect(guard({ b: 1 })).toBe(false);
  }
  {
    const a = makeIterLike();
    const zodSource = absToSchemaSource(a);
    expect(zodSource).not.toContain("@@iterator");
    const src = generateGuardFunctionFromAbs("ismakeIterOutput", a);
    expect(src).not.toContain("@@iterator");
    const { node } = absToSchemaNode(a);
    expect(JSON.stringify(node)).not.toContain("@@iterator");
  }
  {
    const { dropped } = absToSchemaNode(withSymbolProp());
    expect(dropped.join("\n")).toContain("@@sym#1");
  }
  {
    const a = abs(
      { k: "obj", slots: { a: { value: numLit(1) }, b: { value: strLit("x") } } },
      undefined,
      undefined,
      "exact",
    );
    expect(absToSchemaSource(a)).toBe('z.object({ a: z.literal(1), b: z.literal("x") })');
  }
});






});

// ---------------------------------------------------------------------------
// 数组长度界不得在 zod / standard 面消失
// ---------------------------------------------------------------------------
describe("数组长度界不得在 zod / standard 面消失", () => {
/**
 * zod / standard 面把**数组自身的长度界**（`array(T).min(n)` /
 * `.max(n)`）整段丢掉，且**零 dropped 台账** ⇒ guard 面拒绝的数组，另两个面
 * 全部放行（假绿 + 跨面矛盾）。
 *
 * 根因：`constraintToSchemaNode` 的 `c.element` 分支直接 `return`（数组级
 * `c.preds` 被丢）、`SchemaNode` 的 arr 分支**没有承载长度界的位置**、
 * `constraintDropped` 的 `n.element` 分支只递归元素（零台账）。
 *
 * 修法：arr 节点承载 `minLen` / `maxLen`，zod 渲染 `.min() / .max()`，
 * standard 两个实现（库函数版 + 产物内联版）同步做长度检查，表达不了的
 * 数组级 pred 进 dropped。
 */





/** `length(self) op n`（self 用 `__nudo_self__` 口径，与 absToConstraint 一致） */
const lenOf = (n: number, op: "ge" | "le" | "gt" | "lt"): Pred =>
  ({
    op,
    a: app("length", [{ op: "var", id: "__nudo_self__" }]),
    b: { op: "lit", value: n },
  }) as Pred;

const arrWith = (pred: Pred, element: Abs = num()): Abs =>
  abs({ k: "arr", element }, undefined, pred, "exact");

/** 源契约口径：`array(number()).min(n)`（builder 本身就是 NudoConstraint） */
const arrConstraint = (n: number): NudoConstraint => ({
  __nudoConstraint: true,
  preds: [lenOf(n, "ge")],
  element: number(),
} as NudoConstraint);


  it("min(3)：zod 面渲染 `.min(3)`（不再是裸 z.array）；max(2)：zod 面渲染 `.max(2)`；strict gt/lt 归一：length > 3 ⇒ min 4；length < 3 ⇒ max 2；Abs 投影路径：节点带 minLen，standard 面拒收 [1] 放行 [1,2,3]；约束路径（c.element + 数组级 preds）：arr 节点带 minLen；约束路径 → zod 源码保留长度界；maxLen 同样可表达", () => {
  {
    const source = absToSchemaSource(arrWith(lenOf(3, "ge")));
    expect(source).toContain("z.array(");
    expect(source).toContain(".min(3)");
  }
  {
    expect(absToSchemaSource(arrWith(lenOf(2, "le")))).toContain(".max(2)");
  }
  {
    expect(absToSchemaSource(arrWith(lenOf(3, "gt")))).toContain(".min(4)");
    expect(absToSchemaSource(arrWith(lenOf(3, "lt")))).toContain(".max(2)");
  }
  {
    const { node } = absToSchemaNode(arrWith(lenOf(3, "ge")));
    expect(node).toMatchObject({ k: "arr", minLen: 3 });
    expect(validateSchemaNode(node, [1, 2, 3])).toEqual({ value: [1, 2, 3] });
    expect(validateSchemaNode(node, [1]).issues?.length).toBeGreaterThan(0);
    expect(validateSchemaNode(node, []).issues?.length).toBeGreaterThan(0);
  }
  {
    const node = constraintToSchemaNode(arrConstraint(3));
    expect(node).toEqual({
      k: "arr",
      element: { k: "prim", type: "number", refinements: [] },
      minLen: 3,
    });
  }
  {
    expect(schemaNodeToZod(constraintToSchemaNode(arrConstraint(3)))).toBe(
      "z.array(z.number().or(z.nan()).or(z.literal(Infinity)).or(z.literal(-Infinity))).min(3)",
    );
  }
  {
    const node = constraintToSchemaNode({
      __nudoConstraint: true,
      preds: [lenOf(2, "le")],
      element: number(),
    } as NudoConstraint);
    expect(validateSchemaNode(node, [1, 2])).toEqual({ value: [1, 2] });
    expect(validateSchemaNode(node, [1, 2, 3]).issues?.length).toBeGreaterThan(0);
  }
  {
    const eqPred: Pred = {
      op: "eq",
      a: { op: "var", id: "__nudo_self__" },
      b: { op: "lit", value: 1 },
    } as Pred;
    // 台账在 Abs 投影路径上收集（节点层），不是渲染层
    const { dropped } = absToSchemaNode(abs({ k: "arr", element: num() }, undefined, eqPred, "exact"));
    expect(dropped.join("\n")).toContain(predToString(eqPred));
  }
  {
    const eqPred: Pred = {
      op: "eq",
      a: { op: "var", id: "__nudo_self__" },
      b: { op: "lit", value: 1 },
    } as Pred;
    const c: NudoConstraint = {
      __nudoConstraint: true,
      preds: [eqPred],
      element: number(),
    } as NudoConstraint;
    // constraintDropped 是内部函数；经 absToSchemaNode 的约束路径无法构造该 pred
    // （absToConstraint 先丢 preds）⇒ 这里只断言节点不携带伪造的长度界。
    const node = constraintToSchemaNode(c);
    expect(node).toEqual({
      k: "arr",
      element: { k: "prim", type: "number", refinements: [] },
    });
  }
  {
    const { node } = absToSchemaNode(abs({ k: "arr", element: num() }, undefined, undefined, "exact"));
    expect(node).toEqual({
      k: "arr",
      element: { k: "prim", type: "number", refinements: [] },
    });
    expect(schemaNodeToZod(node)).toBe(
      "z.array(z.number().or(z.nan()).or(z.literal(Infinity)).or(z.literal(-Infinity)))",
    );
  }
  {
    // 直接走 core 契约投影（它只投影元素域）+ emit 补挂的数组级 preds
    const a = arrWith(lenOf(3, "ge"));
    expect(absToConstraint(a)).toBeDefined();
    expect(absToSchemaSource(a)).toContain(".min(3)");
  }
});











});

// ---------------------------------------------------------------------------
// 稀疏元组的洞不被固化成显式 undefined
// ---------------------------------------------------------------------------
describe("稀疏元组的洞不被固化成显式 undefined", () => {
// emit--sparse-tuple-hole.part.ts —
// `nudo test --freeze` 把稀疏元组的**洞**固化成**显式 `undefined` 元素**
// ⇒ 固化后同一调用点的见证从 `false` **翻成 `true`**（与事实相反）。
//
// 复现形态：`hasIdx1([1, , 3])` 的观测值是 `[1, , 3] => false`（洞保留，
// `1 in a` 为 false）；固化把指令写成 `([1, undefined, 3])` ⇒ 再解析时洞
// 变成稠密的显式 undefined 槽 ⇒ 同一调用点的见证翻成 `true`。
//
// 根因：洞位的 `elements[i]` 是 undefAbs()，与「显式 undefined 元素」的 Abs
// **完全同形** ⇒ 序列化不可区分；而 case 实参文法**没有空槽写法**。
//
// 修法：tuple 分支先读 `s.holes`——有洞 ⇒ 整条不可表达（返回 null，与 rest
// 槽同口径）⇒ `buildCaseDirective` 放弃该见证，不静默近似。
//
// 用例含：
// - 改前会失败的形态（带洞的元组不可序列化；带洞的见证不被写进源码）；
// - 负控制（稠密元组照常固化；洞与「显式 undefined 元素」在 Abs 层同形
// ——不可区分性正是根因，故只有洞位走放弃路径）。






function absExact(shape: Parameters<typeof abs>[0]): ReturnType<typeof abs> {
  return abs(shape, undefined, undefined, "exact");
}

/** 稀疏元组：[1, <洞>, 3]（洞位是 undefAbs()，与显式 undefined 元素同形） */
function sparseTuple(): ReturnType<typeof abs> {
  return absExact({ k: "tuple", elements: [absLit(1), absLit(undefined), absLit(3)], holes: [1] });
}

function makeFn(name: string, line: number, args: ReturnType<typeof abs>[]): FunctionAnalysis {
  return {
    name,
    loc: { start: { line, column: 0 }, end: { line, column: 0 } },
    paramNames: [],
    cases: [
      {
        name: "call@L5",
        argAbs: args,
        abs: absExact({ k: "unknown" }),
        throwsAbs: absExact({ k: "never" }),
        source: "callsite",
      },
    ],
  };
}

function makeAnalysis(functions: FunctionAnalysis[]): AnalysisResult {
  return { functions, diagnostics: [], bindings: new Map(), nodeAbsMap: new Map(), caseHints: [] };
}


  it("带洞的元组不可序列化（整条放弃，不静默近似）；formatShape 仍把洞渲染成空槽（观测面不受影响）；带洞的见证不被写进源码（改前会写成 [1, undefined, 3]）；真实分析器：稀疏实参的见证被放弃，源码不被改写；负控制：稠密元组照常固化（洞判据不误伤稠密元组）；负控制：显式 undefined 元素（无洞）仍可表达", () => {
  {
    expect(serializeCaseArg(sparseTuple())).toBeNull();
    expect(buildCaseDirective("call@L5", [sparseTuple()])).toBeNull();
  }
  {
    expect(formatShape(sparseTuple())).toBe("[1, , 3]");
  }
  {
    const source = `export function hasIdx1(a) {
  return 1 in a;
}
const arr = [1, , 3];
hasIdx1(arr);
`;
    const result = insertGeneratedCaseDirectives(
      source,
      makeAnalysis([makeFn("hasIdx1", 1, [sparseTuple()])]),
    );
    expect(result.changed).toBe(false);
    expect(result.written).toEqual([]);
    expect(result.skipped).toEqual([
      { fn: "hasIdx1", reason: "no-serializable-cases", detail: "case call@L5 not serializable" },
    ]);
    expect(result.source).toBe(source);
    expect(result.source.includes("undefined")).toBe(false);
  }
  {
    const source = `export function hasIdx1(a) {
  return 1 in a;
}
const arr = [1, , 3];
hasIdx1(arr);
`;
    const analysis = analyzeFile("/test/bug-561-sparse.js", source);
    const result = insertGeneratedCaseDirectives(source, analysis);
    expect(result.changed).toBe(false);
    expect(result.source).toBe(source);
  }
  {
    const dense = absExact({ k: "tuple", elements: [absLit(1), absLit(3)] });
    expect(serializeCaseArg(dense)).toBe("[1, 3]");
    const source = `export function first(a) {
  return a[0];
}
const arr = [1, 3];
first(arr);
`;
    const result = insertGeneratedCaseDirectives(
      source,
      makeAnalysis([makeFn("first", 1, [dense])]),
    );
    expect(result.changed).toBe(true);
    expect(result.source).toContain('@nudo:case "call@L5" ([1, 3])');
  }
  {
    const denseUndef = absExact({ k: "tuple", elements: [absLit(1), absLit(undefined)] });
    expect(serializeCaseArg(denseUndef)).toBe("[1, undefined]");
  }
});






});

// ---------------------------------------------------------------------------
// 生成器元素域不进运行时产物面
// ---------------------------------------------------------------------------
describe("生成器元素域不进运行时产物面", () => {
/**
 * zod / guard / standard 三个**运行时产物面**把生成器的**元素域下标槽**
 * （`"0"` / `"1"`）当成**对象自有字段**发布 ⇒ 导出的校验器**拒绝被导出函数自己的
 * 返回值**（而 dts 面正确给 `Generator<number>`）。
 *
 * 运行时真值：生成器对象**没有任何自有可枚举属性**（`Object.keys` / `gOPN` /
 * `for-in` 恒空）。仓库里 core 的 `async.ts` 把协议槽与元素槽都建成 `internal`，
 * 但产物面的 `isHiddenInternalSlot` 对「规范数组下标」开了例外（本意是数组承载
 * 元素域）⇒ 元素槽又冒回产物面。
 *
 * 修法（emit 侧）：例外收窄为「仅数组形态（`k:"arr"`）不需要该例外」——
 * 迭代器/生成器形态（协议槽 `next` 在场）的数字下标槽**不可见**；zod / standard
 * 在节点层摘槽，guard 在交给 `denoteGuard` 前摘槽（判据同源 `internal-slot.ts`）。
 *
 * 2026-11-05 补充：生成器身份投影已实施（产品裁决「收紧是 bug，非 breaking」），
 * 判据是随值携带的 `Abs.facets.brand`（见 `emit/generator-identity.ts`）。本夹具
 * **手工构造、无 brand** ⇒ 不触发新分支，下面的 `z.object({ })` 断言仍绿，
 * 现作为「旧 Abs 逐字不变」的负控制；带 brand 的生产回归见
 * `emit-generator-identity-poc.test.ts`。
 */






const fnSlot = (): { value: Abs; internal?: boolean; symbolKey?: boolean } => ({
  value: abs({ k: "fn", params: [] }, undefined, undefined, "exact"),
  internal: true,
});

/** 生成器对象形态（core 的 makeGenObject 口径：协议槽 + 数字下标元素槽） */
const generatorObj = (elements: Abs[], async = false): Abs =>
  abs(
    {
      k: "obj",
      slots: {
        ...Object.fromEntries(elements.map((v, i) => [String(i), { value: v, internal: true }])),
        next: fnSlot(),
        return: fnSlot(),
        throw: fnSlot(),
        constructor: {
          value: abs(
            { k: "brand", name: "GeneratorFunction", shape: objOf({}) },
            undefined,
            undefined,
            "path",
          ),
          internal: true,
        },
        ...(async
          ? {
              "@@asyncIterator": { ...fnSlot(), symbolKey: true },
              "@@toStringTag": { value: numLit(0), internal: true, symbolKey: true },
            }
          : { "@@iterator": { ...fnSlot(), symbolKey: true } }),
      },
    },
    undefined,
    undefined,
    "exact",
  );

/** 真生成器（运行时仲裁用） */
function* gen(): Generator<number> {
  yield 1;
  yield 2;
}


  it("zod 面不发布数字下标字段（运行时不存在的自有属性）；standard 面接受真正的生成器对象（改前：required path ['0'] / ['1']）；guard 面不再要求 hasOwn(data, \"0\")，且真的接受生成器；异步生成器同理（@@asyncIterator 形态）；负控制：普通对象字面量的数字键仍是真实自有属性（不被误剔）", () => {
  {
    const source = absToSchemaSource(generatorObj([numLit(1), numLit(2)]));
    expect(source).not.toContain("0:");
    expect(source).not.toContain("1:");
    expect(source).not.toContain("z.literal(1)");
    expect(source).toBe("z.object({  })");
  }
  {
    const { node } = absToSchemaNode(generatorObj([numLit(1), numLit(2)]));
    expect(JSON.stringify(node)).not.toContain('"key":"0"');
    expect(validateSchemaNode(node, gen())).toMatchObject({});
    expect(validateSchemaNode(node, gen()).issues).toBeUndefined();
  }
  {
    const src = generateGuardFunctionFromAbs("isgenOutput", generatorObj([numLit(1), numLit(2)]));
    expect(src).not.toContain('hasOwn(data, "0")');
    expect(src).not.toContain('data["0"]');
    // 运行时仲裁：把产物守卫的类型标注剥掉（产物是 .ts）后真跑一次
    const js = src
      .replace("(value: unknown): boolean", "(value)")
      .replace("const data = value as Record<string, any>;", "const data = value;")
      .replace("export function ", "function ");
    const guard = new Function(`${js}; return isgenOutput;`)() as (v: unknown) => boolean;
    expect(guard(gen())).toBe(true);
  }
  {
    const a = generatorObj([numLit(1)], true);
    expect(absToSchemaSource(a)).toBe("z.object({  })");
    const src = generateGuardFunctionFromAbs("isagenOutput", a);
    expect(src).not.toContain('hasOwn(data, "0")');
  }
  {
    const a = abs(
      { k: "obj", slots: { "0": { value: numLit(1) }, "1": { value: numLit(2) } } },
      undefined,
      undefined,
      "exact",
    );
    const source = absToSchemaSource(a);
    expect(source).toContain('0: z.literal(1)');
    expect(source).toContain('1: z.literal(2)');
    const { node } = absToSchemaNode(a);
    expect(validateSchemaNode(node, { 0: 1, 1: 2 }).issues).toBeUndefined();
  }
});





});
