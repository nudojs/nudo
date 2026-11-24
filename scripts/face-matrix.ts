/**
 * face-matrix — 构造 × 面矩阵（根因根除计划 Phase 0）。
 *
 * 语料按 **TS 构造** 命名（注解成员 / 声明返回 / 类成员 / 模块面 / 值通道），
 * 不按 bug 编号命名。每个 case 跑这些面：
 *
 *   check              `nudo check --json` 的签名文本（仅 expectCheck）
 *   dts                `nudo export --format dts` 的产物文本（仅 expectDts）
 *   dts-self-compile   产物自身 `tsc --strict --noEmit` 编译
 *   consumer-compile   只含产物 `lib.d.ts` 的临时工程里 import 导出 API
 *   oracle             `tsc --declaration` 的声明文本（只观测，不判定）
 *
 * 基线是**迁移棘轮**：失败集合必须与 docs/reports/face-matrix-baseline.json
 * 完全一致；新增失败即红；基线行减少说明已修好（打印 FIXED，需 --update 收敛）。
 *
 *   tsx scripts/face-matrix.ts            基线比对（棘轮）
 *   tsx scripts/face-matrix.ts --update   重写基线
 *   tsx scripts/face-matrix.ts --json     机器可读摘要
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "packages/nudojs/src/index.ts");
const TSC = join(ROOT, "node_modules/typescript/bin/tsc");
const BASELINE = join(ROOT, "docs/reports/face-matrix-baseline.json");

/** 与 `nudo check` 门禁同口径的 tsc 旗标（`--ignoreConfig` 防仓库 tsconfig 泄漏）。 */
const TSC_FLAGS = ["--ignoreConfig", "--strict", "--target", "es2022", "--lib", "es2024,dom", "--module", "esnext", "--moduleResolution", "bundler", "--noEmit"];

/** expectDts 的每一条都取自 tsc `--declaration` 的声明文本（空白归一后）。 */
type Case = { name: string; src: string; check?: string[]; checkNot?: string[]; dts?: string[]; oracle?: false };

const CASES: Case[] = [
  { name: "interface-extends", check: ["name: string", "role: string"],
    src: `interface Base { name: string }
interface Admin extends Base { role: string }
export function adminName(a: Admin): string { return a.name; }` },
  { name: "call-signature", check: ["useCall(f: (number) => string) => string"], checkNot: ["never", "throws TypeError"],
    src: `interface Callable { (x: number): string }
export function useCall(f: Callable): string { return f(1); }` },
  { name: "construct-signature", check: ["make(c: (number) =>"], checkNot: ["never", "throws TypeError"],
    src: `interface Ctor { new (x: number): Date }
export function make(c: Ctor): Date { return new c(1); }` },
  { name: "accessor", check: ["x: number"],
    src: `interface HasX { get x(): number }
export function readX(o: HasX): number { return o.x; }` },
  { name: "utility-type", check: ["partial(u: { name?: string, age?: number }) => string"], checkNot: ["never", "throws TypeError"],
    src: `interface User { name: string; age: number }
export function partial(u: Partial<User>): string { return u.name ?? ""; }
export function picked(u: Pick<User, "name">): string { return u.name; }
export function omitted(u: Omit<User, "age">): string { return u.name; }` },
  { name: "typeof-dotted", check: ["tPort(x: number) => number"], checkNot: ["never", "throws TypeError"],
    src: `export const cfg = { port: 8080, name: "n" };
export function tPort(x: typeof cfg.port) { return x + 1; }` },
  { name: "union-return", dts: ["u(x: boolean): string | number;"],
    src: `export function u(x: boolean): string | number { return x ? "a" : 1; }` },
  { name: "this-return", dts: ["chain(): this;"],
    src: `export class Chain { chain(): this { return this; } }` },
  { name: "tuple-return", dts: ["tup(): [number];"],
    src: `export function tup(): [number] { return [1]; }` },
  { name: "default-export-literal", dts: ["_default: 42;"],
    src: `export default 42;` },
  { name: "index-signature", dts: ["[k: string]: number"],
    src: `export function idx(o: { [k: string]: number }): number { return o.x; }` },
  { name: "class-field-annotation", dts: ["v: number;"],
    src: `export class A { v: number = 0; }` },
  { name: "module-marker", dts: ["f(): Hidden;"],
    src: `interface Hidden { x: number }
export function f(): Hidden { return { x: 1 }; }` },
  { name: "export-equals", dts: ["declare function api(x: number): number;", "export = api;"],
    src: `function api(x: number): number { return x; }
export = api;` },
  { name: "destructured-default-optional", dts: ["opt({ a }?:", "): number;"],
    src: `export function opt({ a }: { a: number } = { a: 1 }): number { return a; }` },
  { name: "function-expression-return", dts: ["make(): (x: number) => number;"],
    src: `export function make(): (x: number) => number { return (x) => x + 1; }` },
  { name: "namespace-merge", dts: ["function a(): number;", "function b(): number;"],
    src: `export namespace N { export function a(): number; }
export namespace N { export function b(): number; }` },
  { name: "namespace-literal", dts: ["export const v: 1;", "export const s: \"x\";"], oracle: false,
    src: `export namespace N { export const v = 1; export const s = "x"; }` },
  { name: "bigint-literal", dts: ["b: 10n;"], oracle: false,
    src: `export const b = 10n;` },
  { name: "non-exported-enum", dts: ["declare enum E {", "f(): E;"],
    src: `enum E { A }
export function f(): E { return E.A; }` },
  { name: "private-method", dts: ["#private;"],
    src: `export class C { #m(): number { return 1; } }` },
  { name: "abstract-accessor", dts: ["abstract get x(): number;"],
    src: `export abstract class A { abstract get x(): number; }` },
  { name: "error-subclass", dts: ["extends Error", "code: number;"],
    src: `export class MyErr extends Error { code = 1; }` },
];

type FailCode = "check-mismatch" | "dts-mismatch" | "dts-self-compile" | "consumer-compile" | "cli-error";
type FaceName = "check" | "dts" | "dts-self-compile" | "consumer-compile";
type FaceResult = { status: "pass" | "fail" | "skip"; detail?: string };
type CaseResult = {
  name: string;
  faces: Record<FaceName, FaceResult>;
  reasons: FailCode[];
  observations: Partial<Record<"check" | "dts" | "oracle" | FaceName, string>>;
};
type Exec = { status: number | null; stdout: string; stderr: string; error?: string };

let TMP = "";

function run(cmd: string, args: string[], timeout = 180_000): Exec {
  const res = spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8", timeout, maxBuffer: 64 * 1024 * 1024 });
  if (res.error) return { status: null, stdout: res.stdout ?? "", stderr: res.stderr ?? "", error: res.error.message };
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

const runCli = (args: string[]): Exec => run("pnpm", ["exec", "tsx", CLI, ...args]);

/** 临时绝对路径会随 mkdtemp 漂移 ⇒ 观测文本里折成 `<tmp>`（基线不存文本，但 --json 可读）。 */
const sanitize = (text: string): string => text.split(TMP).join("<tmp>");

const tail = (text: string, lines = 4): string =>
  text.trim().split("\n").filter((l) => l.trim().length > 0).slice(-lines).join("\n");

const normalize = (text: string): string => text.replace(/\s+/g, " ").trim();

const missing = (text: string, expect: readonly string[]): string[] => {
  const norm = normalize(text);
  return expect.filter((e) => !norm.includes(normalize(e)));
};

// ---------------------------------------------------------------- faces

type CheckJson = { signatures?: Array<{ name: string; params: string[]; paramTypes?: string[]; display: string; abs: string }> };

const checkCache = new Map<string, { text?: string; error?: string }>();
const dtsCache = new Map<string, { dts?: string; error?: string }>();
const tscCache = new Map<string, { ok: boolean; output: string }>();

/** 签名文本 = 名字 + 形参类型 + 返回面（display/abs），供 expectCheck 子串匹配。 */
function signatureText(json: CheckJson): string {
  return (json.signatures ?? [])
    .map((s) => `${s.name}(${s.params.map((p, i) => `${p}: ${s.paramTypes?.[i] ?? "?"}`).join(", ")}) => ${s.display}\nabs: ${s.abs}`)
    .join("\n");
}

function checkFace(source: string, fixture: string): { text?: string; error?: string } {
  const hit = checkCache.get(source);
  if (hit) return hit;
  const res = runCli(["check", "--json", fixture]);
  let out: { text?: string; error?: string };
  if (res.error) {
    out = { error: res.error };
  } else {
    try {
      const json = JSON.parse(res.stdout.trim()) as CheckJson;
      if (!Array.isArray(json.signatures)) throw new Error("no signatures[] in check --json");
      out = { text: signatureText(json) };
    } catch (err) {
      out = { error: `check --json unparsable (exit ${res.status}): ${(err as Error).message}${res.stderr.trim() ? `\n${tail(res.stderr)}` : ""}` };
    }
  }
  checkCache.set(source, out);
  return out;
}

function dtsFace(source: string, fixture: string, outDir: string): { dts?: string; error?: string } {
  const hit = dtsCache.get(source);
  if (hit) return hit;
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const res = runCli(["export", fixture, "--format", "dts", "--out", outDir]);
  let out: { dts?: string; error?: string };
  if (res.error) {
    out = { error: res.error };
  } else if (res.status !== 0) {
    out = { error: `export exit ${res.status}: ${tail(res.stderr || res.stdout)}` };
  } else {
    const files = readdirSync(outDir).filter((f) => f.endsWith(".d.ts")).sort();
    out = files.length === 0
      ? { error: "export wrote no .d.ts" }
      : { dts: files.map((f) => readFileSync(join(outDir, f), "utf8")).join("\n") };
  }
  dtsCache.set(source, out);
  return out;
}

function tsc(key: string, args: string[]): { ok: boolean; output: string } {
  const hit = tscCache.get(key);
  if (hit) return hit;
  const res = run(process.execPath, [TSC, ...args]);
  const out = { ok: res.status === 0, output: sanitize(`${res.stdout}${res.stderr}`.trim()) };
  tscCache.set(key, out);
  return out;
}

function selfCompile(caseName: string, dts: string): { ok: boolean; output: string } {
  const file = join(TMP, "self", `${caseName}.d.ts`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, dts);
  return tsc(`self:${dts}`, [...TSC_FLAGS, file]);
}

/** 消费方只看到导出的 dts（`lib.d.ts`），default import 取导出 API（对 `export =` 也成立）。 */
const CONSUMER_SOURCE = `import api from "./lib.js";
export type Face = typeof api;
export const face: Face = api;
`;

function consumerCompile(caseName: string, dts: string): { ok: boolean; output: string } {
  const dir = join(TMP, "consumer", caseName);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "lib.d.ts"), dts);
  writeFileSync(join(dir, "use.ts"), CONSUMER_SOURCE);
  return tsc(`consumer:${dts}`, [...TSC_FLAGS, join(dir, "use.ts")]);
}

/** tsc `--declaration` oracle：只观测「正确声明」长什么样，不参与判定。 */
function oracleFace(caseName: string, fixture: string): string | undefined {
  const outDir = join(TMP, "oracle", caseName);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  // 与编译面同一套解析口径，但换 `--declaration`（`--noEmit` 不能与 emit 同用）。
  tsc(`oracle:${caseName}`, [...TSC_FLAGS.filter((f) => f !== "--noEmit"), "--declaration", "--emitDeclarationOnly", "--outDir", outDir, fixture]);
  const file = join(outDir, `${caseName}.d.ts`);
  return existsSync(file) ? readFileSync(file, "utf8") : undefined;
}

// ---------------------------------------------------------------- runner

function runCase(c: Case, fixture: string): CaseResult {
  const faces: Record<FaceName, FaceResult> = { check: { status: "skip" }, dts: { status: "skip" }, "dts-self-compile": { status: "skip" }, "consumer-compile": { status: "skip" } };
  const reasons = new Set<FailCode>();
  const observations: CaseResult["observations"] = {};

  if (c.check) {
    const res = checkFace(c.src, fixture);
    if (res.error) {
      faces.check = { status: "fail", detail: res.error };
      reasons.add("cli-error");
    } else {
      observations.check = res.text;
      const gone = missing(res.text ?? "", c.check);
      const forbidden = (c.checkNot ?? []).filter((s) => (res.text ?? "").includes(s));
      const bad = [...gone.map((s) => `missing: ${s}`), ...forbidden.map((s) => `forbidden: ${s}`)];
      faces.check = bad.length > 0 ? { status: "fail", detail: bad.join(" | ") } : { status: "pass" };
      if (bad.length > 0) reasons.add("check-mismatch");
    }
  }

  const exported = dtsFace(c.src, fixture, join(TMP, "out", c.name));
  if (exported.error) {
    faces.dts = { status: "fail", detail: exported.error };
    reasons.add("cli-error");
  } else {
    const dts = exported.dts ?? "";
    observations.dts = dts;
    if (c.dts) {
      const gone = missing(dts, c.dts);
      faces.dts = gone.length > 0 ? { status: "fail", detail: `missing: ${gone.join(" | ")}` } : { status: "pass" };
      if (gone.length > 0) reasons.add("dts-mismatch");
      observations.oracle = oracleFace(c.name, fixture);
    }
    const self = selfCompile(c.name, dts);
    observations["dts-self-compile"] = self.output;
    faces["dts-self-compile"] = self.ok ? { status: "pass" } : { status: "fail", detail: tail(self.output) };
    if (!self.ok) reasons.add("dts-self-compile");
    const consumer = consumerCompile(c.name, dts);
    observations["consumer-compile"] = consumer.output;
    faces["consumer-compile"] = consumer.ok ? { status: "pass" } : { status: "fail", detail: tail(consumer.output) };
    if (!consumer.ok) reasons.add("consumer-compile");
  }

  return { name: c.name, faces, reasons: [...reasons].sort(), observations };
}

// ---------------------------------------------------------------- baseline

type Baseline = { version: number; cases: Record<string, FailCode[]> };

function readBaseline(): Baseline | null {
  if (!existsSync(BASELINE)) return null;
  const raw = JSON.parse(readFileSync(BASELINE, "utf8")) as Baseline;
  if (!raw || typeof raw.cases !== "object" || raw.cases === null) throw new Error("baseline missing `cases` object");
  return raw;
}

function writeBaseline(results: readonly CaseResult[]): void {
  const cases: Record<string, string[]> = {};
  for (const name of results.map((r) => r.name).sort()) {
    cases[name] = results.find((r) => r.name === name)?.reasons ?? [];
  }
  const doc = {
    version: 1,
    note: "构造 × 面矩阵的迁移棘轮：键 = case 名，值 = 已知失败原因码。Phase 2/3 每收敛一个决策就 --update 删对应行。",
    cases,
  };
  mkdirSync(dirname(BASELINE), { recursive: true });
  writeFileSync(BASELINE, `${JSON.stringify(doc, null, 2)}\n`);
}

// ---------------------------------------------------------------- main

const FACE_OF: Record<FailCode, FaceName> = {
  "check-mismatch": "check",
  "dts-mismatch": "dts",
  "dts-self-compile": "dts-self-compile",
  "consumer-compile": "consumer-compile",
  "cli-error": "check",
};

function main(): number {
  const args = new Set(process.argv.slice(2));
  for (const arg of args) {
    if (arg !== "--update" && arg !== "--json") {
      console.error(`face-matrix: unknown flag ${arg}`);
      return 2;
    }
  }
  const update = args.has("--update");
  const asJson = args.has("--json");
  if (!existsSync(CLI) || !existsSync(TSC)) {
    console.error(`face-matrix: missing ${existsSync(CLI) ? "tsc" : "CLI entry"}; repo layout changed?`);
    return 2;
  }

  TMP = mkdtempSync(join(tmpdir(), "nudo-face-matrix-"));
  const srcDir = join(TMP, "src");
  mkdirSync(srcDir, { recursive: true });
  for (const c of CASES) writeFileSync(join(srcDir, `${c.name}.ts`), c.src);

  const results: CaseResult[] = [];
  for (const c of CASES) results.push(runCase(c, join(srcDir, `${c.name}.ts`)));

  // expectDts 必须能在 tsc oracle 里找到，否则是语料漂移（只告警，不判失败）。
  const warnings: string[] = [];
  for (let i = 0; i < CASES.length; i += 1) {
    const oracle = results[i].observations.oracle;
    if (!CASES[i].dts || !oracle || CASES[i].oracle === false) continue;
    const gone = missing(oracle, CASES[i].dts!);
    if (gone.length > 0) warnings.push(`${CASES[i].name}: expectDts absent from tsc oracle: ${gone.join(" | ")}`);
  }

  const totalFailures = results.reduce((n, r) => n + r.reasons.length, 0);
  const current = new Map(results.map((r) => [r.name, r.reasons] as const));
  let baseline: Baseline | null = null;
  const fixed: string[] = [];
  const added: string[] = [];
  const stale: string[] = [];
  let knownFailures = totalFailures;

  if (!update) {
    try {
      baseline = readBaseline();
    } catch (err) {
      console.error(`face-matrix: cannot read baseline: ${(err as Error).message}`);
      return 2;
    }
    if (!baseline) {
      console.error(`face-matrix: no baseline at ${relative(ROOT, BASELINE)}; run \`pnpm run face:matrix --update\``);
      return 2;
    }
    knownFailures = Object.values(baseline.cases).reduce((n, rs) => n + rs.length, 0);
    for (const [name, oldReasons] of Object.entries(baseline.cases)) {
      const now = current.get(name);
      if (!now) {
        stale.push(name);
        continue;
      }
      for (const reason of oldReasons) if (!now.includes(reason)) fixed.push(`${name} ${reason}`);
    }
    for (const [name, nowReasons] of current) {
      const old = new Set(baseline.cases[name] ?? []);
      for (const reason of nowReasons) if (!old.has(reason)) added.push(`${name} ${reason}`);
    }
  }

  const exitCode = update ? 0 : stale.length > 0 ? 2 : added.length > 0 ? 1 : 0;

  if (asJson) {
    console.log(JSON.stringify({
      ok: exitCode === 0,
      cases: CASES.length,
      failures: totalFailures,
      knownFailures,
      newFailures: added,
      fixed,
      stale,
      updated: update,
      warnings,
      baseline: relative(ROOT, BASELINE),
      results: results.map((r) => ({ name: r.name, reasons: r.reasons, faces: r.faces, observations: r.observations })),
    }, null, 2));
  } else {
    for (const warning of warnings) console.error(`warn: ${warning}`);
    for (const entry of fixed) console.log(`FIXED ${entry}`);
    for (const name of stale) console.error(`STALE ${name} (baseline case not in corpus)`);
    if (update) {
      console.log(`${CASES.length} cases, ${totalFailures} known failures, baseline updated`);
    } else {
      for (const entry of added) {
        const name = entry.split(" ")[0];
        const reason = entry.slice(name.length + 1) as FailCode;
        const result = results.find((r) => r.name === name);
        const face = result?.faces[FACE_OF[reason]];
        const detail = face?.detail ?? (reason === "cli-error" ? result?.faces.dts.detail : undefined);
        console.log(`NEW ${entry}${detail ? `\n  ${detail.split("\n").join("\n  ")}` : ""}`);
      }
      console.log(`${CASES.length} cases, ${knownFailures} known failures, ${added.length} new`);
      if (added.length === 0 && stale.length === 0 && fixed.length > 0) {
        console.log("baseline can shrink: run `pnpm run face:matrix --update`");
      }
    }
  }

  if (update) writeBaseline(results);
  return exitCode;
}

process.exitCode = main();
