/**
 * 注解解析读盘 memo 的**失效**纪律。
 *
 * `type-annotation-resolve.ts` 的源码 memo 与 `ts-annotation.ts` 的跨文件类型
 * 声明表 memo 此前只按（路径, 源码）缓存且永不失效 ⇒ 长驻进程（LSP）里被
 * 导入的类型声明文件改了，入口注解仍按旧声明映射。现在：
 *
 * - `readSource` 每次读取先 stat（签名 `mtimeMs:size`），stat 失败 / 文件
 *   消失一律按「变了」重读；
 * - 跨文件声明表的 memo 命中后校验被导入文件签名，任一变化整表重算。
 *
 * Invariants:
 * - 同进程内改被导入文件 ⇒ 经公开 `annotationEnvForFile` 重取得到新表
 *   （文本表 / 节点表 / inline import 表一起更新）；
 * - 被导入文件未变 ⇒ 命中 memo（同一张表对象，行为与缓存前一致）；
 * - 被导入文件消失 ⇒ 表里不再有它的声明。
 *
 * 已知局限（不在本文件钉）：签名粒度 `mtimeMs:size`——同 tick 且大小不变的
 * 写入会漏判；首次解析 miss 的说明符不在失效键里；LSP 未保存缓冲区里的
 * 依赖改动不在范围。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { formatAbs, parseSource } from "@nudojs/core";
import { absTypeForTsAnnotation } from "@nudojs/core/internal";
import { annotationEnvForFile, declaredReturnAbsFor } from "../ts-annotation.ts";
import { typeAnnotationSourceOf } from "../type-annotation-resolve.ts";

const USER_V1 = "export interface User {\n  name: string;\n}\n";
// 大小不同：不依赖 mtime 的亚毫秒粒度。
const USER_V2 = "export interface User {\n  name: string;\n  age: number;\n}\n";

const MOD = [
  'import type { User } from "./types.ts";',
  "export function greet(u: User): string {",
  "  return u.name;",
  "}",
  "export function who(): import(\"./types.ts\").User {",
  '  return { name: "a" };',
  "}",
  "",
].join("\n");

let dir: string;
let modPath: string;
let typesPath: string;
/** `who` 的函数节点（返回注解的节点 / 文本旁路）。 */
let whoNode: unknown;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-annotation-env-"));
  writeFileSync(join(dir, "types.ts"), USER_V1);
  writeFileSync(join(dir, "mod.ts"), MOD);
  modPath = join(dir, "mod.ts");
  typesPath = join(dir, "types.ts");
  whoNode = fnNodeOf(MOD, "who");
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

afterEach(() => {
  // 用例各自改 / 删被导入文件：统一复位，失败不串台。
  writeFileSync(typesPath, USER_V1);
});

/** 从**剥除** AST 取函数声明节点（返回注解留在 `nudoReturnTypeNode` / `nudoReturnTypeText` 旁路）。 */
function fnNodeOf(source: string, name: string): unknown {
  const ast = parseSource(source) as unknown as {
    program: { body: Array<Record<string, unknown>> };
  };
  for (const stmt of ast.program.body) {
    const d = (stmt.declaration ?? stmt) as { type?: string; id?: { name?: string } };
    if (d.type === "FunctionDeclaration" && d.id?.name === name) return d;
  }
  throw new Error(`function ${name} not found`);
}

describe("annotation env dependency invalidation", () => {
  it("re-resolves imported type tables after the imported file changes", () => {
    const before = annotationEnvForFile(MOD, modPath, "greet");
    expect(before.namedTypes?.get("User")).toContain("name: string");
    expect(before.namedTypes?.get("User")).not.toContain("age");

    writeFileSync(typesPath, USER_V2);
    const after = annotationEnvForFile(MOD, modPath, "greet");
    expect(after.namedTypes?.get("User")).toContain("age: number");

    // 映射面跟着走：形参 `User` 的声明域多出 `age` 槽。
    expect(formatAbs(absTypeForTsAnnotation({ text: "User" }, before, MOD)!)).not.toContain(
      "age",
    );
    expect(formatAbs(absTypeForTsAnnotation({ text: "User" }, after, MOD)!)).toContain("age");
  });

  it("keeps the same table entries while the imported file is unchanged", () => {
    const first = annotationEnvForFile(MOD, modPath);
    const second = annotationEnvForFile(MOD, modPath);
    // 命中 memo：inline import 表是同一对象；同文件合并后的具名表逐项同一
    // （文本串 / 声明节点都没有重摊）。
    expect(second.importTypes).toBe(first.importTypes);
    expect(second.namedTypes?.get("User")).toBe(first.namedTypes?.get("User"));
    expect(second.namedTypeNodes?.get("User")).toBe(first.namedTypeNodes?.get("User"));
  });

  it("invalidates the inline import tables together with the named ones", () => {
    const key = "./types.ts#User";
    expect(annotationEnvForFile(MOD, modPath).importTypes?.get(key)).not.toContain("age");

    writeFileSync(typesPath, USER_V2);
    const changed = annotationEnvForFile(MOD, modPath);
    expect(changed.importTypes?.get(key)).toContain("age: number");
    // inline import 的**节点**表：`import("./types.ts").User` 按节点映射到新声明。
    const inline = absTypeForTsAnnotation(
      { text: 'import("./types.ts").User' },
      changed,
      MOD,
    )!;
    expect(formatAbs(inline)).toContain("age");
  });

  it("refreshes the declared return abs of an importing function", () => {
    const v1 = formatAbs(declaredReturnAbsFor(whoNode, MOD, modPath, "who")!);
    expect(v1).not.toContain("age");

    writeFileSync(typesPath, USER_V2);
    expect(formatAbs(declaredReturnAbsFor(whoNode, MOD, modPath, "who")!)).toContain("age");

    // 改回去 ⇒ 再按新内容重算（不是只认「变大」）。
    writeFileSync(typesPath, USER_V1);
    expect(formatAbs(declaredReturnAbsFor(whoNode, MOD, modPath, "who")!)).not.toContain("age");
  });

  it("treats a vanished imported file as changed", () => {
    expect(annotationEnvForFile(MOD, modPath).namedTypes?.has("User")).toBe(true);

    rmSync(typesPath);
    const gone = annotationEnvForFile(MOD, modPath);
    expect(gone.namedTypes?.has("User") ?? false).toBe(false);
    expect(gone.importTypes?.size ?? 0).toBe(0);
    expect(typeAnnotationSourceOf("./types.ts", modPath)).toBeUndefined();

    writeFileSync(typesPath, USER_V1);
    expect(annotationEnvForFile(MOD, modPath).namedTypes?.has("User")).toBe(true);
  });

  it("re-reads a source whose signature changed (typeAnnotationSourceOf)", () => {
    expect(typeAnnotationSourceOf("./types.ts", modPath)).toBe(USER_V1);

    // 目录换文件：不是普通文件 ⇒ 按变了处理。
    const kindsPath = join(dir, "kinds.ts");
    mkdirSync(kindsPath);
    expect(typeAnnotationSourceOf("./kinds.ts", modPath)).toBeUndefined();

    rmSync(kindsPath, { recursive: true });
    writeFileSync(kindsPath, "export type Kind = \"a\" | \"b\";\n");
    expect(typeAnnotationSourceOf("./kinds.ts", modPath)).toContain("Kind");
  });

  it("yields no import tables for a source without a file path", () => {
    const env = annotationEnvForFile(MOD);
    expect(env.namedTypes?.size ?? 0).toBe(0);
    expect(env.importTypes?.size ?? 0).toBe(0);
  });
});
