/**
 * 模块套件：lsp-check-contract-references（LSP 分片；1 文件 = 1 worker）。
 */
import { describe, it, expect, beforeEach, afterAll, afterEach } from "vitest";
import { withLspServer, withTempDir } from "./helpers.ts";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeFileAsync, clearPathEnvCaches, defaultLoadModule } from "@nudojs/service";
import { checkToLspDiagnostics, clearValidationState, validateText, type LspDiagnostic, type ValidateTextDeps } from "../validation.ts";
import { applyEdits, codeActionParams, mountCodeActions, sidecarEdits, type CodeActionEntry, missingFieldDiag } from "./lsp-harness-code-actions.ts";
import { buildTestReport } from "../../../nudojs/src/run-test.ts";
import { computeObservationLenses } from "../agent-tools.ts";
import { parse } from "@nudojs/parser";
import { collectBindingReferences } from "../symbols.ts";
import { startLspWithFiles, locationsOf, type LspHarness, editsOf } from "./lsp-harness-navigation.ts";
import { findFnContractInsertPos } from "../sidecar-insert.ts";


// ---------------------------------------------------------------------------
// 别名 import 的 imported 侧：definition 落到正确模块、references 不为空
// ---------------------------------------------------------------------------
describe("别名 import 的 imported 侧：definition 落到正确模块、references 不为空", () => {
/**
 * import 绑定表只以「本地名」为键 ⇒ 别名 import 的 **imported 侧**
 * 标识符在引擎眼里不是 import 绑定 ⇒ ① `references` 返回 `[]`（假绿）
 * ② `definition` 退化到**工作区同名导出**兜底 ⇒ 跳到**无关文件**（假跳转）。
 *
 * 报告说的症状（**假阳性 —— 两个症状都不复现**）：
 * 夹具：`aaa.js` 与 `zzz.js` **同名导出 `helper`**；`plain.js` 走**无别名**
 * import、`aliased.js` 走**别名** import（两者都从 `./zzz.js` 导入 ⇒
 * **唯一变量 = 有没有别名**）。
 * 报告实测：别名 import 的 imported 侧 `helper` ⇒ `definition = aaa.js`、
 * `references = []`。
 *
 * 实测（HEAD `dd22619e` 上逐字，见 `tmp/probe/fix-r91/D/oracle-before-head.txt`）：
 * · `aliased.js` 的 **imported 侧** `helper`@0:9 ⇒
 * `definition = ["zzz.js:0:16-0:22"]` ⇒ **跳到正确的模块**（**不是** `aaa.js`）；
 * `references = ["zzz.js:0:16-0:22","plain.js:0:9-0:15","plain.js:2:17-2:23",
 * "aliased.js:0:9-0:15"]` ⇒ **不是 `[]`**，且与**无别名形态**（`plain.js`
 * 的 imported 侧）**完全一致**。
 * · `aliased.js` 的 **local 侧** `p`@0:19 ⇒
 * `definition = ["zzz.js:0:16-0:22","aliased.js:0:19-0:20"]` ⇒ 正确。
 *
 * ⇒ **症状**已被覆盖：`findEdgeAt`（`symbols.ts`，**位置感知**）先拿到光标处
 * **那一条具体的 import 说明符** ⇒ imported 侧不再靠「本地名」猜模块；
 * `resolveDefinitionLocations` 的 `at` 透传让 `workspaceFallback` 只在
 * `out.length === 0` 时才走 ⇒ **不会**落到无关的同名导出。
 *
 * ⚠ **根因字面仍成立**：`collectImportBindings`（`symbols.ts`）的键**仍只取本地名**
 * ⇒ 当前之所以没炸，是因为上面那条**位置感知旁路**恰好绕开了它
 * ⇒ **一旦有人删改那条旁路，1025 的症状会原样复活**
 * ⇒ 本钉就是「别把旁路改坏」的护栏（**族 24 残留项**，本片不修）。
 *
 * 本文件是**反向守护钉**：钉住「**已修**」的行为 ⇒ **在 HEAD 上必须通过**
 * （闸④ 反向闸）。
 */



/** 无关的**同名导出**（工作区兜底的「猎物」） */
const AAA = `export function helper(x) {
  return "WRONG-FILE-aaa";
}
`;
/** 真正的来源模块 */
const ZZZ = `export function helper(x) {
  return "RIGHT-FILE-zzz";
}
`;
/** 无别名 import（对照组）：imported 侧 `helper` 在 0:9-0:15，用法在 2:17-2:23 */
const PLAIN = `import { helper } from "./zzz.js";

export const a = helper(1);
`;
/** 别名 import：imported 侧 `helper` 在 0:9-0:15，local 侧 `p` 在 0:19-0:20 */
const ALIASED = `import { helper as p } from "./zzz.js";

export const b = p(2);
`;

type Loc = {
  file: string;
  line: number;
  character: number;
  endLine: number;
  endCharacter: number;
};

/** Location[] ⇒ 可断言的位点列表（按 file/line/character 排序） */
function locsOf(result: unknown): Loc[] {
  if (!Array.isArray(result)) return [];
  return (result as any[])
    .map((l) => ({
      file: String(l?.uri ?? "").split("/").pop() ?? "",
      line: l?.range?.start?.line ?? -1,
      character: l?.range?.start?.character ?? -1,
      endLine: l?.range?.end?.line ?? -1,
      endCharacter: l?.range?.end?.character ?? -1,
    }))
    .sort(
      (a, b) =>
        a.file.localeCompare(b.file) || a.line - b.line || a.character - b.character,
    );
}

const ZZZ_DECL: Loc = {
  file: "zzz.js",
  line: 0,
  character: 16,
  endLine: 0,
  endCharacter: 22,
};


  it("definition@imported 侧：落到真正被导入的模块，不得落到同名导出的无关文件；references@imported 侧：不是空数组，且与无别名形态完全一致；definition@local 侧：仍然落到真正被导入的模块", async () => {
  {
    await withLspServer(
      { "aaa.js": AAA, "zzz.js": ZZZ, "plain.js": PLAIN, "aliased.js": ALIASED },
      async ({ req, uri }) => {
        const defs = locsOf(
          await req("textDocument/definition")({
            textDocument: { uri: uri("aliased.js") },
            position: { line: 0, character: 9 }, // imported 侧 `helper`
          }),
        );
        expect(defs).toContainEqual(ZZZ_DECL);
        expect(
          defs.filter((d) => d.file === "aaa.js"),
          "definition 不得退到工作区里无关的同名导出（aaa.js）",
        ).toEqual([]);
      },
    );
  }
  {
    await withLspServer(
      { "aaa.js": AAA, "zzz.js": ZZZ, "plain.js": PLAIN, "aliased.js": ALIASED },
      async ({ req, uri }) => {
        const aliasedRefs = locsOf(
          await req("textDocument/references")({
            textDocument: { uri: uri("aliased.js") },
            position: { line: 0, character: 9 }, // imported 侧 `helper`
            context: { includeDeclaration: true },
          }),
        );
        const plainRefs = locsOf(
          await req("textDocument/references")({
            textDocument: { uri: uri("plain.js") },
            position: { line: 0, character: 9 }, // imported 侧 `helper`（无别名对照）
            context: { includeDeclaration: true },
          }),
        );
        expect(
          aliasedRefs.length,
          "别名 import 的 imported 侧 references 不得返回空数组（假绿）",
        ).toBeGreaterThan(0);
        expect(aliasedRefs).toContainEqual(ZZZ_DECL);
        expect(
          aliasedRefs.filter((r) => r.file === "aaa.js"),
          "references 不得混进无关的同名导出",
        ).toEqual([]);
        // 唯一变量 = 有没有别名 ⇒ 两侧的引用集必须**完全一致**
        expect(aliasedRefs).toEqual(plainRefs);
      },
    );
  }
  {
    await withLspServer(
      { "aaa.js": AAA, "zzz.js": ZZZ, "plain.js": PLAIN, "aliased.js": ALIASED },
      async ({ req, uri }) => {
        const defs = locsOf(
          await req("textDocument/definition")({
            textDocument: { uri: uri("aliased.js") },
            position: { line: 0, character: 19 }, // local 侧 `p`
          }),
        );
        expect(defs).toContainEqual(ZZZ_DECL);
        expect(defs.filter((d) => d.file === "aaa.js")).toEqual([]);
      },
    );
  }
});



});


// ---------------------------------------------------------------------------
// LSP check 通道必须看得见项目级 path env（IDE 红 / CLI 绿 ⇒ 假红）
// ---------------------------------------------------------------------------
describe("LSP check 通道必须看得见项目级 path env（IDE 红 / CLI 绿 ⇒ 假红）", () => {
/**
 * LSP **check 通道**看不见**项目级** path env ⇒ IDE 假红
 * （`nudo:entry-may-throw`），而 CLI `nudo check` 绿（两面口径相反）。
 *
 * 机制：`buildLspInjection`（`packages/lsp/src/agent-tools.ts`）把
 * `package.json#nudo.env` 的**原始相对名**（`./env.mjs`）塞进注入包；
 * 而 `checkSource` 的 env 查表基准 = 「**最后一次**预载的目录」= **文件目录**
 * （文件级 env 预载在后）⇒ 相对说明符的唯一候选 = `<proj>/src/env.mjs`
 * ≠ 预载登记的 `<proj>/env.mjs` ⇒ 查表落空 ⇒ env 全局缺失 ⇒ 入口求值抛
 * `ReferenceError: MAGIC is not defined` ⇒ 报 L2 `nudo:entry-may-throw`。
 * CLI 侧 `assembleEnvs` 早已把项目级说明符按**项目根**绝对化 ⇒ CLI 绿。
 *
 * 修法：项目级 env 说明符按**项目根**（`proj.projectDir`）绝对化，与 CLI
 * `assembleEnvs` 同款（共用 service 的 `absolutizeEnvSpec` 单一事实源）；
 * 文件级 env **仍按文件目录解析**（保持相对名），裸拼写名的既有判定口径不变。
 *
 * 钉：
 * - 正控制：项目根有 path env + 被检查文件在**子目录**且声明了文件级 env
 * ⇒ LSP check 通道**不得**报 L2 `nudo:entry-may-throw`（env 全局可见）；
 * - 负控制：**真违约**（入口真的 throw）⇒ 仍**必须**报 L2 `nudo:entry-may-throw`
 * （防止把闸门整体关掉）。
 */







/** 项目级 env（项目根）：MAGIC = 42。 */
const ENV_MJS = `export function defineEnv() {
  return { globals: { MAGIC: 42 } };
}
`;

/** 合法入口：读 env 全局（env 可见 ⇒ 不抛 ⇒ 不得报 L2）。 */
const OK_SRC = `/// @nudo:env node
export function f() { return MAGIC; }
`;

/** 真违约：入口真的抛 ⇒ 必须报 L2（负控制）。 */
const THROW_SRC = `/// @nudo:env node
export function g() { throw new Error("boom"); }
`;

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** 临时项目：package.json（项目级 env）+ env.mjs（项目根）+ src/<name>.js。 */
function makeProject(name: string, src: string): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-lsp-1104-"));
  dirs.push(dir);
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name, private: true, nudo: { env: ["./env.mjs"] } }),
    "utf-8",
  );
  writeFileSync(join(dir, "env.mjs"), ENV_MJS, "utf-8");
  const file = join(dir, "src", "app.js");
  writeFileSync(file, src, "utf-8");
  return { dir, file };
}

function collector(): { sent: LspDiagnostic[]; deps: ValidateTextDeps } {
  const sent: LspDiagnostic[] = [];
  return {
    sent,
    deps: {
      sendDiagnostics: (p) => {
        sent.push(...p.diagnostics);
      },
    },
  };
}

function codes(diags: LspDiagnostic[]): string[] {
  return diags.map((d) => String(d.code));
}

{
  beforeEach(() => {
    clearValidationState();
    clearPathEnvCaches();
  });

  it("正控制：项目根 env + 子目录文件 ⇒ 不报 L2 entry-may-throw（IDE push 面）；正控制：check 通道本身（checkToLspDiagnostics）不报 L2 entry-may-throw；负控制：真违约（入口真的 throw）⇒ 仍必须报 L2 entry-may-throw；负控制（check 通道本身）：真违约 ⇒ 仍报 L2 entry-may-throw", async () => {
  {
    clearValidationState();
    clearPathEnvCaches();


    const { file } = makeProject("envproj-ok", OK_SRC);
    const { sent, deps } = collector();
    await validateText(file, `file://${file}`, OK_SRC, 1, deps);

    const c = codes(sent);
    expect(c).not.toContain("nudo:entry-may-throw");
    // env 全局可见 ⇒ 也不该报「内建 API 未覆盖」
    expect(c).not.toContain("nudo:builtin-unknown");
  }
  {
    clearValidationState();
    clearPathEnvCaches();


    const { file } = makeProject("envproj-ok2", OK_SRC);
    // 预载态：IDE 的分析通道（analyzeFileAsync）先跑 ⇒ path env 已登记
    await analyzeFileAsync(file, OK_SRC);

    const diags = checkToLspDiagnostics(file, OK_SRC);
    expect(codes(diags)).not.toContain("nudo:entry-may-throw");
  }
  {
    clearValidationState();
    clearPathEnvCaches();


    const { file } = makeProject("envproj-throw", THROW_SRC);
    const { sent, deps } = collector();
    await validateText(file, `file://${file}`, THROW_SRC, 1, deps);

    // 闸门没被整体关掉：真违约照报
    expect(codes(sent)).toContain("nudo:entry-may-throw");
  }
  {
    clearValidationState();
    clearPathEnvCaches();


    const { file } = makeProject("envproj-throw2", THROW_SRC);
    await analyzeFileAsync(file, THROW_SRC);

    const diags = checkToLspDiagnostics(file, THROW_SRC);
    expect(codes(diags)).toContain("nudo:entry-may-throw");
  }
});



}
});


// ---------------------------------------------------------------------------
// 放宽侧车契约必须打在被违反的参数槽
// ---------------------------------------------------------------------------
describe("放宽侧车契约必须打在被违反的参数槽", () => {
/**
 * 「放宽侧车契约」quickfix 对**参数违例**打到**返回槽**
 *
 * 现象：诊断是 `argument ⊭ precondition`（参数违例），动作却把侧车的**返回槽**
 * 改掉（`number().gt(40)` → `number()`）⇒ 参数诊断原样保留、返回契约被静默削弱。
 * 根因：`loosen` 正则不匹配诊断文案 ⇒ `param === undefined` ⇒ 替换器落到
 * `tryReturnSlot`；且动作**没有**「落盘后诊断是否消失」的验证门。
 *
 * 钉（修复后行为）：
 * 1. 参数违例的放宽动作只能改**被违反形参**的槽：标题带 `greet.u`、
 * 编辑只剥 `u` 的数值谓词，返回槽的 `.gt(40)` 原样保留；
 * 2. 落盘后目标参数诊断**真的消失**（动作可执行，不是假修复）；
 * 3. 改不动参数槽时（shape 参数）**不下发**放宽动作 —— 尤其不得退化成
 * 「改返回槽」（旧症状：参数诊断仍在 + 返回契约被削弱）；
 * 4. 证据面：旧的那份返回槽编辑（`.gt(40)` → `number()`）对参数诊断
 * 一字无效 ⇒ 不下发是被诊断验证的，不是拍脑袋。
 */








/** 段内夹具（逐字） */
const GREET_JS = `export function greet(u) {
  return u.name;
}
greet({ id: 2 });
`;
const SC_SHAPE = `import { fn, shape, string, number } from "@nudojs/core";

export const greet = fn({ u: shape({ name: string() }) }, number().gt(40));
`;

/** 参数槽可放宽的对照：同一诊断形态，但形参是数值谓词 */
const GREET_JS_NUM = `export function greet(u) {
  return 42;
}
greet(-1);
`;
const SC_NUM = `import { fn, number } from "@nudojs/core";

export const greet = fn({ u: number().gt(0) }, number());
`;
/** 参数槽可放宽 + 返回槽带数值谓词（旧实现会误伤的那一份） */
const SC_NUM_RET = `import { fn, number } from "@nudojs/core";

export const greet = fn({ u: number().gt(0) }, number().gt(40));
`;

const isParamDiag = (msg: string): boolean => /argument ⊭ precondition/.test(msg);
const isRelax = (a: CodeActionEntry): boolean => /Relax sidecar contract/i.test(a.title);

/** LSP 3.18 Diagnostic.message 为 string | MarkupContent；本产品始终写纯字符串。 */
const msgText = (m: string | { value: string }): string =>
  typeof m === "string" ? m : m.value;

/** 落盘夹具 → 目标诊断 → 该诊断的 codeAction 列表 */
function actionsFor(
  dirPrefix: string,
  js: string,
  sc: string,
  pick: (message: string) => boolean,
) : { actions: CodeActionEntry[]; messages: string[]; scText: string; uri: string } {
  return withTempDir(dirPrefix, (dir) => {
    const jsPath = join(dir, "greet.js");
    writeFileSync(jsPath, js, "utf-8");
    writeFileSync(join(dir, "greet.nudo.js"), sc, "utf-8");
    const uri = `file://${jsPath}`;
    const diags = checkToLspDiagnostics(jsPath, js, defaultLoadModule);
    const target = diags.filter((d) => pick(msgText(d.message)));
    expect(target.length).toBeGreaterThan(0);
    const handler = mountCodeActions(uri, js);
    const actions: CodeActionEntry[] = [];
    for (const d of target) {
      actions.push(...handler(codeActionParams(uri, d.range.start.line, [d])));
    }
    return { actions, messages: target.map((d) => msgText(d.message)), scText: sc, uri };
  });
}


  it("参数违例：动作标题带 greet.u，编辑只剥形参谓词（返回槽 .gt(40) 不动）；落盘后目标参数诊断消失（编辑真的可执行，不是假修复）；参数槽改不动（shape 参数）⇒ 不下发放宽动作，不得退化成改返回槽；证据面：只剥返回槽数值谓词对参数诊断一字无效（所以不下发）", () => {
  {
    const { actions, scText, uri } = actionsFor("nudo-lsp-133a-", GREET_JS_NUM, SC_NUM_RET, isParamDiag);
    const relax = actions.filter(isRelax);
    expect(relax).toHaveLength(1);
    // 标题必须指出目标槽：`greet` 后面带 `.u`（旧实现标题只有 `greet`）
    expect(relax[0]!.title).toBe("Relax sidecar contract for greet.u");

    const edits = sidecarEdits(relax, uri);
    expect(edits).toHaveLength(1);
    expect(edits[0]!.newText).toBe(
      `import { fn, number } from "@nudojs/core";

export const greet = fn({ u: number() }, number().gt(40));
`,
    );
    // 落盘后：只放宽了 u，返回槽的 `.gt(40)` 一字未动
    const landed = applyEdits(scText, edits);
    expect(landed).toContain("fn({ u: number() }");
    expect(landed).toContain("number().gt(40)");
  }
  {
    const { actions, scText, uri } = actionsFor("nudo-lsp-133b-", GREET_JS_NUM, SC_NUM, isParamDiag);
    const relax = actions.filter(isRelax);
    expect(relax).toHaveLength(1);
    const landed = applyEdits(scText, sidecarEdits(relax, uri));
    expect(landed).toBe(`import { fn, number } from "@nudojs/core";

export const greet = fn({ u: number() }, number());
`);

    withTempDir("nudo-lsp-133b-recheck-", (dir) => {
      const jsPath = join(dir, "greet.js");
      writeFileSync(jsPath, GREET_JS_NUM, "utf-8");
      writeFileSync(join(dir, "greet.nudo.js"), landed, "utf-8");
      const after = checkToLspDiagnostics(jsPath, GREET_JS_NUM, defaultLoadModule);
      expect(after.filter((d) => isParamDiag(msgText(d.message)))).toHaveLength(0);
      expect(after).toHaveLength(0);
    });
  }
  {
    const { actions, messages } = actionsFor("nudo-lsp-133c-", GREET_JS, SC_SHAPE, isParamDiag);
    // 目标确实是参数违例（expected: missing field u.name）
    expect(messages.join("\n")).toMatch(/missing field u\.name/);
    // 旧实现会下发标题「Relax sidecar contract for greet」→ 改返回槽 ⇒ 参数诊断仍在
    expect(actions.filter(isRelax)).toHaveLength(0);
    // 任何候选动作都不得削弱返回契约
    const allSidecarText = actions.map((a) =>
      JSON.stringify(a.edit?.changes ?? {}),
    ).join("\n");
    expect(allSidecarText).not.toContain("fn({ u: shape({ name: string() }) }, number())");
    // 参数违例本身仍引导用户改**调用点**
    expect(actions.map((a) => a.title)).toContain("Add missing field 'name' to call");
  }
  {
    withTempDir("nudo-lsp-133d-", (dir) => {
      const jsPath = join(dir, "greet.js");
      writeFileSync(jsPath, GREET_JS, "utf-8");
      // 旧 quickfix 的落盘结果：返回槽 number().gt(40) → number()
      const weakened = SC_SHAPE.replace("number().gt(40)", "number()");
      writeFileSync(join(dir, "greet.nudo.js"), weakened, "utf-8");
      const after = checkToLspDiagnostics(jsPath, GREET_JS, defaultLoadModule);
      // 参数诊断原样保留
      expect(after.filter((d) => isParamDiag(msgText(d.message)))).toHaveLength(1);
      expect(after.map((d) => msgText(d.message)).join("\n")).toMatch(/missing field u\.name/);
    });
  }
});




});


// ---------------------------------------------------------------------------
// 放宽侧车契约不得下发消不掉诊断的假修复
// ---------------------------------------------------------------------------
describe("放宽侧车契约不得下发消不掉诊断的假修复", () => {
/**
 * 「放宽侧车契约」quickfix 对**基类型不匹配**（`string ⊭ number`）
 * 永远消不掉诊断 ⇒ 建议不可执行
 *
 * 现象：返回值基类型就与侧车返回槽冲突时，动作只会剥数值谓词
 * （`number().gt(40)` → `number()`）⇒ 诊断**一字未消**（`string ⊭ number`），
 * 用户点完「修复」diff 出来了、诊断一条不少。
 * 根因：`stripNumericPreds` 只剥数值谓词，没有「`number()` → `string()`」路径；
 * 动作只检查「有 diff」就下发，**没有**「落盘后目标诊断是否消失」的验证门。
 *
 * 钉（修复后行为）：
 * 1. 基类型冲突（不可解）⇒ **不下发**放宽动作（无 diff 可清诊断）；
 * 2. 证据面：旧动作的落盘结果（返回槽 → `number()`）诊断原样还在
 * ⇒ 不下发是被诊断验证的，不是拍脑袋；
 * 3. 校准（正控制）：返回槽**数值**冲突可解时动作仍在、落盘后诊断消失
 * ⇒ 门不是「一刀切封杀」，判据 = 编辑是否真的清掉目标诊断；
 * 4. 返回槽没有可放宽的数值精化（`number()`）⇒ 不下发（无 edit 空转）。
 */








/** 段内夹具（逐字）：返回 `u.name`（string）⊭ 返回槽 number().gt(40) */
const GREET_JS = `export function greet(u) {
  return u.name;
}
greet({ id: 2 });
`;
const SC_SHAPE = `import { fn, shape, string, number } from "@nudojs/core";

export const greet = fn({ u: shape({ name: string() }) }, number().gt(40));
`;

/** 返回槽放宽**可解**的对照：返回 42 只违反对数值下界 */
const GREET_JS_RET = `export function greet(u) {
  return 42;
}
greet(0);
`;
const SC_RET_NUM = `import { fn, number } from "@nudojs/core";

export const greet = fn({ u: number() }, number().gt(80));
`;

const isReturnBaseDiag = (msg: string): boolean => /return value ⊭ sidecar/.test(msg);
const isRelax = (a: CodeActionEntry): boolean => /Relax sidecar contract/i.test(a.title);

/** LSP 3.18 Diagnostic.message 为 string | MarkupContent；本产品始终写纯字符串。 */
const msgText = (m: string | { value: string }): string =>
  typeof m === "string" ? m : m.value;

function actionsFor(
  dirPrefix: string,
  js: string,
  sc: string,
  pick: (message: string) => boolean,
): { actions: CodeActionEntry[]; messages: string[]; scText: string; uri: string } {
  return withTempDir(dirPrefix, (dir) => {
    const jsPath = join(dir, "greet.js");
    writeFileSync(jsPath, js, "utf-8");
    writeFileSync(join(dir, "greet.nudo.js"), sc, "utf-8");
    const uri = `file://${jsPath}`;
    const diags = checkToLspDiagnostics(jsPath, js, defaultLoadModule);
    const target = diags.filter((d) => pick(msgText(d.message)));
    expect(target.length).toBeGreaterThan(0);
    const handler = mountCodeActions(uri, js);
    const actions: CodeActionEntry[] = [];
    for (const d of target) {
      actions.push(...handler(codeActionParams(uri, d.range.start.line, [d])));
    }
    return { actions, messages: target.map((d) => msgText(d.message)), scText: sc, uri };
  });
}


  it("返回基类型冲突（string ⊭ number）⇒ 不下发放宽动作、不产生侧车编辑；证据面：旧动作的落盘结果（返回槽 → number()）诊断原样保留；返回槽没有可放宽的数值精化（number()）⇒ 不下发（无 edit 空转）；正控制：返回槽**数值**冲突可解时动作仍在，落盘后目标诊断消失", () => {
  {
    const { actions, messages, uri } = actionsFor(
      "nudo-lsp-134a-",
      GREET_JS,
      SC_SHAPE,
      isReturnBaseDiag,
    );
    expect(messages.join("\n")).toMatch(/typeof return = "string" ⊭ "number"/);
    // 旧实现下发「Relax sidecar contract for greet」⇒ 只剥 .gt(40) ⇒ 诊断还在
    expect(actions.filter(isRelax)).toHaveLength(0);
    expect(sidecarEdits(actions, uri)).toHaveLength(0);
  }
  {
    withTempDir("nudo-lsp-134b-", (dir) => {
      const jsPath = join(dir, "greet.js");
      writeFileSync(jsPath, GREET_JS, "utf-8");
      const weakened = SC_SHAPE.replace("number().gt(40)", "number()");
      writeFileSync(join(dir, "greet.nudo.js"), weakened, "utf-8");
      const after = checkToLspDiagnostics(jsPath, GREET_JS, defaultLoadModule);
      expect(after.filter((d) => isReturnBaseDiag(msgText(d.message)))).toHaveLength(1);
      expect(after.map((d) => msgText(d.message)).join("\n")).toMatch(
        /typeof return = "string" ⊭ "number"/,
      );
    });
  }
  {
    const { actions, messages, uri } = actionsFor(
      "nudo-lsp-134c-",
      GREET_JS,
      SC_SHAPE.replace("number().gt(40)", "number()"),
      isReturnBaseDiag,
    );
    expect(messages.join("\n")).toMatch(/return slot \(number\(\)\)/);
    expect(actions.filter(isRelax)).toHaveLength(0);
    expect(sidecarEdits(actions, uri)).toHaveLength(0);
  }
  {
    const { actions, scText, uri } = actionsFor(
      "nudo-lsp-134d-",
      GREET_JS_RET,
      SC_RET_NUM,
      isReturnBaseDiag,
    );
    const relax = actions.filter(isRelax);
    expect(relax).toHaveLength(1);
    // 返回槽（不是形参）⇒ 标题不带 `.u`
    expect(relax[0]!.title).toBe("Relax sidecar contract for greet");
    const edits = sidecarEdits(relax, uri);
    expect(edits).toHaveLength(1);
    const landed = applyEdits(scText, edits);
    expect(landed).toBe(`import { fn, number } from "@nudojs/core";

export const greet = fn({ u: number() }, number());
`);

    withTempDir("nudo-lsp-134d-recheck-", (dir) => {
      const jsPath = join(dir, "greet.js");
      writeFileSync(jsPath, GREET_JS_RET, "utf-8");
      writeFileSync(join(dir, "greet.nudo.js"), landed, "utf-8");
      const after = checkToLspDiagnostics(jsPath, GREET_JS_RET, defaultLoadModule);
      expect(after.filter((d) => isReturnBaseDiag(msgText(d.message)))).toHaveLength(0);
      expect(after).toHaveLength(0);
    });
  }
});




});


// ---------------------------------------------------------------------------
// codeLens 标题与 CLI nudo test 见证行逐字符同形
// ---------------------------------------------------------------------------
describe("codeLens 标题与 CLI nudo test 见证行逐字符同形", () => {
/**
 * LSP codeLens 标题与 CLI `nudo test` 见证行**不同形**。
 *
 * 症状（同文件、同分析，两面并排）：
 * - CLI `nudo test` 见证行：`" entry@L1 (any) => unknown throws TypeError"`
 * （2 格容器缩进 + throws 前 **3** 空格）；
 * - LSP lens 标题：`"entry@L1 (any) => unknown throws TypeError"`
 * （无容器缩进 + throws 前 **2** 空格）。
 *
 * `agent-tools.ts` 的注释明文承诺「**标题与 test 报告同形**」⇒ 同一事实
 * 两面渲染不一致（非 throws 分支当时是一致的，只有 throws 分支分裂）。
 *
 * 修法：LSP 的 `observationTitle` 与 CLI 的 `formatCaseLine` 采用同一模板
 * （throws 前 3 空格；lens 标题不带容器缩进，CLI 报告在 `caseLines.push` 处加
 * 2 空格）⇒ 比对口径 = `" " + lens.title`。
 *
 * 钉（同一 fixture、两条**产品**路径，不 spawn CLI）：
 * - CLI 侧：`buildTestReport(file, analyzeFileAsync(...))` 的 `caseLines`；
 * - LSP 侧：`computeObservationLenses(source, file)` 的 `title`；
 * ⇒ 逐字符相等：`caseLines` 含 `" " + lens.title`（且反向：每条
 * `call@` / `entry@` 见证行都有同标题的 lens）。
 */








/** `tmp/repro//half.js` 逐字内容 */
const HALF_SRC = `export function f(x) {
  return x.a.b;
}
f(undefined);
`;


  it("每条 lens 标题在 CLI 报告里是 `  <title>`；throws 分支为 3 空格", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug136-"));
    try {
      const file = join(dir, "half.js");
      writeFileSync(file, HALF_SRC, "utf-8");

      const result = await analyzeFileAsync(
        file,
        HALF_SRC,
        undefined,
        undefined,
        undefined,
        "all",
      );
      const report = buildTestReport(file, result);
      const lenses = computeObservationLenses(HALF_SRC, file);

      const titles = lenses.map((l) => l.title);
      expect(titles.length, `lenses 为空 ⇒ 无法对拍`).toBeGreaterThan(0);

      // ① LSP → CLI：每条 lens 标题在报告里逐字符命中（含 2 格容器缩进）
      for (const lens of lenses) {
        expect(
          report.caseLines,
          `lens 标题不在 test 报告里：${JSON.stringify(lens.title)}`,
        ).toContain(`  ${lens.title}`);
      }

      // ② CLI → LSP：报告里每条 call@ / entry@ 见证行都有同标题的 lens
      const witnessLines = report.caseLines.filter((l) => /^ {2}(call@|entry@)/.test(l));
      expect(witnessLines.length).toBeGreaterThan(0);
      for (const line of witnessLines) {
        expect(titles, `报告见证行没有对应 lens：${JSON.stringify(line)}`).toContain(
          line.slice(2),
        );
      }

      // ③ throws 分支的绝对形态：`=> unknown` 与 `throws TypeError` 之间 3 空格
      const throwsLens = lenses.find((l) => l.title.includes("throws"));
      expect(throwsLens, `没有 throws 见证：${JSON.stringify(titles)}`).toBeDefined();
      expect(throwsLens!.title).toContain("=> unknown   throws TypeError");
      // 改前是 2 空格 ⇒ 这条断言把形态钉死（不靠两面互相自证）
      expect(throwsLens!.title).not.toContain("unknown  throws");
      // lens 标题不带容器缩进；报告行 = 2 空格 + 标题
      expect(throwsLens!.title.startsWith("entry@")).toBe(true);
      expect(report.caseLines).toContain(`  ${throwsLens!.title}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

});


// ---------------------------------------------------------------------------
// LSP check 面施加 inject 通道（@nudo:mock 生效）
// ---------------------------------------------------------------------------
describe("LSP check 面施加 inject 通道（@nudo:mock 生效）", () => {
/**
 * 回归（LSP 编辑器面）：check 通道必须施加 **inject 通道**
 * （`@nudo:mock` / `@nudo:as` / `@nudo:replace` / env 全局），与 CLI
 * `nudo check` 同源同口径。
 *
 * 病灶：本面此前只传 `modules`（不传 `inject`）⇒ 被 mock 掉的依赖退化成
 * 未知全局 ⇒ 报 `nudo:entry-may-throw`（**假红**：同一份文件 CLI 判绿、
 * IDE 判红）。
 *
 * 修法（packages/lsp/src/validation.ts）：复用本包唯一的注入装配器
 * `buildLspInjection`（packages/lsp/src/agent-tools.ts，与 agent 工具面
 * 同源），并按 CLI 的口径同时喂 `modules`（并入 env / mock-module 覆盖
 * 后的表）与 `inject`。
 *
 * 负控制：真的没有 mock 的文件，入口 may-throw 诊断**仍应**出现（不得把
 * 门禁整体关掉）。
 */






const MOCKED_SRC = `/**
 * @nudo:mock dep = (x) => x
 */
export function f() {
  return dep(1);
}
`;

/** 无 mock 的对照：入口读一个不存在的全局 ⇒ 真的可能抛 */
const UNMOCKED_SRC = `export function g() {
  return notDefinedAnywhere(1);
}
`;

function codes(diags: { code?: string | number }[]): string[] {
  return diags.map((d) => String(d.code ?? ""));
}


  it("@nudo:mock 覆盖的依赖不得再报 nudo:entry-may-throw（与 CLI 同口径：绿）；负控制：没有 mock 的入口仍报 nudo:entry-may-throw（门禁未被关掉）", () => {
  {
    withTempDir("nudo-lsp-bug-634-", (dir) => {
      const file = join(dir, "lib.js");
      writeFileSync(file, MOCKED_SRC, "utf-8");
      const diags = checkToLspDiagnostics(file, MOCKED_SRC);
      expect(codes(diags)).not.toContain("nudo:entry-may-throw");
    });
  }
  {
    withTempDir("nudo-lsp-bug-634b-", (dir) => {
      const file = join(dir, "g.js");
      writeFileSync(file, UNMOCKED_SRC, "utf-8");
      const diags = checkToLspDiagnostics(file, UNMOCKED_SRC);
      expect(codes(diags)).toContain("nudo:entry-may-throw");
    });
  }
});


});


// ---------------------------------------------------------------------------
// references 不得重复声明位 / 混入语句级伪引用
// ---------------------------------------------------------------------------
describe("references 不得重复声明位 / 混入语句级伪引用", () => {
/**
 * 回归钉：LSP `textDocument/references` 不得把**声明位点返回两次**，
 * 也不得混入语句级伪引用。
 *
 * 改前（协议面实测，见 tmp/probe/fix-r30/d1-before.txt）：
 * references on `score`（`export function score(row) {...}` 的声明位）
 * → [0:16-0:21]（声明）、[0:16-0:21]（**同一个声明再来一次**）、
 * [0:0-2:1]（**整条 export 声明**）、…（跨文件引用）
 * ⇒ 同一个位置出现两次；客户端按位置高亮会出现重影。
 *
 * 根因（两条）：
 * 1) `resolveReferences` 把「符号表里的声明位」与「引用集合里的声明位」
 * 各推一次（两处坐标相同）⇒ 重复；
 * 2) 导出绑定的 `referencePaths` 里混着 `ExportNamedDeclaration` **语句
 * 节点** ⇒ 变成一条覆盖整条声明的伪引用（与 同源）。
 *
 * 修法：① 引用集合按 (uri, 位置) 去重；② `collectBindingReferences` 的
 * referencePaths 只收 Identifier 节点（语句级目标不再进引用集合）。
 */





const C_SRC = `export function score(row) {
  return row.id;
}
`;


  it("collectBindingReferences：导出绑定不产生语句级伪引用；协议面：references 的每个位置只出现一次", async () => {
  {
    const ast = parse(C_SRC);
    const refs = collectBindingReferences(ast, "score", { line: 1, column: 17 }, "file:///t/c.js");
    expect(refs.length).toBe(1);
    expect(refs[0]!.loc.start.line).toBe(1);
    expect(refs[0]!.loc.start.column).toBe(16);
    expect(refs[0]!.loc.end.column).toBe(21);
    // 不得出现覆盖整条声明的「引用」
    for (const r of refs) {
      expect(r.loc.end.line).toBe(r.loc.start.line);
    }
  }
  {
    await withLspServer(
      {
        "c.js": C_SRC,
        "d.js": `import { score } from "./c.js";\nexport function use(row) {\n  return score(row);\n}\n`,
      },
      async ({ req, uri }) => {
        const res = req("textDocument/references")({
          textDocument: { uri: uri("c.js") },
          position: { line: 0, character: 16 },
          context: { includeDeclaration: true },
        });
        const locs = res as any[];
        expect(Array.isArray(locs)).toBe(true);
        const keys = locs.map((l) => `${l.uri}:${l.range.start.line}:${l.range.start.character}`);
        // 同一位置不得出现两次
        expect(new Set(keys).size).toBe(keys.length);
        // 声明位恰好一次
        const decls = locs.filter(
          (l) => l.uri === uri("c.js") && l.range.start.line === 0 && l.range.start.character === 16,
        );
        expect(decls.length).toBe(1);
        // 不得混入覆盖整条 export 声明的伪引用
        for (const l of locs) {
          const width =
            l.range.start.line === l.range.end.line
              ? l.range.end.character - l.range.start.character
              : Number.MAX_SAFE_INTEGER;
          expect(width).toBeLessThanOrEqual(21);
        }
      },
      "nudo-lsp-702-",
    );
  }
});


});


// ---------------------------------------------------------------------------
// export default 的跨文件 references
// ---------------------------------------------------------------------------
describe("export default 的跨文件 references", () => {
/**
 * export default 的跨文件 references 为空。
 *
 * 症状：definition 能跳到 default 导出的定义，references 却查不到任何调用方
 * （自相矛盾）。根因：跨文件引用匹配用的是**导出名**，而 default 导入的
 * importedName 是 "default"、被查符号的本地名是 "greet" ⇒ 永远匹配不上。
 */



let h: LspHarness | null = null;
afterEach(() => {
  h?.cleanup();
  h = null;
});

const A = `export default function greet(n) {
  return n + 1;
}
`;
const B = `import greet from "./a.js";

export function use() {
  return greet(1);
}
`;


  it("default 导出的定义处能查到 default 导入方的 import 说明符与调用点；default 导入方一侧发起 references 也能覆盖定义文件", async () => {
  {
    h = await startLspWithFiles({ "a.js": A, "b.js": B });
    const refs = locationsOf(
      h.req("textDocument/references", {
        textDocument: { uri: h.uri("a.js") },
        position: { line: 0, character: 24 }, // export default function greet
        context: { includeDeclaration: true },
      }),
    );
    // 导入方的 import 说明符（default 导入的本地名 greet）
    expect(refs).toContainEqual({
      file: "b.js",
      line: 0,
      character: 7,
      endLine: 0,
      endCharacter: 12,
    });
    // 导入方的调用点
    expect(refs).toContainEqual({
      file: "b.js",
      line: 3,
      character: 9,
      endLine: 3,
      endCharacter: 14,
    });
  }
  {
    h = await startLspWithFiles({ "a.js": A, "b.js": B });
    const refs = locationsOf(
      h.req("textDocument/references", {
        textDocument: { uri: h.uri("b.js") },
        position: { line: 0, character: 7 }, // import greet
        context: { includeDeclaration: true },
      }),
    );
    expect(refs).toContainEqual({
      file: "a.js",
      line: 0,
      character: 24,
      endLine: 0,
      endCharacter: 29,
    });
  }
});


});


// ---------------------------------------------------------------------------
// 成员属性不触发同名导出兜底
// ---------------------------------------------------------------------------
describe("成员属性不触发同名导出兜底", () => {
/**
 * 成员属性（`obj.x` 的 x）F12 跳到工作区里无关文件的同名导出。
 *
 * 症状：`o.helper()` 的 helper 没有来源，却命中「同名导出兜底」跳到
 * 另一个文件里毫不相干的 `export function helper`。
 */



let h: LspHarness | null = null;
afterEach(() => {
  h?.cleanup();
  h = null;
});

const OTHER = `export function helper() {
  return 1;
}
`;
const USER = `export function go(o) {
  return o.helper();
}
`;


  it("成员属性 helper 的 definition 不得跳到无关文件的同名导出；裸标识符仍能命中同名导出兜底（兜底本身没坏）", async () => {
  {
    h = await startLspWithFiles({ "other.js": OTHER, "user.js": USER });
    const defs = locationsOf(
      h.req("textDocument/definition", {
        textDocument: { uri: h.uri("user.js") },
        position: { line: 1, character: 15 }, // o.helper 的 helper
      }),
    );
    expect(defs.filter((d) => d.file === "other.js")).toEqual([]);
  }
  {
    const other = `export function helper() {
  return 1;
}
`;
    const user = `export function go() {
  return helper();
}
`;
    h = await startLspWithFiles({ "other.js": other, "user.js": user });
    const defs = locationsOf(
      h.req("textDocument/definition", {
        textDocument: { uri: h.uri("user.js") },
        position: { line: 1, character: 9 }, // 裸标识符 helper
      }),
    );
    expect(defs).toContainEqual({
      file: "other.js",
      line: 0,
      character: 16,
      endLine: 0,
      endCharacter: 22,
    });
  }
});


});


// ---------------------------------------------------------------------------
// references 的 includeDeclaration:false 必须剔除声明位
// ---------------------------------------------------------------------------
describe("references 的 includeDeclaration:false 必须剔除声明位", () => {
/**
 * 回归钉：LSP `textDocument/references` 的
 * `context.includeDeclaration: false` **仍返回声明位点**。
 *
 * 改前（协议面实测，见 tmp/probe/fix-r30/d1-before.txt）：
 * references on `v`（a 内），includeDeclaration=false
 * → [1:8-1:9]（**a 里 v 的声明位**）、[2:9-2:10]（用点）❌
 * （includeDeclaration 只作用于 `resolveReferences` 的那一个 `decl` 数组，
 * 管不到引用集合里的声明位）
 *
 * 根因：`collectBindingReferences` 无条件把绑定声明位（`binding.identifier`）
 * 收进引用集合 ⇒ `includeDeclaration` 只关掉了「另一处」的声明。
 *
 * 修法：`collectBindingReferences` 增加 `includeDeclaration` 入参（默认 true
 * —— 直接调用方的既有语义不变），由 `resolveReferences` 按
 * `context.includeDeclaration` 透传。
 */





const SHADOW_SRC = `export function a() {
  const v = 1;
  return v;
}
`;


  it("collectBindingReferences：includeDeclaration=false 不含声明位；collectBindingReferences：默认仍含声明位（既有语义不变，负控制）；协议面：includeDeclaration=false 只返回用点", async () => {
  {
    const ast = parse(SHADOW_SRC);
    const withDecl = collectBindingReferences(ast, "v", { line: 3, column: 10 }, "file:///t/s.js");
    expect(withDecl.length).toBe(2);
    expect(withDecl.some((r) => r.loc.start.line === 2)).toBe(true);

    const withoutDecl = collectBindingReferences(ast, "v", { line: 3, column: 10 }, "file:///t/s.js", {
      includeDeclaration: false,
    });
    expect(withoutDecl.length).toBe(1);
    expect(withoutDecl[0]!.loc.start.line).toBe(3);
  }
  {
    const ast = parse(SHADOW_SRC);
    const refs = collectBindingReferences(ast, "v", { line: 3, column: 10 }, "file:///t/s.js");
    expect(refs.some((r) => r.loc.start.line === 2)).toBe(true);
  }
  {
    await withLspServer({ "shadow.js": SHADOW_SRC }, async ({ req, uri }) => {
      const without = req("textDocument/references")({
        textDocument: { uri: uri("shadow.js") },
        position: { line: 2, character: 9 },
        context: { includeDeclaration: false },
      }) as any[];
      expect(Array.isArray(without)).toBe(true);
      expect(without.length).toBe(1);
      expect(without[0]!.range.start.line).toBe(2);
      expect(without[0]!.range.start.character).toBe(9);

      const with_ = req("textDocument/references")({
        textDocument: { uri: uri("shadow.js") },
        position: { line: 2, character: 9 },
        context: { includeDeclaration: true },
      }) as any[];
      // 负控制：includeDeclaration=true 时声明位必须在
      expect(with_.length).toBe(2);
      expect(with_.some((l) => l.range.start.line === 1)).toBe(true);
    });
  }
});



});


// ---------------------------------------------------------------------------
// 跨文件导航必须用打开文档的 buffer
// ---------------------------------------------------------------------------
describe("跨文件导航必须用打开文档的 buffer", () => {
/**
 * 跨文件导航读**磁盘**文本，而不是编辑器 buffer。
 *
 * 症状：def.js 已被编辑（未保存）⇒ 磁盘上还是旧内容 ⇒ F12 / references /
 * rename 全部按磁盘坐标给位点 ⇒ 跳错行、改名改坏用户代码（两套坐标）。
 */



let h: LspHarness | null = null;
afterEach(() => {
  h?.cleanup();
  h = null;
});

const DEF = `export function oldName(n) {
  return n + 1;
}
`;
const USE = `import { oldName } from "./def.js";

export function use() {
  return oldName(1);
}
`;
/** 未保存的 buffer：多一行注释 ⇒ 导出声明被顶到第 2 行（1 基） */
const DEF_BUFFER = `// unsaved edit
export function oldName(n) {
  return n + 1;
}
`;


  it("definition 落在 buffer 坐标（磁盘坐标会跳错行）；references 落在 buffer 坐标；rename 的编辑落在 buffer 坐标", async () => {
  {
    h = await startLspWithFiles({ "def.js": DEF, "use.js": USE });
    h.changeBuffer("def.js", DEF_BUFFER);
    await h.waitReady("def.js");
    const defs = locationsOf(
      h.req("textDocument/definition", {
        textDocument: { uri: h.uri("use.js") },
        position: { line: 0, character: 9 }, // import { oldName }
      }),
    );
    expect(defs).toContainEqual({
      file: "def.js",
      line: 1, // buffer 里的第 2 行（0 基）
      character: 16,
      endLine: 1,
      endCharacter: 23,
    });
  }
  {
    h = await startLspWithFiles({ "def.js": DEF, "use.js": USE });
    h.changeBuffer("def.js", DEF_BUFFER);
    await h.waitReady("def.js");
    const refs = locationsOf(
      h.req("textDocument/references", {
        textDocument: { uri: h.uri("use.js") },
        position: { line: 3, character: 9 }, // oldName(1)
        context: { includeDeclaration: true },
      }),
    );
    expect(refs).toContainEqual({
      file: "def.js",
      line: 1,
      character: 16,
      endLine: 1,
      endCharacter: 23,
    });
  }
  {
    h = await startLspWithFiles({ "def.js": DEF, "use.js": USE });
    h.changeBuffer("def.js", DEF_BUFFER);
    await h.waitReady("def.js");
    const edits = editsOf(
      h.req("textDocument/rename", {
        textDocument: { uri: h.uri("use.js") },
        position: { line: 3, character: 9 },
        newName: "brandNew",
      }),
    );
    expect(edits).toContainEqual({
      file: "def.js",
      line: 1,
      character: 16,
      endLine: 1,
      endCharacter: 23,
      newText: "brandNew",
    });
  }
});



});


// ---------------------------------------------------------------------------
// 侧车补字段的插入点契约
// ---------------------------------------------------------------------------
describe("侧车补字段的插入点契约", () => {
/**
 * A6「Add 'X' to <fn> contract shape」往侧车 `fn(...)` 的**顶层**
 * 插字段 ⇒ 契约被写坏。
 *
 * 根因：`findFnContractInsertPos`（旧实现）**不解析形参表结构**，只找 `fn(`
 * 括号内**第一层**的 `{` ⇒「往某个 shape 里补字段」被执行成「往**形参表**里
 * 加一个形参」⇒ 契约多出一个不存在的形参 ⇒ 契约与源码对不上。
 *
 * 钉（插入点契约）：
 * 1. 插入点落在**目标形参对应的 `shape({ … })` 内部**（不是形参表顶层）；
 * 2. 目标形参的契约类型不是**内联** shape（共享标识符 / 标量）⇒ 不给插入点；
 * 3. 字段**已在**契约里 ⇒ 不给插入点（不写重复键）；
 * 4. LSP 面：契约已声明该字段时**不下发**「往契约 shape 补字段」的动作
 * （落盘即写坏契约 ⇒ 多一条 `nudo:contract-param-mismatch`）。
 */







const SC_NO_NAME = `import { fn, shape, number } from "@nudojs/core";

export const greet = fn({ u: shape({ id: number() }) }, string());
`;
const SC_WITH_NAME = `import { fn, shape, string } from "@nudojs/core";

export const greet = fn({ u: shape({ name: string() }) }, string());
`;
const GREET_JS = `export function greet(u) {
  return u.name + "!";
}

greet({ id: 2 });
`;


  it("插入点落进目标形参的 shape({ … }) 内部（不是形参表顶层）；字段已在契约里 ⇒ 不给插入点（不写重复键）；目标形参的契约类型不是内联 shape ⇒ 不给插入点；LSP 面：契约缺字段时，补字段动作落在 shape 内部；LSP 面：契约已声明该字段 ⇒ 不下发写坏契约的动作", () => {
  {
    const lines = SC_NO_NAME.split("\n");
    const pos = findFnContractInsertPos(lines, "greet", { param: "u", path: ["name"] });
    expect(pos).not.toBeNull();
    const line = lines[pos!.line]!;
    // 插入点前一个字符就是 **shape 的 `{`**（形参表的 `{` 在更左边）
    expect(line[pos!.character - 1]).toBe("{");
    expect(line.slice(0, pos!.character - 1)).toContain("shape(");
    // 落盘后：字段在 shape 里，形参表仍只有一个形参 u
    const applied = applyEdits(SC_NO_NAME, [
      { range: { start: pos!, end: pos! }, newText: " name: undefined, " },
    ]);
    expect(applied).toContain("u: shape({ name: undefined,  id: number() })");
    expect(applied).not.toContain("fn({ name:");
  }
  {
    expect(
      findFnContractInsertPos(SC_WITH_NAME.split("\n"), "greet", {
        param: "u",
        path: ["name"],
      }),
    ).toBeNull();
  }
  {
    const shared = `export const a = fn(sharedShape, number());\nexport const b = fn({ y: number() }, number());\n`;
    // 共享 shape 标识符
    expect(
      findFnContractInsertPos(shared.split("\n"), "a", { param: "u", path: ["name"] }),
    ).toBeNull();
    // 标量形参
    expect(
      findFnContractInsertPos(shared.split("\n"), "b", { param: "y", path: ["name"] }),
    ).toBeNull();
    // 形参不存在
    expect(
      findFnContractInsertPos(SC_NO_NAME.split("\n"), "greet", {
        param: "nope",
        path: ["name"],
      }),
    ).toBeNull();
    // 目标 fn 不存在
    expect(
      findFnContractInsertPos(SC_NO_NAME.split("\n"), "other", { param: "u", path: ["name"] }),
    ).toBeNull();
  }
  {
    withTempDir("nudo-lsp-731-", (dir) => {
      writeFileSync(join(dir, "greet.js"), GREET_JS, "utf-8");
      writeFileSync(join(dir, "greet.nudo.js"), SC_NO_NAME, "utf-8");
      const uri = `file://${join(dir, "greet.js")}`;
      const handler = mountCodeActions(uri, GREET_JS);
      const actions = handler(codeActionParams(uri, 4, [missingFieldDiag(4)]));
      const edits = sidecarEdits(actions, uri);
      expect(edits.length).toBe(1);
      const landed = applyEdits(SC_NO_NAME, edits);
      expect(landed).toContain("u: shape({ name: undefined,  id: number() })");
      // 形参表没被动过（不多出形参）
      expect(landed).not.toContain("fn({ name:");
    });
  }
  {
    withTempDir("nudo-lsp-731b-", (dir) => {
      writeFileSync(join(dir, "greet.js"), GREET_JS, "utf-8");
      writeFileSync(join(dir, "greet.nudo.js"), SC_WITH_NAME, "utf-8");
      const uri = `file://${join(dir, "greet.js")}`;
      const handler = mountCodeActions(uri, GREET_JS);
      const actions = handler(codeActionParams(uri, 4, [missingFieldDiag(4)]));
      expect(sidecarEdits(actions, uri)).toHaveLength(0);
      expect(actions.map((a) => a.title)).not.toContain(
        "Add 'name' to greet contract shape",
      );
    });
  }
});

});

// ---------------------------------------------------------------------------
// BUG-060：类方法的平铺侧车键 `K_run` 也必须有 relax quickfix
// ---------------------------------------------------------------------------
describe("BUG-060 类方法平铺侧车键的 relax quickfix", () => {
  const CLASS_JS = `export class K { run(n) { return 5; } }\n`;
  const CLASS_SC = `import { fn, number } from "@nudojs/core";

export const K_run = fn({ n: number() }, number().gt(40));
`;

  it("K.run 的返回槽违例 ⇒ 下发 Relax sidecar contract for K.run，编辑落在 K_run 声明", () => {
    withTempDir("nudo-bug060-", (dir) => {
      const jsPath = join(dir, "class.js");
      writeFileSync(jsPath, CLASS_JS, "utf-8");
      writeFileSync(join(dir, "class.nudo.js"), CLASS_SC, "utf-8");
      const uri = `file://${jsPath}`;

      const target = checkToLspDiagnostics(jsPath, CLASS_JS, defaultLoadModule).filter(
        (d) => {
          const msg = typeof d.message === "string" ? d.message : d.message.value;
          return /return value ⊭|number\(\)\.gt\(40\)/.test(msg);
        },
      );
      expect(target).toHaveLength(1);

      const handler = mountCodeActions(uri, CLASS_JS);
      const actions = handler(codeActionParams(uri, target[0]!.range.start.line, [target[0]!]));
      const relax = actions.filter((a) => /Relax sidecar contract/i.test(a.title));
      expect(relax).toHaveLength(1);
      expect(relax[0]!.title).toBe("Relax sidecar contract for K.run");

      const edits = sidecarEdits(relax, uri);
      expect(edits).toHaveLength(1);
      expect(edits[0]!.newText).toContain(
        "export const K_run = fn({ n: number() }, number())",
      );
      expect(edits[0]!.newText).not.toContain("number().gt(40)");
      // 落盘后的侧车 = 编辑集本身（不是空转的 diff）
      expect(applyEdits(CLASS_SC, edits)).toBe(edits[0]!.newText);
    });
  });
});
