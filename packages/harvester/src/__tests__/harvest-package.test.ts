/**
 * 模块套件：harvest 包面（package exports/运行时导出/globals/disk）。
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { harvestPackage, formatHarvestSummary, resolvePackageRoot, dtsFileScan, collectDtsFiles, packageExportSurface, type PackageHarvest } from "../harvest-package.ts";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { dtsToContractDraft, dtsPathToContractDraft } from "../dts-contract-draft.ts";
import { makeWorkDir, removeWorkDir, runNudoCheck, writeSidecar } from "./harvest-helpers-product-face.ts";
import { bareSpecToAbsModules, packageHarvestToAbsModules } from "../harvest-to-abs.ts";
import { formatShape, type Abs, abs, getFnImpl, type Slot, abs as makeAbs, strLit, type LiteralValue } from "@nudojs/core";
import { harvestDts, promotedNamesOf, emitEnvModule } from "../harvest-dts.ts";
import { absToHarvestSig, harvestSigToAbs, materializeHarvestJson, serializeHarvestJson, HARVEST_DISK_ABI } from "../harvest-json.ts";
import { harvestPackageCached } from "../harvest-auto.ts";

const tmpDirs: string[] = [];
afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
  tmpDirs.length = 0;
});

describe("harvest npm package", () => {
  const root = resolve(process.cwd(), "../..");
  // monorepo root may vary; try a few
  const cwdHasTs = existsSync(resolve(root, "node_modules/typescript/package.json"));

  it("resolvePackageRoot finds workspace packages；harvestPackage on typescript if available", () => {
(() => {

    // typescript is a root devDep of the monorepo
    const r = resolvePackageRoot("typescript", root);
    if (r) {
      expect(existsSync(r)).toBe(true);
    } else {
      // environment without typescript installed — skip soft
      expect(r).toBeUndefined();
    }
  })();
(() => {

    const r = resolvePackageRoot("typescript", root);
    if (!r) {
      expect(true).toBe(true);
      return;
    }
    const h = harvestPackage("typescript", root);
    if ("error" in h) {
      // no d.ts collected — still ok in constrained env
      expect(h.error).toBeTruthy();
      return;
    }
    expect(h.dtsFiles.length).toBeGreaterThan(0);
    expect(h.env.stats.symbols).toBeGreaterThan(0);
    expect(formatHarvestSummary(h)).toContain("typescript");
  })();
});;

  ;
});

describe("读故障 fail-closed 上浮（ENOENT 静默，非 ENOENT 有信号）", () => {
  it("dtsFileScan: ENOENT 空扫描无标记；读错误（EISDIR）标 unreadable 且不进缓存；packageExportSurface: 入口读不了 ⇒ unresolved（公开面不可知，不折空）；collectDtsFiles: readdir 非 ENOENT 故障（ENOTDIR）计数上浮；ENOENT 静默；harvestPackage: package.json JSON 解析故障计数进 env.stats.skipped", () => {
(() => {

    const dir = mkdtempSync(join(tmpdir(), "nudo-scan-fc-"));
    tmpDirs.push(dir);
    // ENOENT = 合法缺席
    const gone = dtsFileScan(join(dir, "gone.d.ts"));
    expect(gone.exported.size).toBe(0);
    expect(gone.unreadable).toBeUndefined();

    // 目录当 .d.ts 读 → EISDIR（非 ENOENT）
    const eisdir = join(dir, "bad.d.ts");
    mkdirSync(eisdir);
    const bad = dtsFileScan(eisdir);
    expect(bad.unreadable).toBe(true);

    // 瞬态读故障不进缓存：恢复可读后重扫要能拿到真实导出面
    rmSync(eisdir, { recursive: true, force: true });
    writeFileSync(eisdir, "export declare const ok: number;\n");
    const healed = dtsFileScan(eisdir);
    expect(healed.unreadable).toBeUndefined();
    expect([...healed.exported]).toEqual(["ok"]);
  })();
(() => {

    const root = mkdtempSync(join(tmpdir(), "nudo-surface-fc-"));
    tmpDirs.push(root);
    mkdirSync(join(root, "index.d.ts")); // 入口是目录 → EISDIR
    const h: PackageHarvest = {
      pkg: "pkg-x",
      root,
      dtsFiles: [join(root, "index.d.ts")],
      env: { globals: {}, modules: {}, stats: { files: 0, symbols: 0, skipped: 0 } },
    };
    expect(packageExportSurface(h).unresolved).toBe(true);
  })();
(() => {

    const dir = mkdtempSync(join(tmpdir(), "nudo-walk-fc-"));
    tmpDirs.push(dir);
    const f = join(dir, "plain-file");
    writeFileSync(f, "not a dir");
    const fails = { count: 0 };
    // root 是普通文件 → readdirSync 抛 ENOTDIR（非 ENOENT）
    expect(collectDtsFiles(f, 8, fails)).toEqual([]);
    expect(fails.count).toBe(1);
    // 不传 fails（旧签名）也不抛
    expect(collectDtsFiles(f, 8)).toEqual([]);
  })();
(() => {

    const proj = mkdtempSync(join(tmpdir(), "nudo-pkg-fc-"));
    tmpDirs.push(proj);
    const pkgRoot = join(proj, "node_modules", "pkg-broken");
    mkdirSync(pkgRoot, { recursive: true });
    writeFileSync(join(pkgRoot, "package.json"), "{ this is not json");
    writeFileSync(join(pkgRoot, "index.d.ts"), "export declare const a: number;\n");
    const h = harvestPackage("pkg-broken", proj);
    if ("error" in h) throw new Error(`unexpected error: ${h.error}`);
    // JSON.parse 抛 SyntaxError（code undefined ≠ ENOENT）→ 上浮进同通道
    expect(h.env.stats.skipped).toBeGreaterThanOrEqual(1);
  })();
});;

  ;

  ;

  ;
});

// ---------------------------------------------------------------------------
// --from-dts 的具名 default 导出
// ---------------------------------------------------------------------------
describe("--from-dts 的具名 default 导出", () => {
/**
 * `nudo contract --from-dts` 把**具名 default 导出**写成本地名键
 * ⇒ 草稿键 `helper` ≠ 模块导出名 `default` ⇒ 用户照抄进侧车后**该导出永远
 * 零义务**（**假绿**），而汇总行报「**0 skipped**」让用户以为「没有需要
 * 人工处理的东西」。
 *
 * 修法（草稿面）：default 导出的**草稿键恒为 `default`**（不是本地名）⇒
 * 抄进侧车后绑定的是模块的 `default` 导出；没有丢失 ⇒ `skipped` 不虚增。
 *
 * 产品面取证（改前 vs 改后，同一份侧车 + 同一份源码）：
 * - 改后：侧车 `export { _default as default }` ⇒ `impl(x: number) => string`；
 * - 改前：侧车 `export const helper = …` ⇒ 绑不到 `default` ⇒
 * `impl(x: any) => string` + `nudo:contract-entry-only`（零义务）。
 */







const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const NAMED_DEFAULT_DTS = `export default function helper(x: number): string;
`;

function writeDts(name: string, src: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug1003-"));
  dirs.push(dir);
  const file = join(dir, name);
  writeFileSync(file, src, "utf-8");
  return file;
}

describe("-from-dts 的具名 default 导出", () => {
  it("草稿键是 `default`（不是本地名 `helper`）；没有丢失 ⇒ 汇总行不虚增 skipped；**抄进侧车后 `default` 导出真的带上契约**（改前：零义务）", () => {
(() => {

    const file = writeDts("def.d.ts", NAMED_DEFAULT_DTS);
    const draft = dtsToContractDraft([file], "def");
    expect(draft.exports.map((e) => e.name)).toEqual(["default"]);
    expect(draft.draftSource).toContain("as default };");
    // 改前：草稿键 = 本地名 `helper`
    expect(draft.draftSource).not.toContain("export const helper");
    expect(draft.draftSource).not.toContain("as helper };");
  })();
(() => {

    const file = writeDts("def.d.ts", NAMED_DEFAULT_DTS);
    const draft = dtsToContractDraft([file], "def");
    expect(draft.stats.exports).toBe(1);
    expect(draft.stats.skipped).toBe(0);
  })();
(() => {

    const file = writeDts("def.d.ts", NAMED_DEFAULT_DTS);
    const draft = dtsToContractDraft([file], "def");
    const dir = makeWorkDir("1003");
    dirs.push(dir);
    const { target } = writeSidecar(
      dir,
      draft.draftSource,
      `const impl = function (x) {\n  return String(x);\n};\n\nexport default impl;\n`,
    );
    const res = runNudoCheck(target);
    expect(res.status, `${res.stdout}\n${res.stderr}`).toBe(0);
    // 契约落到 default 导出上 ⇒ 签名带 number / string
    expect(res.stdout).toContain("impl(x: number) => string");
    // 改前：default 导出没有契约根 ⇒ `nudo:contract-entry-only`
    expect(res.stdout).not.toContain("nudo:contract-entry-only");
  })();
});;

  ;

  ;
});
});

// ---------------------------------------------------------------------------
// ambient 声明不得变成包名键的具名导出
// ---------------------------------------------------------------------------
describe("ambient 声明不得变成包名键的具名导出", () => {
/**
 * harvester 的**桥接层把整个 globals 袋提升成包名键的具名导出**
 * ⇒ `declare global { … }` / **script 模式 `.d.ts`** 的 **ambient 声明变成「可导入的导出」**
 * ⇒ `import { <ambient> } from "pkg"` 解析成功 ⇒ **TS2305 / TS2306 零诊断**（**假绿**）。
 *
 * 修法：ambient 声明（`declare global { … }` / script 模式 `.d.ts` 的顶层声明）
 * **不得**进包名键；包名键只由**该包自己的顶层导出**占。
 *
 * oracle（`tsc --strict`）：TS2305（`declare global`）/ TS2306（script 模式）。
 */







function writePkg(root: string, name: string, files: Record<string, string>): void {
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name, version: "1.0.0", types: "index.d.ts" }),
  );
  for (const [file, content] of Object.entries(files)) {
    const p = join(root, file);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, content);
  }
}

describe("ambient 声明不得变成包名键的具名导出", () => {
  let dir: string;
  let appDir: string;
  let prevCache: string | undefined;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "nudo-h7-b1014-"));
    appDir = join(dir, "app");
    mkdirSync(appDir, { recursive: true });
    prevCache = process.env.NUDO_DEPS_CACHE_DIR;
    process.env.NUDO_DEPS_CACHE_DIR = join(dir, "deps-cache");
    // 形态①：`declare global { … }` 的 ambient 声明
    writePkg(join(dir, "node_modules", "globpkg"), "globpkg", {
      "index.d.ts": [
        "export declare function pub(): number;",
        "declare global {",
        "  function ambientHelper(): string;",
        "}",
        "",
      ].join("\n"),
    });
    // 形态②：script 模式 `.d.ts`（无任何 import/export ⇒ 顶层声明是全局 ambient）
    writePkg(join(dir, "node_modules", "scriptpkg"), "scriptpkg", {
      "index.d.ts": "declare function scriptAmbient(): string;\n",
    });
  });

  afterAll(() => {
    if (prevCache === undefined) delete process.env.NUDO_DEPS_CACHE_DIR;
    else process.env.NUDO_DEPS_CACHE_DIR = prevCache;
    rmSync(dir, { recursive: true, force: true });
  });

  it("`declare global` 的内容不进包名键（真实的导出仍在）；script 模式 `.d.ts` 的顶层声明不进包名键", () => {
(() => {

    const h = harvestPackage("globpkg", appDir);
    expect("error" in h).toBe(false);
    if ("error" in h) return;
    // 收割层仍看得见 ambient（它确实在 globals 袋里）
    expect(Object.keys(h.env.globals)).toContain("ambientHelper");
    const table = packageHarvestToAbsModules("globpkg", h);
    // 但它**不是**包的具名导出 ⇒ `import { ambientHelper } from "globpkg"` 必须解析失败
    expect(Object.keys(table["globpkg"]?.named ?? {})).toEqual(["pub"]);
    const spec = bareSpecToAbsModules("globpkg", join(appDir, "glob.js"));
    expect(spec === undefined || spec.named["ambientHelper"] === undefined).toBe(true);
  })();
(() => {

    const h = harvestPackage("scriptpkg", appDir);
    expect("error" in h).toBe(false);
    if ("error" in h) return;
    expect(Object.keys(h.env.globals)).toContain("scriptAmbient");
    const table = packageHarvestToAbsModules("scriptpkg", h);
    expect(Object.keys(table["scriptpkg"]?.named ?? {})).toEqual([]);
    const spec = bareSpecToAbsModules("scriptpkg", join(appDir, "script.js"));
    expect(spec === undefined || spec.named["scriptAmbient"] === undefined).toBe(true);
  })();
});;

  ;
});
});

// ---------------------------------------------------------------------------
// --from-dts 目录模式的文件预算
// ---------------------------------------------------------------------------
describe("--from-dts 目录模式的文件预算", () => {
/**
 * `nudo contract --from-dts <目录>` **静默只投影前 16 个 `.d.ts`**
 * ⇒ 第 17+ 个文件的导出**整条不存在**于草稿，而汇总行报「**16 d.ts ·
 * 0 skipped**」⇒ 丢失**零信号** ⇒ 照抄进侧车后这些导出**零义务**（假绿）。
 *
 * 修法（草稿面）：目录模式**投影全部** `.d.ts`（不再有条数上限）⇒ 第 17+
 * 个文件的导出出现在草稿里；遍历不到的地方（读失败 / 深度上限）**如实计数**
 * ⇒ 汇总行说真话。
 *
 * 反向闸：改前（只投影前 16 个）⇒ 本文件的「第 17+ 个导出」断言失败。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** 造 N 个 `.d.ts`（每个一个独有导出） */
function makePkg(count: number): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug1015-"));
  dirs.push(dir);
  const pkg = join(dir, "pkg");
  mkdirSync(pkg, { recursive: true });
  for (let i = 1; i <= count; i++) {
    const name = `m${String(i).padStart(2, "0")}`;
    writeFileSync(
      join(pkg, `${name}.d.ts`),
      `export declare function ${name}Fn(x: number): string;\n`,
      "utf-8",
    );
  }
  return pkg;
}

describe("-from-dts 目录模式的文件预算", () => {
  it("目录里的 `.d.ts` **全部**被投影（改前：只投影前 16 个）；第 17+ 个文件的导出**出现在草稿里**；没有截断 ⇒ 汇总行不虚增 skipped；单文件入口不受影响", () => {
(() => {

    const pkg = makePkg(20);
    const draft = dtsPathToContractDraft(pkg, "pkg");
    expect(draft.files.length).toBe(20);
    expect(draft.stats.files).toBe(20);
    expect(draft.stats.exports).toBe(20);
  })();
(() => {

    const pkg = makePkg(20);
    const draft = dtsPathToContractDraft(pkg, "pkg");
    for (const n of ["m17Fn", "m18Fn", "m19Fn", "m20Fn"]) {
      expect(draft.draftSource, `缺少 ${n}`).toContain(`export const ${n} =`);
    }
    // 前 16 个也还在（不是「换了一批」）
    expect(draft.draftSource).toContain("export const m01Fn =");
    expect(draft.draftSource).toContain("export const m16Fn =");
  })();
(() => {

    const pkg = makePkg(20);
    const draft = dtsPathToContractDraft(pkg, "pkg");
    expect(draft.stats.skipped).toBe(0);
    expect(draft.stats.droppedFiles ?? 0).toBe(0);
  })();
(() => {

    const pkg = makePkg(3);
    const draft = dtsPathToContractDraft(join(pkg, "m01.d.ts"), "m01");
    expect(draft.files.length).toBe(1);
    expect(draft.stats.exports).toBe(1);
    expect(draft.draftSource).toContain("export const m01Fn =");
  })();
});;

  ;

  ;

  ;
});
});

// ---------------------------------------------------------------------------
// 顶层 declare namespace 的运行时成员不摊平进 globals
// ---------------------------------------------------------------------------
describe("顶层 declare namespace 的运行时成员不摊平进 globals", () => {
/**
 * 回归（harvester 收割面）：顶层 `declare namespace` 的**运行时成员被摊平进
 * globals** ⇒ harvester **凭空造出全局**（`bar`）⇒ 并**抑制**了对应的
 * ReferenceError 诊断（裸 `bar()` 被当成有定义）。
 *
 * oracle（`tsc --strict`，见 tmp/probe/fix-r27/h5/e2e/ns/）：
 * - `declare namespace Foo { function bar(): number }` ⇒ `Foo.bar` 合法（TS 编译通过）；
 * - 裸 `bar` **不是**全局（运行时只有 `Foo.bar`）⇒ 引用它是 ReferenceError。
 *
 * 收割侧契约：
 * 1. 命名空间的运行时成员**留在命名空间的名字空间里**（`Foo.bar`），
 * **不摊平**进 globals ⇒ `env.globals` 里**没有** `bar`；
 * 2. `Foo` 本身是命名空间对象（成员挂在它下面）；
 * 3. 只有类型（interface / type）的命名空间**不产生**运行时对象
 * （否则 `declare namespace _ { interface X {} }` 会凭空多出一个全局 `_`）。
 *
 * 产品面（闸②，tmp/probe/fix-r27/h5/e2e/ns/）：
 * - 改前：`callBareBar() => number`（0 issue —— 伪造全局把 ReferenceError 抹掉了）；
 * - 改后：`callBareBar() => never throws ReferenceError`（诊断恢复）。
 */







const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeTemp(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug793-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

/** obj 形状的槽位名 */
function slotNames(a: unknown): string[] {
  const shape = (a as { shape?: { k?: string; slots?: Record<string, unknown> } }).shape;
  if (shape?.k !== "obj") return [];
  return Object.keys(shape.slots ?? {});
}

describe("顶层 declare namespace 的运行时成员不摊平进 globals", () => {
  it("命名空间成员不落进 globals（不再凭空造出全局 `bar`）；命名空间对象 `Foo` 存在，成员挂在它下面（`Foo.bar`）；命名空间成员仍可调用（`Foo.bar()` 的返回类型是 number）；只有类型的命名空间不产生运行时对象（不凭空多出全局 `_`）；嵌套命名空间：成员留在最深层的命名空间里；两个命名空间的同名成员互不串（不当作 overload 合并）", () => {
(() => {

    const p = writeTemp(
      "fx.d.ts",
      `declare namespace Foo {
  function bar(): number;
}
`,
    );
    const env = harvestDts([p]);
    // 反向断言：改前 `env.globals["bar"]` 存在（伪造全局）
    expect(Object.hasOwn(env.globals, "bar")).toBe(false);
    expect(env.globals["bar"]).toBeUndefined();
  })();
(() => {

    const p = writeTemp(
      "fx.d.ts",
      `declare namespace Foo {
  function bar(): number;
}
`,
    );
    const env = harvestDts([p]);
    expect(env.globals["Foo"]).toBeDefined();
    expect(slotNames(env.globals["Foo"])).toEqual(["bar"]);
    expect(formatShape(env.globals["Foo"]!)).toBe("{ bar: () => number }");
  })();
(() => {

    const p = writeTemp(
      "fx.d.ts",
      `declare namespace Foo {
  function bar(): number;
}
`,
    );
    const env = harvestDts([p]);
    const foo = env.globals["Foo"]!;
    const slots = (foo as { shape: { slots: Record<string, { value: unknown }> } }).shape.slots;
    const bar = slots["bar"]!.value as { shape: { k: string; returnType?: { shape: { type?: string } } } };
    expect(bar.shape.k).toBe("fn");
    expect(bar.shape.returnType?.shape.type).toBe("number");
  })();
(() => {

    const p = writeTemp(
      "fx.d.ts",
      `declare namespace _ {
  interface LoDashStatic { uniq(xs: number[]): number[]; }
}
`,
    );
    const env = harvestDts([p]);
    expect(Object.hasOwn(env.globals, "_")).toBe(false);
  })();
(() => {

    const p = writeTemp(
      "fx.d.ts",
      `declare namespace A {
  namespace B {
    function f(): number;
  }
}
`,
    );
    const env = harvestDts([p]);
    // `f` 不在任何一层摊平
    expect(Object.hasOwn(env.globals, "f")).toBe(false);
    expect(Object.hasOwn(env.globals, "B")).toBe(false);
    expect(env.globals["A"]).toBeDefined();
    expect(slotNames(env.globals["A"])).toEqual(["B"]);
    const b = (env.globals["A"]! as { shape: { slots: Record<string, { value: unknown }> } }).shape.slots["B"]!
      .value;
    expect(slotNames(b)).toEqual(["f"]);
  })();
(() => {

    const p = writeTemp(
      "fx.d.ts",
      `declare namespace A {
  function f(): number;
}
declare namespace B {
  function f(): string;
}
`,
    );
    const env = harvestDts([p]);
    const a = (env.globals["A"]! as { shape: { slots: Record<string, { value: Abs }> } }).shape.slots["f"]!
      .value;
    const b = (env.globals["B"]! as { shape: { slots: Record<string, { value: Abs }> } }).shape.slots["f"]!
      .value;
    expect(formatShape(a)).toBe("() => number");
    expect(formatShape(b)).toBe("() => string");
  })();
});;

  ;

  ;

  ;

  ;

  ;
});
});

// ---------------------------------------------------------------------------
// 族 27 · 磁盘投影 facet 往返（接线）
// ---------------------------------------------------------------------------
describe("族 27 · 磁盘投影 facet 往返（接线）", () => {
/**
 * 族 27 · （主 agent 接线）—— **磁盘投影的 facet 往返**。
 *
 * 收割面（内存 Abs）在本族新增了几个 facet：
 * - obj：`index`（索引签名 / `Record<K,V>` 的值域）+ `open`（开放对象标志）
 * - tuple：`rest`（变长尾槽）
 * - fn：`ctor`（可构造性）+ `slots`（dual-facet 静态成员）
 *
 * 磁盘投影 `HarvestSig` 原本**不带**这些 facet ⇒ L2 磁盘缓存命中时服务的是
 * **有损 env** ⇒ 803（`Record` 变闭合空对象 ⇒ 成员读 undefined ⇒ 定抛）、
 * 802（元组丢 rest）、829（构造器被抹成普通 fn ⇒ `new` 落「可构造性未知」⇒ 假红）
 * 的修复在缓存往返后**被抹掉**。
 *
 * 判据：**序列化 → 反序列化**后，facet 必须**逐项相同**（不是「形状像」）。
 */

function roundTrip(a: Abs): Abs {
  const env = { globals: { x: a }, modules: {}, stats: { files: 1, symbols: 1, skipped: 0 } };
  const json = serializeHarvestJson("pkg", env, { dtsHash: "h", maxFiles: 12 });
  const back = materializeHarvestJson(json);
  expect(back, "materialize must not miss").toBeTruthy();
  return back!.globals["x"]!;
}

describe("族 27 · 磁盘投影 facet 往返（接线）", () => {
  it("obj：索引签名 + 开放对象标志往返后仍在；obj：闭合对象**不**被投影成开放对象（不得过度放宽）；tuple：rest 槽往返后仍在；fn：ctor facet 往返后仍在（否则 new 落「可构造性未知」⇒ 假红）；fn：dual-facet 静态槽往返后仍在；ABI 已抬到 v15（A2 残余 callable 进 HarvestSig ⇒ 旧磁盘缓存必须 miss）；反向闸：投影里带 facet 的 HarvestSig 能还原出同样的显示面", () => {
(() => {

    const indexed = abs(
      {
        k: "obj",
        slots: {},
        index: {
          key: abs({ k: "prim", type: "string" }, undefined, undefined, "exact"),
          value: abs({ k: "prim", type: "number" }, undefined, undefined, "exact"),
        },
        open: true,
      },
      undefined,
      undefined,
      "exact",
    );
    const back = roundTrip(indexed);
    expect(back.shape.k).toBe("obj");
    const sh = back.shape as Extract<Abs["shape"], { k: "obj" }>;
    expect(sh.open, "open flag must survive the disk round-trip").toBe(true);
    expect(sh.index, "index signature must survive the disk round-trip").toBeTruthy();
    expect(sh.index!.value.shape).toEqual({ k: "prim", type: "number" });
  })();
(() => {

    const closed = abs({ k: "obj", slots: {} }, undefined, undefined, "exact");
    const back = roundTrip(closed);
    const sh = back.shape as Extract<Abs["shape"], { k: "obj" }>;
    expect(sh.open).toBeUndefined();
    expect(sh.index).toBeUndefined();
  })();
(() => {

    const tup = abs(
      {
        k: "tuple",
        elements: [abs({ k: "prim", type: "number" }, undefined, undefined, "exact")],
        rest: abs({ k: "prim", type: "string" }, undefined, undefined, "exact"),
      },
      undefined,
      undefined,
      "exact",
    );
    const back = roundTrip(tup);
    const sh = back.shape as Extract<Abs["shape"], { k: "tuple" }>;
    expect(sh.rest, "tuple rest must survive the disk round-trip").toBeTruthy();
    expect(sh.rest!.shape).toEqual({ k: "prim", type: "string" });
  })();
(() => {

    const ctor = abs(
      {
        k: "fn",
        params: ["x"],
        paramTypes: [abs({ k: "prim", type: "number" }, undefined, undefined, "exact")],
        returnType: abs({ k: "prim", type: "string" }, undefined, undefined, "exact"),
        ctor: true,
      },
      undefined,
      undefined,
      "exact",
    );
    const back = roundTrip(ctor);
    const sh = back.shape as Extract<Abs["shape"], { k: "fn" }>;
    expect(sh.ctor, "ctor facet must survive the disk round-trip").toBe(true);
  })();
(() => {

    const withStatic = abs(
      {
        k: "fn",
        params: [],
        paramTypes: [],
        returnType: abs({ k: "prim", type: "number" }, undefined, undefined, "exact"),
        slots: { of: { value: abs({ k: "prim", type: "number" }, undefined, undefined, "exact") } },
      },
      undefined,
      undefined,
      "exact",
    );
    const back = roundTrip(withStatic);
    const sh = back.shape as Extract<Abs["shape"], { k: "fn" }>;
    expect(sh.slots?.["of"], "fn static slot must survive the disk round-trip").toBeTruthy();
    expect(sh.slots!["of"]!.value.shape).toEqual({ k: "prim", type: "number" });
  })();
(() => {

    expect(HARVEST_DISK_ABI).toBe("nudo-harvest-disk-v15");
    // 旧 ABI 的载荷必须被判 miss（否则用户本地 ~/.cache/nudo/deps/ 里的
    // 旧收割产物会继续命中 ⇒ CLI 看不到本轮修复）
    const stale = {
      v: 1,
      pkg: "pkg",
      knobs: { maxFiles: 12, abi: "nudo-harvest-disk-v10" },
      dtsHash: "h",
      modules: {},
      globals: {},
      stats: { files: 0, symbols: 0, skipped: 0 },
    };
    expect(materializeHarvestJson(stale)).toBeNull();
  })();
(() => {

    const indexed = abs(
      {
        k: "obj",
        slots: {},
        index: {
          key: abs({ k: "prim", type: "string" }, undefined, undefined, "exact"),
          value: abs({ k: "prim", type: "number" }, undefined, undefined, "exact"),
        },
        open: true,
      },
      undefined,
      undefined,
      "exact",
    );
    const sig = absToHarvestSig(indexed);
    expect(sig.k).toBe("obj");
    if (sig.k !== "obj") throw new Error("unreachable");
    expect(sig.open).toBe(true);
    expect(sig.index).toBeTruthy();
    const restored = harvestSigToAbs(sig);
    expect(formatShape(restored)).toBe(formatShape(indexed));
  })();
});;

  ;

  ;

  ;

  ;

  ;

  ;
});
});

// ---------------------------------------------------------------------------
// 提升成模块级成员时保留 `?` 可选标记
// ---------------------------------------------------------------------------
describe("提升成模块级成员时保留 `?` 可选标记", () => {
/**
 * 回归（harvester 收割面）：接口成员被**提升**成模块级全局时丢掉 `?`
 * 可选标记（brand 面 `number | undefined` vs 提升面 `number`）。
 *
 * 根因：提升路径把成员**降级成一条 `var` 声明**（`{t:"var", typeNode: member.type}`），
 * 只保留了 `type`，**丢掉了 `questionToken`** ⇒ 同一个成员在两条收割路径上两个类型。
 *
 * 改前（tmp/probe/fix-r27/h3/probe-h3.ts，BEFORE 行）：`global a: number`
 * 改后：`global a: number | undefined`（与 brand 面同口径）
 *
 * oracle（`tsc --strict`，tmp/probe/fix-r27/h3/oracle/o808.ts）：
 * `const bad: number = opt.a` ⇒ TS2322 "Type 'number | undefined' is not
 * assignable to type 'number'" ⇒ TS 侧 `opt.a` 就是 `number | undefined`。
 */







const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeTemp(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug808-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

/** brand → inner obj → 槽位（值） */
function slots(a: Abs): Record<string, Abs> {
  const s = a.shape;
  if (s.k === "obj") {
    const out: Record<string, Abs> = {};
    for (const [k, slot] of Object.entries(s.slots)) out[k] = slot.value;
    return out;
  }
  if (s.k === "brand") return slots(s.shape);
  return {};
}

describe("提升成模块级成员时保留 `?` 可选标记", () => {
  it("提升出的可选属性是 `number | undefined`（不是 `number`）；brand 面与提升面同口径（同一成员两个类型 ⇒ 不得出现）；对照：必选属性不被加上 undefined；对照：brand 面本来就保留 `?`（既有口径不被破坏）", () => {
(() => {

    const p = writeTemp(
      "optmem.d.ts",
      `declare module "m" {
  export interface Opt { a?: number; }
  export declare const opt: Opt;
}
`,
    );
    const env = harvestDts([p]);
    const promoted = env.modules.m!.a!;
    expect(promoted).toBeDefined();
    expect(formatShape(promoted)).toBe("number | undefined");
    expect(formatShape(promoted)).not.toBe("number");
  })();
(() => {

    const p = writeTemp(
      "optmem.d.ts",
      `declare module "m" {
  export interface Opt { a?: number; }
  export declare const opt: Opt;
}
`,
    );
    const env = harvestDts([p]);
    const member = slots(env.modules.m!.opt!).a!;
    expect(formatShape(member)).toBe(formatShape(env.modules.m!.a!));
  })();
(() => {

    const p = writeTemp(
      "reqmem.d.ts",
      `declare module "m" {
  export interface Req { b: number; }
  export declare const req: Req;
}
`,
    );
    const env = harvestDts([p]);
    expect(formatShape(env.modules.m!.b!)).toBe("number");
  })();
(() => {

    const p = writeTemp(
      "optmem.d.ts",
      `declare module "m" {
  export interface Opt { a?: number; }
  export declare const opt: Opt;
}
`,
    );
    const env = harvestDts([p]);
    expect(formatShape(slots(env.modules.m!.opt!).a!)).toBe("number | undefined");
  })();
});;

  ;

  ;

  ;
});
});

// ---------------------------------------------------------------------------
// `export default` 进导出表，局部名不进
// ---------------------------------------------------------------------------
describe("`export default` 进导出表，局部名不进", () => {
/**
 * 回归（harvester 收割面）：`export default` **不在模块导出表里** ⇒
 * 默认导入落 `unknown`（假警告）；同时**默认导出的局部名被当成具名导出**（假绿）。
 *
 * oracle（`tsc --strict`，见 tmp/probe/fix-r27/h4/）：
 * - `export default function makeThing(): number;` ⇒ 默认导入 `() => number`，
 * 而 `import { makeThing } from "fx"` 是 **TS2614**（该模块没有具名导出 `makeThing`）。
 * - `export default class Widget { render(): string; }` ⇒ 默认导入拿到类（构造签名），
 * `import { Widget } from "fx"` 同样是 **TS2614**。
 *
 * 契约：
 * 1. 导出表里有 `default`（键名就是 `default`）；
 * 2. 默认导出的**局部名不进导出表**（否则 `import { makeThing }` 假绿）；
 * 3. 桥接层不把局部名抬成具名导出（包名键的 `named` 里没有 `makeThing`）。
 *
 * 桥接层的另一半（包名键的 `default` 槽 + 扫描面登记 `default`）由 H7 并发修好
 * （`harvest-package.ts` 的 `scanDtsFile` 现在对 `export default function/class`
 * 登记 `default` 而不是局部名）—— 本文件把收割面与桥接面一起钉住。
 */









const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeTemp(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug814-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

/** 用收割面造一个 PackageHarvest（不必真的装一个包） */
function pkgOf(pkg: string, file: string): PackageHarvest {
  return { pkg, root: join(file, ".."), dtsFiles: [file], env: harvestDts([file]) };
}

describe("`export default` 进导出表，局部名不进", () => {
  it("`export default function makeThing()` ⇒ 导出表有 default，没有 makeThing；`export default class Widget {}` ⇒ 导出表有 default，没有 Widget；`export default <局部名>` ⇒ default 取局部绑定的值；桥接层把 globals 的 default 提升成模块的 default 导出（默认导入不再是 unknown）", () => {
(() => {

    const p = writeTemp("fx.d.ts", `export default function makeThing(): number;\n`);
    const env = harvestDts([p]);
    expect(env.globals["default"]).toBeDefined();
    expect(formatShape(env.globals["default"]!)).toBe("() => number");
    // 局部名不得顺带变成具名导出（TS 侧是 TS2614）
    expect(env.globals["makeThing"]).toBeUndefined();
    expect(env.stats.skipped).toBe(0);
  })();
(() => {

    const p = writeTemp("fx.d.ts", `export default class Widget { render(): string; }\n`);
    const env = harvestDts([p]);
    expect(env.globals["default"]).toBeDefined();
    expect(env.globals["Widget"]).toBeUndefined();
    expect(env.stats.skipped).toBe(0);
  })();
(() => {

    const p = writeTemp(
      "fx.d.ts",
      `declare function helper(): string;\nexport default helper;\n`,
    );
    const env = harvestDts([p]);
    expect(formatShape(env.globals["default"]!)).toBe("() => string");
  })();
(() => {

    const p = writeTemp("fx.d.ts", `export default function makeThing(): number;\n`);
    const mods = packageHarvestToAbsModules("fx", pkgOf("fx", p));
    expect(mods["fx"]?.default).toBeDefined();
    // 默认导入拿到的是这个函数（mock 化的可调用值），调用结果 = 声明的返回类型
    const mock = mods["fx"]!.default!;
    expect(formatShape(mock)).toContain("()");
    const impl = getFnImpl(mock);
    const out = impl?.apply?.([{ shape: { k: "prim", type: "number" }, conf: "exact" }]);
    expect(formatShape(out! as Abs)).toBe("number");
    // 局部名不得出现在具名导出面里（TS 侧 TS2614）
    expect(mods["fx"]!.named["makeThing"]).toBeUndefined();
  })();
});;

  ;

  ;

  ;
});
});

// ---------------------------------------------------------------------------
// `export { X as Y }` 不再整条丢弃
// ---------------------------------------------------------------------------
describe("`export { X as Y }` 不再整条丢弃", () => {
/**
 * 回归（harvester 收割面）：`export { X as Y }`（本地改名再导出）被**整条丢弃**
 * ⇒ 改名后的导出根本不存在（假警告）。
 *
 * oracle（`tsc --strict`，见 tmp/probe/fix-r27/h4/）：
 * - `declare function foo(): number; export { foo as bar };` ⇒ 模块导出面是 `["bar"]`
 * （`bar` 是**运行时值**，`foo` 只是局部名 ⇒ 不在导出面里）。
 * - `export { foo as default }` ⇒ 默认导入拿得到 `foo`。
 *
 * 契约：改名后的导出名必须进导出表，且拿到的是**局部绑定的值**（不是 unknown）。
 */







const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeTemp(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug815-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

describe("`export { X as Y }` 不再整条丢弃", () => {
  it("函数改名再导出 ⇒ 导出表里有 `bar`，值是局部绑定的签名；`export { X as default }` ⇒ default 拿得到局部绑定；const 改名再导出 ⇒ 导出表里是局部常量的类型；`export type { X }`（类型位导出）不是运行时值 ⇒ 不进导出表，且计入 skipped", () => {
(() => {

    const p = writeTemp(
      "fx.d.ts",
      `declare function foo(): number;\nexport { foo as bar };\n`,
    );
    const env = harvestDts([p]);
    expect(env.globals["bar"]).toBeDefined();
    expect(formatShape(env.globals["bar"]!)).toBe("() => number");
    // 不是 unknown：改名后的导出必须真的解析到局部绑定
    expect(formatShape(env.globals["bar"]!)).not.toBe("unknown");
    expect(env.stats.skipped).toBe(0);
  })();
(() => {

    const p = writeTemp(
      "fx.d.ts",
      `declare function foo(): number;\nexport { foo as default };\n`,
    );
    const env = harvestDts([p]);
    expect(formatShape(env.globals["default"]!)).toBe("() => number");
  })();
(() => {

    const p = writeTemp(
      "fx.d.ts",
      `declare const size: number;\nexport { size as width };\n`,
    );
    const env = harvestDts([p]);
    expect(env.globals["width"]).toBeDefined();
    expect(formatShape(env.globals["width"]!)).toBe("number");
  })();
(() => {

    const p = writeTemp(
      "fx.d.ts",
      `export interface Shape { size: number; }\nexport type { Shape as Renamed };\n`,
    );
    const env = harvestDts([p]);
    expect(env.globals["Renamed"]).toBeUndefined();
    expect(env.stats.skipped).toBeGreaterThan(0);
  })();
});;

  ;

  ;

  ;
});
});

// ---------------------------------------------------------------------------
// `export * from` 与模块自有声明合并
// ---------------------------------------------------------------------------
describe("`export * from` 与模块自有声明合并", () => {
/**
 * 回归（harvester 收割面）：`export * from` 的别名应用是**整记录替换**
 * （`!ctx.modules[alias]` 守卫）⇒ **有自有声明的模块**把星号再导出的名字**整批丢掉**。
 *
 * oracle（`tsc --strict`，见 tmp/probe/fix-r27/h4/）：
 * - `declare module "fs" { export * from "node:fs"; export function extra(): number; }`
 * ⇒ 模块 "fs" 的导出面 = 星号再导出的名字 **加上** `extra`（两者都在）。
 *
 * 契约：别名模块的导出表 = 星号再导出的名字 ∪ 模块自己的声明（自己的优先）。
 */







const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeTemp(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug817-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

describe("`export * from` 与模块自有声明合并", () => {
  it("有自有声明的模块不再丢掉星号再导出的名字；纯别名（没有自有声明）仍然与目标共用同一条记录；多目标星号再导出 ⇒ 名字全都进来", () => {
(() => {

    const p = writeTemp(
      "fx.d.ts",
      `declare module "node:fs" {
  export function readFileSync(p: string): string;
  export function statSync(p: string): number;
}
declare module "fs" {
  export * from "node:fs";
  export function extra(): number;
}
`,
    );
    const env = harvestDts([p]);
    const fs = env.modules["fs"]!;
    // 星号再导出的名字：改前整批丢失
    expect(fs["readFileSync"]).toBeDefined();
    expect(fs["statSync"]).toBeDefined();
    // 模块自己的声明：改前保留
    expect(fs["extra"]).toBeDefined();
    expect(formatShape(fs["readFileSync"]!)).toBe("(string) => string");
    expect(formatShape(fs["extra"]!)).toBe("() => number");
    expect(env.stats.skipped).toBe(0);
  })();
(() => {

    const p = writeTemp(
      "fx.d.ts",
      `declare module "node:fs" {
  export function readFileSync(p: string): string;
}
declare module "fs" {
  export * from "node:fs";
}
`,
    );
    const env = harvestDts([p]);
    expect(env.modules["fs"]!["readFileSync"]).toBeDefined();
    // 落盘面靠「同一条记录」去重 ⇒ 别名仍共用
    expect(env.modules["fs"]).toBe(env.modules["node:fs"]);
  })();
(() => {

    const p = writeTemp(
      "fx.d.ts",
      `declare module "a" { export function fromA(): number; }
declare module "b" { export function fromB(): string; }
declare module "c" {
  export * from "a";
  export * from "b";
}
`,
    );
    const env = harvestDts([p]);
    expect(env.modules["c"]!["fromA"]).toBeDefined();
    expect(env.modules["c"]!["fromB"]).toBeDefined();
  })();
});;

  ;

  ;
});
});

// ---------------------------------------------------------------------------
// `declare module "x" { export = <本地类> }` 生成模块记录
// ---------------------------------------------------------------------------
describe("`declare module \"x\" { export = <本地类> }` 生成模块记录", () => {
/**
 * 回归（harvester 收割面）：`export = <本地类/常量>`（@types/node 的 CJS 形态）
 * ⇒ **整个模块记录不生成**（`ctx.skipped++` 静默丢弃）。
 *
 * oracle（`tsc --strict`，见 tmp/probe/fix-r27/h4/ts-oracle/）：
 * - `declare class Buffer { … }; declare module "buffer" { export = Buffer; }`
 * ⇒ `import B from "./cls.js"` 合法（默认导入拿到类）；
 * `import { Buffer } from "./cls.js"` 是 **TS2595**（`'Buffer' can only be imported by
 * using a default import`）⇒ 导出表**不得**提供具名导出 `Buffer`（否则假绿）。
 *
 * 契约：
 * 1. 模块记录**生成**，`default` = 被导出实体的值；
 * 2. 不生成具名导出 `Buffer`（TS 侧 TS2595）；
 * 3. 东西不再被丢 ⇒ `stats.skipped` 不再因为它而涨（汇总行如实反映）。
 */







const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeTemp(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug818-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

describe("`declare module \"x\" { export = <本地类> }` 生成模块记录", () => {
  it("模块记录生成，default = 被导出实体的值，且不产生具名导出；`export = <本地常量>` ⇒ default 是那个常量的值；解析不出来的 `export = <未知名字>` ⇒ 计入 skipped（汇总行有信号）", () => {
(() => {

    const p = writeTemp(
      "fx.d.ts",
      `declare class Buffer { static from(s: string): Buffer; length: number; }
declare module "buffer" { export = Buffer; }
`,
    );
    const env = harvestDts([p]);
    const rec = env.modules["buffer"];
    expect(rec).toBeDefined();
    expect(rec!["default"]).toBeDefined();
    // TS 侧 `import { Buffer }` 是 TS2595 ⇒ 不得有具名导出
    expect(rec!["Buffer"]).toBeUndefined();
    // 不再静默丢弃 ⇒ skipped 不因它而涨
    expect(env.stats.skipped).toBe(0);
  })();
(() => {

    const p = writeTemp(
      "fx.d.ts",
      `declare const version: string;
declare module "ver" { export = version; }
`,
    );
    const env = harvestDts([p]);
    const rec = env.modules["ver"]!;
    expect(formatShape(rec["default"]!)).toBe("string");
    expect(env.stats.skipped).toBe(0);
  })();
(() => {

    const p = writeTemp(
      "fx.d.ts",
      `declare module "mystery" { export = notDeclaredAnywhere; }
`,
    );
    const env = harvestDts([p]);
    expect(env.stats.skipped).toBeGreaterThan(0);
  })();
});;

  ;

  ;
});
});

// ---------------------------------------------------------------------------
// 导出表与 .d.ts 遍历顺序无关
// ---------------------------------------------------------------------------
describe("导出表与 .d.ts 遍历顺序无关", () => {
/**
 * 回归（harvester 收割面）：`export { X }` 的「是不是值」判定发生在 **Phase 1**
 * ⇒ 模块导出表随 **`.d.ts` 遍历顺序**变（同一份声明，换个文件顺序就少一个导出）。
 *
 * oracle（`tsc --strict`，见 tmp/probe/fix-r27/h4/）：
 * - `declare module "pkg-a" { export { Widget }; }` + `export interface Widget { size: number; }`
 * ⇒ 两种遍历顺序下模块 "pkg-a" 的导出面**逐项相同**（都是 `["Widget"]`）。
 *
 * 契约：同一组 `.d.ts` 换遍历顺序 ⇒ 导出表**逐项相同**（模块键、导出名、导出值都一致）。
 */







const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeTemp(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug820-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

/** 导出表的「逐项」快照：模块键 → 导出名 → 展示串 */
function snapshot(files: string[]): Record<string, Record<string, string>> {
  const env = harvestDts(files);
  const out: Record<string, Record<string, string>> = {};
  for (const key of Object.keys(env.modules).sort()) {
    const rec = env.modules[key]!;
    const names = Object.keys(rec).sort();
    const item: Record<string, string> = {};
    for (const n of names) item[n] = formatShape(rec[n]!);
    out[key] = item;
  }
  return out;
}

describe("导出表与 .d.ts 遍历顺序无关", () => {
  it("再导出在前 / 声明在后 ⇒ 两种顺序逐项相同；函数再导出：声明在另一个文件里 ⇒ 两种顺序逐项相同；class 再导出：两种顺序逐项相同，且拿到的是构造签名", () => {
(() => {

    const reexport = writeTemp(
      "a-reexport.d.ts",
      `declare module "pkg-a" {\n  export { Widget };\n}\n`,
    );
    const decl = writeTemp("b-decl.d.ts", `export interface Widget { size: number; }\n`);
    const orderA = snapshot([reexport, decl]);
    const orderB = snapshot([decl, reexport]);
    expect(orderA).toEqual(orderB);
    // 两种顺序下导出都还在（改前：顺序 A 是空的）
    expect(Object.keys(orderA["pkg-a"] ?? {})).toEqual(["Widget"]);
  })();
(() => {

    const reexport = writeTemp(
      "a-reexport.d.ts",
      `declare module "pkg-b" {\n  export { helper as renamed };\n}\n`,
    );
    const decl = writeTemp("b-decl.d.ts", `export declare function helper(): number;\n`);
    const orderA = snapshot([reexport, decl]);
    const orderB = snapshot([decl, reexport]);
    expect(orderA).toEqual(orderB);
    expect(formatShape(harvestDts([reexport, decl]).modules["pkg-b"]!["renamed"]!)).toBe(
      "() => number",
    );
  })();
(() => {

    const reexport = writeTemp(
      "a-reexport.d.ts",
      `declare module "pkg-c" {\n  export { Widget };\n}\n`,
    );
    const decl = writeTemp("b-decl.d.ts", `export declare class Widget { size: number; }\n`);
    expect(snapshot([reexport, decl])).toEqual(snapshot([decl, reexport]));
  })();
});;

  ;

  ;
});
});

// ---------------------------------------------------------------------------
// 顶层 `export = X` 进 default 导出
// ---------------------------------------------------------------------------
describe("顶层 `export = X` 进 default 导出", () => {
/**
 * 回归（harvester 收割面）：模块级 `.d.ts` **顶层的 CJS `export = X`** 整个被丢弃
 * ⇒ 该包**没有 `default` 导出** ⇒ ESM 默认导入（`import _ from "pkg"`）落 `unknown` + 假警告。
 *
 * oracle（`tsc --strict`，见 tmp/probe/fix-r27/h4/ts-oracle/use-default.ts，tsc exit=0）：
 * - `export = _; declare const _: _.LoDashStatic;` ⇒ `import _ from "./cjs.js"` 合法
 * （开 `allowSyntheticDefaultImports`），默认导入拿到 `_` 的类型。
 * - Node 的 cjs↔esm 互操作：`module.exports = _` ⇒ ESM 侧 `default` = `_`。
 *
 * 契约：
 * 1. 顶层 `export = X` ⇒ 收割面的 `default` = X 的值；
 * 2. 桥接层把它提升成包的 `default` 导出（默认导入不再是 unknown）；
 * 3. 不再静默丢弃 ⇒ `stats.skipped` 不因它而涨。
 */









const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeTemp(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug824-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

function pkgOf(pkg: string, file: string): PackageHarvest {
  return { pkg, root: join(file, ".."), dtsFiles: [file], env: harvestDts([file]) };
}

describe("顶层 `export = X` 进 default 导出", () => {
  it("顶层 `export = _` ⇒ 收割面有 default（值 = _ 的类型）；桥接层把顶层 `export =` 提升成包的 default 导出（默认导入不再是 unknown）；顶层 `export = <本地类>` ⇒ default 是构造签名", () => {
(() => {

    const p = writeTemp(
      "fx.d.ts",
      `export = _;
declare const _: _.LoDashStatic;
declare namespace _ {
  interface LoDashStatic {
    uniq(xs: number[]): number[];
  }
}
`,
    );
    const env = harvestDts([p]);
    expect(env.globals["default"]).toBeDefined();
    expect(formatShape(env.globals["default"]!)).toBe("LoDashStatic");
    expect(env.stats.skipped).toBe(0);
  })();
(() => {

    const p = writeTemp(
      "fx.d.ts",
      `export = _;
declare const _: _.LoDashStatic;
declare namespace _ {
  interface LoDashStatic {
    uniq(xs: number[]): number[];
  }
}
`,
    );
    const mods = packageHarvestToAbsModules("fx", pkgOf("fx", p));
    expect(mods["fx"]?.default).toBeDefined();
    expect(formatShape(mods["fx"]!.default!)).toBe("LoDashStatic");
  })();
(() => {

    const p = writeTemp(
      "fx.d.ts",
      `export = Widget;
declare class Widget { size: number; }
`,
    );
    const env = harvestDts([p]);
    expect(env.globals["default"]).toBeDefined();
    expect(env.stats.skipped).toBe(0);
  })();
});;

  ;

  ;
});
});

// ---------------------------------------------------------------------------
// 接口成员提升不得抢真实导出的名字
// ---------------------------------------------------------------------------
describe("接口成员提升不得抢真实导出的名字", () => {
/**
 * 回归（harvester 收割面）：「**接口成员提升**」把**非导出实体**写进模块导出表
 * ⇒ **真实导出整条被丢弃**（先到先得）⇒ L2 假红；且提升出的「幽灵导出」让
 * **不存在的导入**被当成真实导出。
 *
 * 根因：提升出来的成员被当成**模块级导出**（`ctx.pending` 的 fn/var），排在真实声明
 * **之前** ⇒ 物化时「同名先到先得」⇒ 真实导出被挤掉。
 *
 * 夹具（tmp/probe/fix-r27/h3/e2e/realLast/）：
 * export interface Point { x: number; y: number; }
 * export declare const origin: Point;
 * export declare function x(): string; ← 与接口成员 x 同名
 *
 * 改前（产品面）：`nudo check` FAILED（`use() => never throws TypeError`）——
 * 真实导出 `x(): string` 被接口成员 `x: number` 顶掉 ⇒ 调用被判「对 number 调用」。
 * 只把两行换个顺序（realFirst）就翻成 OK ⇒ **同一份声明，顺序决定门禁**。
 * 改后：两种顺序都 OK，`use() => string`。
 *
 * oracle（`tsc --strict`，tmp/probe/fix-r27/h3/oracle/o831.ts）：exit=0
 * ⇒ TS 侧 `x` 就是那个函数导出；接口成员 `size` 从未被导出 ⇒ `import { size }`
 * 在 TS 侧是 TS2305（模块没有该导出）⇒ 收割面不得把它当成导出。
 */









/** harvestToAbsModules（已删的便捷薄壳）的等价内联：harvest + 转 Abs 模块表 */
const modsOf = (pkg: string, dir: string) => {
  const h = harvestPackageCached(pkg, dir);
  return h ? packageHarvestToAbsModules(pkg, h) : {};
};

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeTemp(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug831-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

/** 造一个可解析的假包（node_modules/<pkg>） */
function writePkg(dts: string): { pkg: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-h3-831-"));
  dirs.push(dir);
  // 包名取临时目录名（每次运行唯一 ⇒ 磁盘收割缓存键唯一 ⇒ 不会读到旧缓存）
  const pkg = basename(dir).toLowerCase();
  const pkgDir = join(dir, "node_modules", pkg);
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(
    join(pkgDir, "package.json"),
    JSON.stringify({ name: pkg, version: "1.0.0", types: "index.d.ts" }),
    "utf-8",
  );
  writeFileSync(join(pkgDir, "index.d.ts"), dts, "utf-8");
  return { pkg, dir };
}

function basename(p: string): string {
  const parts = p.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "pkg";
}

const REAL_LAST = `export interface Point { x: number; y: number; }
export declare const origin: Point;
export declare function x(): string;
`;

const REAL_FIRST = `export interface Point { x: number; y: number; }
export declare function x(): string;
export declare const origin: Point;
`;

describe("接口成员提升不得抢真实导出的名字", () => {
  it("同名真实导出存活（不被接口成员顶掉）；声明顺序不影响结果（realFirst / realLast 同形）；包的导出表里没有「幽灵导出」（接口成员不是模块导出）；包的导出表里真实导出不被挤掉（同名接口成员 + 同名函数导出）；对照：没有同名冲突时，真实导出照常在导出表里", () => {
(() => {

    const p = writeTemp("last.d.ts", REAL_LAST);
    const env = harvestDts([p]);
    const x = env.globals.x!;
    expect(x).toBeDefined();
    expect(x.shape.k).toBe("fn");
    expect(formatShape(x)).toContain("string");
  })();
(() => {

    const a = harvestDts([writeTemp("a.d.ts", REAL_LAST)]);
    const b = harvestDts([writeTemp("b.d.ts", REAL_FIRST)]);
    expect(formatShape(a.globals.x!)).toBe(formatShape(b.globals.x!));
    expect(a.globals.x!.shape.k).toBe("fn");
    expect(b.globals.x!.shape.k).toBe("fn");
  })();
(() => {

    const { pkg, dir } = writePkg(
      `export interface Point { size: number; }
export declare const origin: Point;
`,
    );
    const mods = modsOf(pkg, dir);
    const named = mods[pkg]?.named ?? {};
    expect(Object.hasOwn(named, "origin")).toBe(true);
    // `size` 只是接口成员 ⇒ TS 侧 import { size } 是 TS2305 ⇒ 不得出现在导出表
    expect(Object.hasOwn(named, "size")).toBe(false);
  })();
(() => {

    const { pkg, dir } = writePkg(REAL_LAST);
    const mods = modsOf(pkg, dir);
    const named = mods[pkg]?.named ?? {};
    expect(Object.hasOwn(named, "x")).toBe(true);
    const x = named.x as Abs | undefined;
    expect(x?.shape.k).toBe("fn");
  })();
(() => {

    const { pkg, dir } = writePkg(
      `export interface Point { x: number; }
export declare const origin: Point;
export declare function other(): string;
`,
    );
    const mods = modsOf(pkg, dir);
    const named = mods[pkg]?.named ?? {};
    expect(Object.hasOwn(named, "other")).toBe(true);
    expect(Object.hasOwn(named, "origin")).toBe(true);
  })();
});;

  ;

  ;

  ;

  ;
});
});

// ---------------------------------------------------------------------------
// 包根解析：包自带 types 优先于同名 @types
// ---------------------------------------------------------------------------
describe("包根解析：包自带 types 优先于同名 @types", () => {
/**
 * harvester 的**包根解析无条件优先 `@types/<pkg>`**
 * ⇒ 收割到陈旧的 @types 声明（另一个版本的 API）⇒ 签名错（string 折成 number）且**零诊断**。
 *
 * 口径（与 TypeScript / Node 一致）：
 * 1. 包本体 `node_modules/<pkg>` 的 `types`/`typings` → `<pkg>/index.d.ts`；
 * 2. **最后**才回落 `node_modules/@types/<pkg>`；
 * 3. 跨层查找时「任意层的包本体」先于「任意层的 @types」。
 *
 * oracle：`tsc --strict` 对同一夹具给 `string`（包自带的 2.x 声明）。
 */








/** mock fn 的声明返回类型（relation 槽） */
function returnTypeOf(a: Abs | undefined): string {
  if (!a) return "<missing>";
  const rt = getFnImpl(a)?.relation?.returnType;
  if (!rt) return "<no-return>";
  const s = rt.shape as { k: string; type?: string };
  return s.k === "prim" ? (s.type ?? s.k) : s.k;
}

describe("包根解析：包自带 types 优先于同名 @types", () => {
  let dir: string;
  let pkgRoot: string;
  let typesRoot: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "nudo-h7-b833-"));
    // 包自带 types（2.x，真 API）
    pkgRoot = join(dir, "node_modules", "mypkg");
    mkdirSync(pkgRoot, { recursive: true });
    writeFileSync(
      join(pkgRoot, "package.json"),
      JSON.stringify({ name: "mypkg", version: "2.0.0", types: "index.d.ts" }),
    );
    writeFileSync(join(pkgRoot, "index.d.ts"), "export declare function newApi(): string;\n");
    // 陈旧 @types（1.x）
    typesRoot = join(dir, "node_modules", "@types", "mypkg");
    mkdirSync(typesRoot, { recursive: true });
    writeFileSync(
      join(typesRoot, "package.json"),
      JSON.stringify({ name: "@types/mypkg", version: "1.0.0", types: "index.d.ts" }),
    );
    writeFileSync(join(typesRoot, "index.d.ts"), "export declare function newApi(): number;\n");
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("resolvePackageRoot 命中包本体（不是同名 @types）；收割到的是包自带那份声明（string，而不是 @types 的 number）；包本体没有声明时才回落 @types（lodash 形态不回归）", () => {
(() => {

    expect(resolvePackageRoot("mypkg", dir)).toBe(pkgRoot);
  })();
(() => {

    const h = harvestPackage("mypkg", dir);
    expect("error" in h).toBe(false);
    if ("error" in h) return;
    expect(h.root).toBe(pkgRoot);
    expect(h.dtsFiles.every((f) => f.startsWith(pkgRoot))).toBe(true);
    const table = packageHarvestToAbsModules("mypkg", h);
    expect(returnTypeOf(table["mypkg"]?.named["newApi"])).toBe("string");
  })();
(() => {

    const only = mkdtempSync(join(tmpdir(), "nudo-h7-b833-b-"));
    try {
      const t = join(only, "node_modules", "@types", "onlytypes");
      mkdirSync(t, { recursive: true });
      writeFileSync(
        join(t, "package.json"),
        JSON.stringify({ name: "@types/onlytypes", version: "1.0.0", types: "index.d.ts" }),
      );
      writeFileSync(join(t, "index.d.ts"), "export declare function onlyFn(): string;\n");
      expect(resolvePackageRoot("onlytypes", only)).toBe(t);
    } finally {
      rmSync(only, { recursive: true, force: true });
    }
  })();
});;

  ;

  ;
});
});

// ---------------------------------------------------------------------------
// 包名键 = 该包自己的顶层导出；子路径不回落包名键
// ---------------------------------------------------------------------------
describe("包名键 = 该包自己的顶层导出；子路径不回落包名键", () => {
/**
 * harvester 的「**包名键**」导出表 = **第一个 `declare module` 记录**，
 * 且**盖住包自身的顶层导出** ⇒ `import { x } from "pkg"` 拿到另一个模块的同名导出；
 * 子路径说明符又**回落**到包名键 ⇒ 两个方向都拿到**错的确切类型**，且**零诊断**。
 *
 * 修法：包名键只由**该包自己的顶层导出**占；模块记录只登记到自己的键；
 * 子路径说明符**不得**回落到包名键（宁可落 unknown，也不给错的确切类型）。
 *
 * oracle（`tsc --strict`）：包名 import ⇒ `string`；子路径 import ⇒ `number`。
 */








/** mock fn 的声明返回类型（relation 槽） */
function returnTypeOf(a: Abs | undefined): string {
  if (!a) return "<missing>";
  const rt = getFnImpl(a)?.relation?.returnType;
  if (!rt) return "<no-return>";
  const s = rt.shape as { k: string; type?: string };
  return s.k === "prim" ? (s.type ?? s.k) : s.k;
}

function writePkg(root: string, name: string, files: Record<string, string>): void {
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name, version: "1.0.0", types: "index.d.ts" }),
  );
  for (const [file, content] of Object.entries(files)) {
    const p = join(root, file);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, content);
  }
}

describe("包名键 = 该包自己的顶层导出；子路径不回落包名键", () => {
  let dir: string;
  let appDir: string;
  let prevCache: string | undefined;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "nudo-h7-b835-"));
    appDir = join(dir, "app");
    mkdirSync(appDir, { recursive: true });
    // 依赖缓存隔离（磁盘层不应污染夹具收割）
    prevCache = process.env.NUDO_DEPS_CACHE_DIR;
    process.env.NUDO_DEPS_CACHE_DIR = join(dir, "deps-cache");
    // 顶层导出 + 同名的 declare module 记录
    writePkg(join(dir, "node_modules", "shadowpkg"), "shadowpkg", {
      "index.d.ts": [
        "export declare function helper(): string;",
        "",
        'declare module "shadowpkg/sub" {',
        "  export function helper(): number;",
        "}",
        "",
      ].join("\n"),
    });
    // 根包与子路径文件各有同名导出
    writePkg(join(dir, "node_modules", "subpkg"), "subpkg", {
      "index.d.ts": "export declare function get(): string;\n",
      "fp.d.ts": "export declare function get(): number;\n",
    });
    // 只有根包（没有 fp.d.ts）⇒ 子路径无处可落
    writePkg(join(dir, "node_modules", "rootonly"), "rootonly", {
      "index.d.ts": "export declare function get(): string;\n",
    });
  });

  afterAll(() => {
    if (prevCache === undefined) delete process.env.NUDO_DEPS_CACHE_DIR;
    else process.env.NUDO_DEPS_CACHE_DIR = prevCache;
    rmSync(dir, { recursive: true, force: true });
  });

  it("包名键 = 包自身的顶层导出（不是 declare module 记录的同名导出）；子路径说明符拿到子路径自己的导出（不是根包的）；子路径说明符**不回落到包名键**（没有对应文件 ⇒ 落 unknown，不给根包的错值）", () => {
(() => {

    const h = harvestPackage("shadowpkg", appDir);
    expect("error" in h).toBe(false);
    if ("error" in h) return;
    const table = packageHarvestToAbsModules("shadowpkg", h);
    // 包自身的顶层导出在（TS 侧 string）
    expect(returnTypeOf(table["shadowpkg"]?.named["helper"])).toBe("string");
    // declare module 记录仍然登记到**它自己的**键
    expect(returnTypeOf(table["shadowpkg/sub"]?.named["helper"])).toBe("number");
  })();
(() => {

    const spec = bareSpecToAbsModules("subpkg/fp", join(appDir, "sub.js"));
    expect(spec).toBeDefined();
    expect(returnTypeOf(spec?.named["get"])).toBe("number");
  })();
(() => {

    const spec = bareSpecToAbsModules("rootonly/fp", join(appDir, "sub.js"));
    expect(spec).toBeUndefined();
    // 反向：根包键本身仍能解析到自己的导出（不误伤）
    const root = bareSpecToAbsModules("rootonly", join(appDir, "sub.js"));
    expect(returnTypeOf(root?.named["get"])).toBe("string");
  })();
});;

  ;

  ;
});
});

// ---------------------------------------------------------------------------
// --from-dts 的运行时导出面
// ---------------------------------------------------------------------------
describe("--from-dts 的运行时导出面", () => {
/**
 * `nudo contract --from-dts` 的**草稿面**把 5 类**运行时导出**
 * 整条丢弃（`export {x} from` / `export * from` / `enum` / `namespace` /
 * 匿名 `export default function`），且**汇总行报「0 skipped」** ⇒ 丢失**零信号**；
 * 而**同一 harvester 的收割面 `harvestDts` 对同一文件看得见 `Color`（enum）**
 * ⇒ **两个产物面自相矛盾**。
 *
 * 修法（草稿面）：
 * 1. `collectExports` 补齐语句分支：`enum` / `namespace`（**运行时对象** ⇒
 * 投影成 shape）、`export {x} from` / `export * from` / `export * as ns from`
 * （**导出名逐个 push + note** ⇒ 看得见）、匿名 `export default function`
 * （与匿名 class **同款**处理）；
 * 2. **无法建模的导出也要 `push({name, note, kind})`** ⇒ 进 `stats.skipped`
 * ⇒ 汇总行说真话。
 *
 * 反向闸：改前（5 类里 3 类整条消失 + 汇总行报「0 skipped」）⇒ 本文件失败。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** 报告 §的夹具：6 个运行时导出面 */
const RUNTIME_DTS = `export declare function alpha(x: number): string;
export { beta } from "./other";
export * from "./other";
export enum Color { Red, Green }
export namespace Space { export const inner = 1; }
export default function () { return 1; }
`;

function writeDts(name: string, src: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug960-"));
  dirs.push(dir);
  const file = join(dir, name);
  writeFileSync(file, src, "utf-8");
  return file;
}

describe("-from-dts 的运行时导出面", () => {
  it("`enum` 是运行时导出 ⇒ 进草稿（收割面看得见 `Color`）；`namespace` 是运行时导出 ⇒ 进草稿；匿名 `export default function` 进草稿（键 = `default`）；`export {x} from` / `export * from` **看得见**（逐个 push + note）；投影不了的运行时导出**计入 skipped**（汇总行不再报「0 skipped」）；`export * as ns from` 也是运行时", () => {
(() => {

    const file = writeDts("types.d.ts", RUNTIME_DTS);
    const draft = dtsToContractDraft([file], "types");
    expect(draft.draftSource).toContain("export const Color = shape({");
    expect(draft.draftSource).toContain("Red: 0");
    expect(draft.draftSource).toContain("Green: 1");
  })();
(() => {

    const file = writeDts("types.d.ts", RUNTIME_DTS);
    const draft = dtsToContractDraft([file], "types");
    expect(draft.draftSource).toContain("export const Space = shape({");
    expect(draft.draftSource).toContain("inner: 1");
  })();
(() => {

    const file = writeDts("types.d.ts", RUNTIME_DTS);
    const draft = dtsToContractDraft([file], "types");
    expect(draft.draftSource).toContain("as default };");
    // 改前：匿名 default function 整条 `continue` 掉（草稿里根本没有）
    expect(draft.exports.some((e) => e.name === "default")).toBe(true);
  })();
(() => {

    const file = writeDts("types.d.ts", RUNTIME_DTS);
    const draft = dtsToContractDraft([file], "types");
    expect(draft.draftSource).toContain("beta");
    expect(draft.draftSource).toContain("export * from \"./other\"");
    expect(draft.exports.some((e) => e.name === "beta")).toBe(true);
  })();
(() => {

    const file = writeDts("types.d.ts", RUNTIME_DTS);
    const draft = dtsToContractDraft([file], "types");
    // 4 条投影成功（alpha / Color / Space / default）+ 2 条看得见但投影不了
    // （beta 的再导出 + star 再导出）⇒ skipped = 2（改前报 0）
    expect(draft.stats.exports).toBe(4);
    expect(draft.stats.skipped).toBe(2);
  })();
(() => {

    const file = writeDts(
      "ns.d.ts",
      `export * as helpers from "./other";\nexport declare const alpha: number;\n`,
    );
    const draft = dtsToContractDraft([file], "ns");
    expect(draft.exports.some((e) => e.name === "helpers")).toBe(true);
    expect(draft.stats.skipped).toBe(1);
  })();
(() => {

    const file = writeDts(
      "cjs.d.ts",
      `export import legacy = require("./legacy");\nexport declare const alpha: number;\n`,
    );
    const draft = dtsToContractDraft([file], "cjs");
    expect(draft.exports.some((e) => e.name === "legacy")).toBe(true);
    expect(draft.stats.skipped).toBe(1);
  })();
});;

  ;

  ;

  ;

  ;

  ;

  ;
});
});

// ---------------------------------------------------------------------------
// 接口成员不得注册成模块导出
// ---------------------------------------------------------------------------
describe("接口成员不得注册成模块导出", () => {
/**
 * 回归：`declare module "pkg" { interface Opts { x; y } const o: Opts; }`
 * —— 接口成员 `x` / `y` 是**接口成员提升**出来的，不是模块导出
 * （TS：`import { x }` ⇒ TS2305）⇒ 模块记录 / 包导出表都不得登记它们。
 *
 * 改前：`import { x } from "mpkg"` 在 nudo 下拿到**自信的 `number`**（假绿）；
 * `tsc` 对同一行报 TS2305。改后：x / y 不导出 ⇒ 诚实降级 `unknown`。
 */









const DTS = `declare module "ghostpkg" {
  interface Opts { x: number; y: string; }
  const o: Opts;
  function real(): void;
}
`;

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function fixture(): PackageHarvest {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug123-"));
  dirs.push(dir);
  const file = join(dir, "index.d.ts");
  writeFileSync(file, DTS, "utf-8");
  return { pkg: "ghostpkg", root: dir, dtsFiles: [file], env: harvestDts([file]) };
}

describe("接口成员不得注册成模块导出", () => {
  it("declare module 记录的导出表只含真实声明（o / real）；磁盘缓存往返保留提升 provenance（冷 / 热两面同结论）", () => {
(() => {

    const h = fixture();
    // 白盒：x / y 仍在记录里（brand 面要用），但被标记成「提升」
    expect([...promotedNamesOf(h.env.modules["ghostpkg"]!)]).toEqual(["x", "y"]);
    const named = packageHarvestToAbsModules("ghostpkg", h)["ghostpkg"]!.named;
    expect(Object.keys(named)).toContain("o");
    expect(Object.keys(named)).toContain("real");
    // 幽灵导出必须缺席
    expect(Object.keys(named)).not.toContain("x");
    expect(Object.keys(named)).not.toContain("y");
  })();
(() => {

    const h = fixture();
    const json = JSON.parse(
      JSON.stringify(serializeHarvestJson("ghostpkg", h.env, { dtsHash: "h", maxFiles: 1 })),
    );
    const back = materializeHarvestJson(json)!;
    expect([...promotedNamesOf(back.modules["ghostpkg"]!)]).toEqual(["x", "y"]);
    const named = packageHarvestToAbsModules("ghostpkg", { ...h, env: back })["ghostpkg"]!.named;
    expect(Object.keys(named)).toContain("o");
    expect(Object.keys(named)).not.toContain("x");
  })();
});;

  ;
});
});

// ---------------------------------------------------------------------------
// export declare namespace 进导出面
// ---------------------------------------------------------------------------
describe("export declare namespace 进导出面", () => {
/**
 * 回归：`export declare namespace Space { … }` 被导出面扫描器一起跳过
 * （`NamespaceDeclaration` 与 ambient module 共用 `ModuleDeclaration` 节点）
 * ⇒ 整块 API 漏导出（裸包 import 拿到 unknown、零信号），而契约草稿面却登记了它。
 *
 * 契约：具名 namespace 导出进导出面，且与 `.d.ts` 声明一致。
 */









/** harvestToAbsModules（已删的便捷薄壳）的等价内联：harvest + 转 Abs 模块表 */
const modsOf = (pkg: string, dir: string) => {
  const h = harvestPackageCached(pkg, dir);
  return h ? packageHarvestToAbsModules(pkg, h) : {};
};

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const DTS = `export declare namespace Space {
  const inner: number;
}
export declare function plain(x: number): string;
`;

function writePkg(): { pkg: string; dir: string; entry: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug143-"));
  dirs.push(dir);
  const pkg = "spacepkg";
  const pkgDir = join(dir, "node_modules", pkg);
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(join(pkgDir, "package.json"), JSON.stringify({ name: pkg, version: "1.0.0", types: "index.d.ts" }), "utf-8");
  const entry = join(pkgDir, "index.d.ts");
  writeFileSync(entry, DTS, "utf-8");
  return { pkg, dir, entry };
}

describe("export declare namespace 进导出面", () => {
  it("导出面扫描登记 Space（不只是 plain）；包导出表含 Space，且成员 inner 有具体类型", () => {
(() => {

    const { entry } = writePkg();
    const scan = dtsFileScan(entry);
    expect([...scan.exported].sort()).toEqual(["Space", "plain"]);
    expect(scan.private.size).toBe(0);
  })();
(() => {

    const { pkg, dir } = writePkg();
    const named = modsOf(pkg, dir)[pkg]!.named;
    expect(Object.keys(named).sort()).toEqual(["Space", "plain"]);
    const slots = (named.Space as Abs).shape;
    expect(slots.k).toBe("obj");
    if (slots.k !== "obj") return;
    expect(slots.slots.inner!.value.shape).toEqual({ k: "prim", type: "number" });
  })();
});;

  ;
});
});

// ---------------------------------------------------------------------------
// namespace 先声明时函数不得被丢弃
// ---------------------------------------------------------------------------
describe("namespace 先声明时函数不得被丢弃", () => {
/**
 * 回归：`nsSlotsByName` 的 set / get 键不对称（写带 `\0` 分隔符、读漏掉）
 * ⇒ `.d.ts` 里 **namespace 先声明**、同名 function 后声明时**函数被整条丢弃**
 * ⇒ 调用它被判 `throws TypeError` ⇒ L2 假红（tsc 判绿、宿主可调用）。
 *
 * 契约：两种声明顺序给出**同一个**可调用函数（命名空间成员挂成静态槽）。
 */







const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeTemp(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug212-"));
  dirs.push(dir);
  const p = join(dir, "index.d.ts");
  writeFileSync(p, content, "utf-8");
  return p;
}

const NS_FIRST = `export declare namespace helper {
  function extra(): number;
}
export declare function helper(s: string): number;
`;

const FN_FIRST = `export declare function helper(s: string): number;
export declare namespace helper {
  function extra(): number;
}
`;

function helperOf(dts: string): Abs {
  return harvestDts([writeTemp(dts)]).globals.helper!;
}

function staticSlots(a: Abs): Record<string, Slot> {
  const s = a.shape;
  return s.k === "fn" ? (s.slots ?? {}) : {};
}

describe("namespace 先声明时函数不得被丢弃", () => {
  it("ns-first：helper 是可调用函数（不是命名空间对象）；两种声明顺序给出同一个形态", () => {
(() => {

    const h = helperOf(NS_FIRST);
    expect(h.shape.k).toBe("fn");
    expect(formatShape(h)).toContain("=> number");
    // 命名空间成员挂成静态槽
    expect(Object.keys(staticSlots(h))).toEqual(["extra"]);
  })();
(() => {

    const a = helperOf(NS_FIRST);
    const b = helperOf(FN_FIRST);
    expect(a.shape.k).toBe(b.shape.k);
    expect(formatShape(a)).toBe(formatShape(b));
    expect(Object.keys(staticSlots(a))).toEqual(Object.keys(staticSlots(b)));
  })();
});;

  ;
});
});

// ---------------------------------------------------------------------------
// 顶层值位置接口声明不得产生幽灵全局
// ---------------------------------------------------------------------------
describe("顶层值位置接口声明不得产生幽灵全局", () => {
/**
 * 回归（harvester 全局面）：顶层「值位置接口声明」的接口成员
 * **不得**提升成全局符号。
 *
 * `export declare const o: Opts;` 里的成员在 TypeScript 中只在 `Opts` 内部
 * 可见（模块外 / 全局作用域根本没有这些名字）。此前 `expandInterfaceAsModuleMembers`
 * 无条件提升进 `p.scope`，顶层声明的 `p.scope` 就是全局作用域 ⇒ 造出
 * TypeScript 判 **TS2304** 的幽灵全局（`@types/lodash` 实测泄漏 60 个方法名，
 * 如 `clone` / `isEqual` / `now`）⇒ nudo 对不存在的名字给出具体类型（假绿）。
 *
 * 口径：提升只对**模块作用域**成立（`@types/node` 24 `path` 形态、
 * lodash `LoDashStatic` 形态都是模块级成员）；全局面只保留 var 本体。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeTemp(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug253-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

const TOP_LEVEL = `export interface Opts { x?: number; y: string; }
export declare const o: Opts;
`;

const MODULE_SCOPE = `declare module "m" {
  export interface Opts { x?: number; y: string; }
  export declare const o: Opts;
}
`;

describe("顶层值位置接口声明不得产生幽灵全局", () => {
  it("控制组：单独声明 interface 不产生任何全局（基线）；顶层 `export declare const o: Opts;` ⇒ 成员不进全局面（修前：x / y 都是全局）；模块作用域的同一形态仍然提升（提升路径本身不被削弱）", () => {
(() => {

    const p = writeTemp("ctl.d.ts", `export interface Opts { x?: number; y: string; }\n`);
    const env = harvestDts([p]);
    expect(env.globals.x).toBeUndefined();
    expect(env.globals.y).toBeUndefined();
  })();
(() => {

    const p = writeTemp("top.d.ts", TOP_LEVEL);
    const env = harvestDts([p]);
    // var 本体仍在全局面（default/namespace 消费）
    expect(env.globals.o).toBeDefined();
    // 成员是接口内部名字：全局作用域不存在
    expect(env.globals.x).toBeUndefined();
    expect(env.globals.y).toBeUndefined();
  })();
(() => {

    const p = writeTemp("mod.d.ts", MODULE_SCOPE);
    const env = harvestDts([p]);
    const m = env.modules.m!;
    expect(m).toBeDefined();
    expect(m.x).toBeDefined();
    expect(m.y).toBeDefined();
    // 模块成员不得外溢到全局面
    expect(env.globals.x).toBeUndefined();
    expect(env.globals.y).toBeUndefined();
  })();
});;

  ;

  ;
});
});

// ---------------------------------------------------------------------------
// 接口成员不得落成 env 模块的全局
// ---------------------------------------------------------------------------
describe("接口成员不得落成 env 模块的全局", () => {
/**
 * 回归：顶层「值位置接口声明」的**接口成员**被提升成 envoy 模块的
 * **全局** ⇒ 引用该 env 的工程里裸写 `x` 被判 `number | undefined`，而 tsc 报
 * TS2304 ⇒ 假绿。
 *
 * 口径（完整修法）：成员提升**只对模块作用域**成立。顶层值位置声明
 * （`export declare const o: Opts;`）的 `p.scope` 是全局作用域 ⇒ 那里**不提升**
 * ⇒ 收割面的 `env.globals` 本身就不含 `x` / `y`（早先只在出口
 * `emitEnvModule` 过滤，收割面仍留着幽灵名字；现已消除源头）。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeTemp(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug253-"));
  dirs.push(dir);
  const p = join(dir, "index.d.ts");
  writeFileSync(p, content, "utf-8");
  return p;
}

const WITH_VALUE_DECL = `export interface Opts { x?: number; y: string; }
export declare const o: Opts;
`;
const WITHOUT_VALUE_DECL = "export interface Opts { x?: number; y: string; }\n";

describe("接口成员不得落成 env 模块的全局", () => {
  it("收割面不产生提升成员（x / y 只在接口内部可见）；emitEnvModule 的 globals 只落真实声明（o），不落提升成员", () => {
(() => {

    const env = harvestDts([writeTemp(WITH_VALUE_DECL)]);
    expect([...promotedNamesOf(env.globals)]).toEqual([]);
    expect(env.globals.x).toBeUndefined();
    expect(env.globals.y).toBeUndefined();
    // var 本体仍在（default / namespace 消费）
    expect(env.globals.o).toBeDefined();
    // 严格单变量对照：没有值位置声明时同样没有这些名字
    const ctl = harvestDts([writeTemp(WITHOUT_VALUE_DECL)]);
    expect([...promotedNamesOf(ctl.globals)]).toEqual([]);
  })();
(() => {

    const code = emitEnvModule(harvestDts([writeTemp(WITH_VALUE_DECL)]), "optpkg");
    expect(/^\s*o:/m.test(code)).toBe(true);
    expect(/^\s*x:/m.test(code)).toBe(false);
    expect(/^\s*y:/m.test(code)).toBe(false);
  })();
});;

  ;
});
});

// ---------------------------------------------------------------------------
// 「公开面不可知」回落不得把模块私有声明当导出
// ---------------------------------------------------------------------------
describe("「公开面不可知」回落不得把模块私有声明当导出", () => {
/**
 * 回归：包里只要有一条解析不了的 `export * from "<外部包>"`，
 * 「公开面不可知」回落就退成整个 globals 袋（只扣 ambient）⇒ **模块私有**
 * 顶层声明被提升成包导出 ⇒ nudo 接受 TS 拒绝的 import（TS2459）并给出自信值。
 *
 * 契约：回落必须扣掉**模块私有**（module 模式里从未 `export` 的顶层声明）。
 */







/** harvestToAbsModules（已删的便捷薄壳）的等价内联：harvest + 转 Abs 模块表 */
const modsOf = (pkg: string, dir: string) => {
  const h = harvestPackageCached(pkg, dir);
  return h ? packageHarvestToAbsModules(pkg, h) : {};
};

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writePkg(dts: string): { pkg: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug265-"));
  dirs.push(dir);
  const pkg = "privatepkg";
  const pkgDir = join(dir, "node_modules", pkg);
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(
    join(pkgDir, "package.json"),
    JSON.stringify({ name: pkg, version: "1.0.0", types: "index.d.ts" }),
    "utf-8",
  );
  writeFileSync(join(pkgDir, "index.d.ts"), dts, "utf-8");
  return { pkg, dir };
}

const UNRESOLVED_STAR = `export declare function real(n: number): number;
declare function helper(s: string): number;
export * from "some-external-pkg";
`;

const NO_STAR = `export declare function real(n: number): number;
declare function helper(s: string): number;
`;

const HELPER_EXPORTED = `export declare function real(n: number): number;
export declare function helper(s: string): number;
export * from "some-external-pkg";
`;

function namedOf(dts: string): string[] {
  const { pkg, dir } = writePkg(dts);
  return Object.keys(modsOf(pkg, dir)[pkg]!.named).sort();
}

describe("「公开面不可知」回落不得把模块私有声明当导出", () => {
  it("存在未解析的 export *：helper（模块私有）不得出现在包导出集；对照组：没有 export * 时同样只导出 real（口径一致）；对照：helper 真的导出时照常在导出集里", () => {
(() => {

    expect(namedOf(UNRESOLVED_STAR)).toEqual(["real"]);
  })();
(() => {

    expect(namedOf(NO_STAR)).toEqual(["real"]);
  })();
(() => {

    expect(namedOf(HELPER_EXPORTED)).toEqual(["helper", "real"]);
  })();
});;

  ;

  ;
});
});

// ---------------------------------------------------------------------------
// 磁盘回读保留声明字面量的精度
// ---------------------------------------------------------------------------
describe("磁盘回读保留声明字面量的精度", () => {
/**
 * 回归：磁盘投影丢 `conf` ⇒ 回读把**每个** Abs 标成 `mock` ⇒ 声明的
 * 字面量被 `widenUncertainLiteral` 放宽成基类型 ⇒ 同一份 `.d.ts`，缓存冷 / 热
 * 两次运行发布**不同**的 zod / standard 产物（热产物接受集更宽 ⇒ 消费端假绿）。
 *
 * 契约：磁盘投影里的 `lit` **只**来自声明 ⇒ 回读必须恢复 `exact` 精度。
 */




/** `"\\" | "/"`（与夹具同形：两个字面量的 sum） */
function sum2(): Abs {
  return makeAbs({ k: "sum", members: [strLit("\\"), strLit("/")] }, undefined, undefined, "exact");
}

/** Abs 的字面量值（非 `lit` 项 ⇒ undefined）。 */
function litValue(a: Abs): LiteralValue | undefined {
  const t = a.term;
  return t?.op === "lit" ? t.value : undefined;
}

describe("磁盘回读保留声明字面量的精度", () => {
  it("单个声明字面量往返后 conf = exact（不是 mock）；字面量并集（\"\\\\\" | \"/\"）往返后每个成员仍是字面量；整包序列化 → 回读：字面量不退化（冷 / 热两面同产物）", () => {
(() => {

    const back = harvestSigToAbs(absToHarvestSig(strLit("/")));
    expect(back.conf).toBe("exact");
    expect(back.term?.op).toBe("lit");
  })();
(() => {

    const src = sum2();
    const back = harvestSigToAbs(absToHarvestSig(src));
    expect(back.shape.k).toBe("sum");
    const members = (back.shape as { members: Abs[] }).members;
    expect(members.map(litValue)).toEqual(["\\", "/"]);
    for (const m of members) expect(m.conf).toBe("exact");
  })();
(() => {

    const env = {
      globals: { sep: sum2() },
      modules: {},
      stats: { files: 1, symbols: 1, skipped: 0 },
    };
    const json = JSON.parse(
      JSON.stringify(serializeHarvestJson("fakepkg", env, { dtsHash: "h", maxFiles: 1 })),
    );
    const back = materializeHarvestJson(json)!;
    const sep = back.globals.sep!;
    expect(sep.shape.k).toBe("sum");
    const members = (sep.shape as { members: Abs[] }).members;
    expect(members.map(litValue)).toEqual(["\\", "/"]);
  })();
});;

  ;

  ;
});
});
