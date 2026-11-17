/**
 * 审计 34 · `.ts` 构造器注解（含参数属性）不进实例字段域。
 *
 * 症状：`constructor(private size: number)` + `area() { return this.size *
 * this.size }` ⇒ check 面 `Box.area() => number throws TypeError`（error 级
 * 假红），而 dts 面写着 `size: number` —— 同一份源码两面结论相反。
 *
 * 根因：类方法桥的构造实参一律补 `any`（`ctorAnyArgs`），而构造器体
 * `this.size = size` 正是实例槽的写入点 ⇒ 槽值 any ⇒ 方法体读 `this.size`
 * 得到 any ⇒ 算术升级成 ToNumber 强制转换 ⇒ may-throw。
 *
 * 修法：构造实参按**构造器形参注解**构造（`ctorParamAbsArgs`，与类入口签名
 * 面同源）——注解即域；无注解仍补 any。
 *
 * 本文件是一变量对照：同样的类，只改「注解有无 / 注解是否可映射」。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-b020-"));
  dirs.push(dir);
  for (const [name, src] of Object.entries(files)) writeFileSync(join(dir, name), src, "utf-8");
  return dir;
}

type Sig = {
  name: string;
  display: string;
  paramTypes: string[];
  throws?: string;
};

function check(dir: string, file: string): {
  errors: number;
  sigs: Sig[];
  codes: string[];
} {
  const r = runCliTsx(["check", join(dir, file), "--json"]);
  const json = JSON.parse(r.stdout) as {
    summary?: { errors?: number };
    signatures?: Sig[];
    issues?: Array<{ code: string; severity: string }>;
  };
  return {
    errors: json.summary?.errors ?? -1,
    sigs: json.signatures ?? [],
    codes: (json.issues ?? [])
      .filter((i) => i.severity === "error")
      .map((i) => i.code),
  };
}

function sigOf(sigs: Sig[], name: string): Sig | undefined {
  return sigs.find((s) => s.name === name);
}

const AREA = "area() { return this.n * 2; }";

describe("构造器注解即实例字段域", () => {
  it("参数属性 `private n: number` + 算术 ⇒ 0 error、返回 number", () => {
    const dir = fixture({
      "p.ts": `export class C { constructor(private n: number, readonly tag: string) {} ${AREA} }\n`,
    });
    const r = check(dir, "p.ts");
    expect(r.errors).toBe(0);
    expect(sigOf(r.sigs, "C.area")?.display).toBe("number");
    // 签名面形参仍是注解（不是被实例桥改写成 any）
    expect(sigOf(r.sigs, "C")?.paramTypes).toEqual(["number", "string"]);
  }, 60000);

  it("普通构造器形参注解 `n: number` + getter 读字段 ⇒ number（不是 any）", () => {
    const dir = fixture({
      "g.ts": "export class K { constructor(n: number) { this.n = n; } getSize() { return this.n; } }\n",
    });
    const r = check(dir, "g.ts");
    expect(r.errors).toBe(0);
    expect(sigOf(r.sigs, "K.getSize")?.display).toBe("number");
  }, 60000);

  it("对照：`.js` 构造器无注解 + 同一算术 ⇒ 仍按 any 规则报（不过修）", () => {
    const dir = fixture({
      "a.js": `export class C { constructor(n) { this.n = n; } ${AREA} }\n`,
    });
    const r = check(dir, "a.js");
    expect(r.errors).toBeGreaterThan(0);
    expect(r.codes).toContain("nudo:entry-may-throw");
    expect(sigOf(r.sigs, "C")?.paramTypes).toEqual(["any"]);
  }, 60000);

  it("对照：注解不可映射（私有类类型）⇒ 实参仍是 any（不猜）", () => {
    const dir = fixture({
      "o.ts": [
        "class Hidden { x = 1; }",
        "export class C { constructor(h: Hidden) { this.h = h; } poke() { return this.h.x; } }",
        "",
      ].join("\n"),
    });
    const r = check(dir, "o.ts");
    expect(sigOf(r.sigs, "C")?.paramTypes).toEqual(["any"]);
  }, 60000);

  it("反向：注解 number 却调 `.toUpperCase()` ⇒ 真实 TypeError 不被吞", () => {
    const dir = fixture({
      "bad.ts":
        "export class C { constructor(n: number) { this.n = n; } bad() { return this.n.toUpperCase(); } }\n",
    });
    const r = check(dir, "bad.ts");
    expect(r.errors).toBeGreaterThan(0);
    expect(sigOf(r.sigs, "C.bad")?.throws).toBe("TypeError");
  }, 60000);

  it("类体初始化器与构造器注解同时存在时，两处写入都不丢域", () => {
    const dir = fixture({
      "both.ts": [
        "export class C {",
        "  m = 1;",
        "  constructor(n: number) { this.n = n; }",
        "  sum() { return this.m + this.n; }",
        "}",
        "",
      ].join("\n"),
    });
    const r = check(dir, "both.ts");
    expect(r.errors).toBe(0);
    expect(sigOf(r.sigs, "C.sum")?.display).toBe("number");
  }, 60000);
});
