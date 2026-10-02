/**
 * BUG-001 回归：原型链裸查找（导出面 / 槽位表）。
 *
 * 导出名或槽位键为 Object.prototype 成员（toString / constructor /
 * hasOwnProperty / valueOf…）且目标无同名自有属性时：
 *   - 裸 `slots[key]` / `named[name]` 命中宿主原型方法（truthy 函数）
 *   - `fnName in exports` 把继承名当真实导出
 * 轻则把原型方法当导出调用伪造结果，重则宿主 TypeError 打穿 fail-closed。
 * 统一口径：跨来源 key 的槽位/导出读取必须走自有属性语义
 * （core 内 slots 用 getSlot，导出表用 Object.hasOwn）。
 */
import { describe, it, expect } from "vitest";
import {
  $idx,
  $lit,
  abs,
  bindImports,
  callTranspiledExportFull,
  instantiateReturn,
  litValue,
  numLit,
  objOf,
  relationFn,
  runTranspiled,
  v,
  type Abs,
} from "../index.ts";
import { evalThrowsOf } from "../check-may-throw.ts";
import { emptyEnv } from "../ast-env.ts";
import { collectAbsExports } from "../abs-modules.ts";
import { parseSource } from "../parse-source.ts";

function isUndef(r: Abs): boolean {
  return r.term?.op === "lit" && r.term.value === undefined;
}

// --- hof.ts bindTypeVars：pattern 槽键 × 实参槽表（getSlot 语义） ---

describe("bindTypeVars: pattern obj 槽键命中 Object.prototype 名", () => {
  const tVar = () => abs({ k: "any" }, v("T"), undefined, "path");
  const pattern = abs(
    {
      k: "obj",
      slots: { toString: { value: tVar() }, id: { value: tVar() } },
    },
    undefined,
    undefined,
    "path",
  );
  const fn = relationFn([pattern], tVar());

  it("实参无同名自有槽：不抛宿主 TypeError，且不误绑", () => {
    const arg = abs(
      { k: "obj", slots: { id: { value: numLit(1) } } },
      undefined,
      undefined,
      "exact",
    );
    // 修复前：as.slots["toString"] → Object.prototype.toString（truthy）→
    // aSlot.value=undefined → T 绑到 undefined → substAbs 读 repl.shape 抛 TypeError
    expect(() => instantiateReturn(fn, [arg])).not.toThrow();
    expect(litValue(instantiateReturn(fn, [arg]))).toEqual({ ok: true, value: 1 });
  });

  it("实参有同名自有槽：仍正常绑定（首个绑定保留）", () => {
    const arg = abs(
      {
        k: "obj",
        slots: { toString: { value: numLit(2) }, id: { value: numLit(1) } },
      },
      undefined,
      undefined,
      "exact",
    );
    expect(litValue(instantiateReturn(fn, [arg]))).toEqual({ ok: true, value: 2 });
  });
});

// --- containers.ts $idx：闭 shape 字面量键 miss 不得踩原型 ---

describe("$idx: obj 计算成员访问 Object.prototype 名键", () => {
  it("闭 shape 无同名自有槽 → exact undefined 字面量", () => {
    // objOf 直接包调用方 record（普通原型）——契约/harvest 侧槽表的真实形态；
    // （$obj 是 Object.create(null)，测不出该缺口）
    const o = objOf({ id: { value: numLit(1) } });
    for (const key of ["toString", "constructor", "valueOf", "hasOwnProperty"]) {
      // 修复前：slots["toString"] 命中原型函数 → 返回裸 undefined（非 Abs）
      expect(() => $idx(o, $lit(key)), key).not.toThrow();
      expect(isUndef($idx(o, $lit(key))), key).toBe(true);
    }
    expect(litValue($idx(o, $lit("id")))).toEqual({ ok: true, value: 1 });
  });
});

// --- exec/run.ts callTranspiledExportFull：导出面按自有属性判定 ---

describe("callTranspiledExportFull: Object.prototype 名不是模块导出", () => {
  const run = runTranspiled(`export function real() { return 1; }`);

  it("constructor 不再被当导出调用（曾把首个实参原样伪造为结果）", () => {
    const r = callTranspiledExportFull(run, "constructor", [$lit(42)]);
    // 修复前：exports["constructor"] = Object → Object(arg) 原样返回实参
    expect(r.result.shape.k).toBe("unknown");
    expect(r.throws.shape.k).toBe("never");
  });

  it("hasOwnProperty 不产生伪造 throws（this=undefined 的宿主 TypeError）", () => {
    const r = callTranspiledExportFull(run, "hasOwnProperty", []);
    expect(r.result.shape.k).toBe("unknown");
    expect(r.throws.shape.k).toBe("never");
  });

  it("真实导出仍可调用", () => {
    const r = callTranspiledExportFull(run, "real", []);
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });
});

// --- check-may-throw.ts evalThrowsOf：`in` 导出门 = 自有属性语义 ---

describe("evalThrowsOf: `in` 导出存在性按自有属性判定", () => {
  it("Object.prototype 名不得按导出调用", () => {
    // 修复前：`"toString" in exports` 命中原型 → 调用 Object.prototype.toString
    expect(
      evalThrowsOf(`export function realA() { return 1; }`, "toString", []),
    ).toBeUndefined();
    expect(
      evalThrowsOf(`export function realB() { return 2; }`, "constructor", []),
    ).toBeUndefined();
  });
});

// --- abs-modules.ts bindImports：依赖导出表按自有属性读取 ---

describe("bindImports: 依赖模块缺 toString 导出 → unknown，不绑宿主原型方法", () => {
  it("imports only own exports", () => {
    const imp = {
      type: "ImportDeclaration",
      source: { value: "./m.js" },
      specifiers: [
        {
          type: "ImportSpecifier",
          local: { name: "ts" },
          imported: { type: "Identifier", name: "toString" },
        },
        {
          type: "ImportSpecifier",
          local: { name: "real" },
          imported: { type: "Identifier", name: "real" },
        },
      ],
    } as never;
    const env = emptyEnv();
    bindImports(imp, env, { "./m.js": { named: { real: numLit(1) } } });
    // 修复前：named["toString"] → Object.prototype.toString 漏进 Abs 域
    expect(env.vars.get("ts")?.shape.k).toBe("unknown");
    expect(litValue(env.vars.get("real")!)).toEqual({ ok: true, value: 1 });
  });
});

// --- abs-modules.ts modules 表：宿主模块表按自有属性读取（PR #80 F5）---

describe("abs-modules: modules 表原型名 spec → miss 分支 fail-closed", () => {
  it('bindImports: import { a } from "toString" 不抛宿主 TypeError，绑定折叠 unknown', () => {
    // 触发机制：modules 是宿主普通对象，modules["toString"] 裸读命中
    // Object.prototype.toString（truthy）→ mod.named undefined →
    // Object.hasOwn(mod.named, "a") 抛 TypeError；修复后走 miss 分支绑 unknown
    const file = parseSource(`import { a } from "toString";`);
    const env = emptyEnv();
    expect(() => bindImports(file.program.body[0] as never, env, {})).not.toThrow();
    expect(env.vars.get("a")?.shape.k).toBe("unknown");
  });

  it('collectAbsExports: export { x } from "toString" 不抛，与缺失模块同口径（槽丢弃）', () => {
    // 触发机制：re-export 同族——modules["toString"] truthy → mod.named
    // undefined → hasOwn(mod.named, "x") 抛 TypeError；修复后与表内无此模块
    // （如 "./missing.js"）行为一致：re-export 整体跳过
    const out = collectAbsExports(parseSource(`export { x } from "toString";`), emptyEnv(), {});
    expect(out.named.x).toBeUndefined();
  });
});
