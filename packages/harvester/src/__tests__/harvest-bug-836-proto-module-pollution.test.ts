/**
 * Bug 836 回归（harvester 收割面）：`declare module "__proto__"` 让收割器把导出
 * 直接写到 **`Object.prototype`** 上 ⇒ **进程级原型污染**（分析进程里每个普通
 * 对象都多出该成员）+ 该模块记录从表里**消失**。
 *
 * oracle：原生 Node —— 未收割的进程里 `({}).polluted === undefined`、
 * `Object.prototype` 没有 "polluted"（tmp/probe/fix-r27/h6/native-proto.mjs）。
 *
 * 契约：
 *   1. 收割**不得**污染 `Object.prototype` / `globalThis` / 其它普通对象；
 *   2. 模块记录**必须仍在表里**（`env.modules` 的自有键含 "__proto__"）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { harvestDts, emitEnvModule } from "../harvest-dts.ts";

const dirs: string[] = [];
const generatedFiles: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  for (const f of generatedFiles) rmSync(f, { force: true });
});

function writeTemp(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug836-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

const fx = writeTemp(
  "fx.d.ts",
  `declare module "__proto__" {
  export declare function polluted(): string;
}

declare module "constructor" {
  export declare function polluted2(): string;
}
`,
);

/**
 * 收割**放在测试体内**（不放在模块顶层）：修复前收割会污染 `Object.prototype`，
 * 若在模块顶层发生，测试文件自身会在加载期被污染打挂（连断言都跑不到）。
 */
let cached: { env: ReturnType<typeof harvestDts>; code: string } | undefined;
function harvest(): { env: ReturnType<typeof harvestDts>; code: string } {
  if (!cached) {
    const env = harvestDts([fx]);
    cached = { env, code: emitEnvModule(env, "fx") };
  }
  return cached;
}

describe("Bug 836 — declare module \"__proto__\" 不得造成进程级原型污染", () => {
  it("收割后 Object.prototype / globalThis / 普通对象都没被污染", () => {
    harvest();
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
    expect(({} as Record<string, unknown>)["polluted2"]).toBeUndefined();
    expect(Object.hasOwn(Object.prototype, "polluted")).toBe(false);
    expect(Object.hasOwn(Object.prototype, "polluted2")).toBe(false);
    expect((globalThis as unknown as Record<string, unknown>)["polluted"]).toBeUndefined();
    expect((globalThis as unknown as Record<string, unknown>)["polluted2"]).toBeUndefined();
  });

  it("被污染的模块记录仍在表里（没有消失）", () => {
    const { env } = harvest();
    expect(Object.hasOwn(env.modules, "__proto__")).toBe(true);
    const rec = env.modules["__proto__"] as unknown as Record<string, { shape?: { k: string } }>;
    expect(rec).toBeTruthy();
    expect(Object.keys(rec)).toEqual(["polluted"]);
    expect(rec["polluted"]?.shape?.k).toBe("fn");
    // 同族：模块名 "constructor" 也不得消失（修复前命中 Object 构造函数）
    expect(Object.hasOwn(env.modules, "constructor")).toBe(true);
    const ctor = env.modules["constructor"] as unknown as Record<string, { shape?: { k: string } }>;
    expect(Object.keys(ctor)).toEqual(["polluted2"]);
    expect(ctor["polluted2"]?.shape?.k).toBe("fn");
  });

  it("落盘面用计算属性名写 __proto__（不改写原型）", () => {
    const { code } = harvest();
    expect(code).toContain('["__proto__"]');
    // 不得出现裸的 `__proto__:` 键（对象字面量里会触发 [[SetPrototypeOf]]）
    expect(/^\s*__proto__:/m.test(code)).toBe(false);
  });

  it("落盘产物求值后仍是自有键，且不污染原型", async () => {
    const { code } = harvest();
    const generatedPath = fileURLToPath(
      new URL("./generated-env-bug836.tmp.ts", import.meta.url),
    );
    writeFileSync(generatedPath, code, "utf-8");
    generatedFiles.push(generatedPath);
    const mod = await import("./generated-env-bug836.tmp.ts");
    const evaluated = mod.defineEnv();
    expect(Object.hasOwn(evaluated.modules, "__proto__")).toBe(true);
    expect(Object.hasOwn(evaluated.modules["__proto__"]!, "polluted")).toBe(true);
    expect(Object.getPrototypeOf(evaluated.modules)).toBe(Object.prototype);
    // 求值过程同样不得污染进程
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
    expect(Object.hasOwn(Object.prototype, "polluted")).toBe(false);
  });
});
