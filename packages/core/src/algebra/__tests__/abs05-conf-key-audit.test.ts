/**
 * ABS-05：`conf` 与缓存键审计。
 *
 * 审计表（2026-11-10 核查；文件 / 消费方 / 依赖 conf / 处理）：
 *
 * | 键面                          | 消费方                                   | 依赖 conf | 处理 |
 * |-------------------------------|------------------------------------------|-----------|------|
 * | `absKey`                      | join 去重 / obj 槽相等 / env 声明去重     | 否（结构相等口径） | 默认键**不加** conf（逐字节不变） |
 * | `relationFingerprint`         | relationFn 指纹（shape 级关系）           | 否 | 保持 |
 * | `instantiateMemoKey`          | generalize 的 instantiate memo             | **是**（identity 函数把 #widened 实参跑成 #exact） | 改用 `absKeyWithConf`（含嵌套 conf 摘要） |
 * | `checkMemoKey`                | `checkSource` 整文件 memo / 磁盘缓存       | 否（键 = 源码 + 配置 + 依赖/侧车指纹） | 保持 |
 * | `pureValueKey`                | `@nudo:pure` 值基记忆化                     | 否（值语义键） | 保持 |
 * | `analysisFileCacheKey`        | service 文件级缓存                         | 否 | 保持 |
 *
 * 纪律：精度敏感的「结果继承输入置信度」共享必须用 `absKeyWithConf`；
 * 结构相等 / join 去重不得改默认 `absKey`（会破坏既有去重面）。
 */
import { describe, it, expect } from "vitest";
import { abs as makeAbs, type Abs } from "../abs.ts";
import { v } from "../term.ts";
import { absKey, absKeyWithConf } from "../key/abs-key.ts";
import { instantiateMemoKey } from "../key/generalize-key.ts";
import { generalizeFromAst } from "../generalize.ts";
import { formatAbs } from "../format/format.ts";
import { checkSource, serializeCheckJson } from "../index.ts";
import { resetCheckSourceMemo } from "../check/check.ts";

function prim(conf: Abs["conf"], term = v("x")): Abs {
  return makeAbs({ k: "prim", type: "number" }, term, undefined, conf);
}

describe("ABS-05 absKey 不含 conf（默认键逐字节不变）", () => {
  it("只差 conf 的 Abs ⇒ 同一默认键", () => {
    const a = absKey(prim("exact"));
    const b = absKey(prim("widened"));
    const c = absKey(prim("mock"));
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("absKeyWithConf 区分顶层 conf", () => {
    expect(absKeyWithConf(prim("exact"))).not.toBe(absKeyWithConf(prim("widened")));
    expect(absKeyWithConf(prim("exact"))).not.toBe(absKeyWithConf(prim("mock")));
  });

  it("absKeyWithConf 区分**嵌套** conf（元素域 / 字段域）", () => {
    const arr = (conf: Abs["conf"]): Abs =>
      makeAbs({ k: "arr", element: prim(conf) }, v("xs"), undefined, "exact");
    expect(absKey(arr("exact"))).toBe(absKey(arr("widened")));
    expect(absKeyWithConf(arr("exact"))).not.toBe(absKeyWithConf(arr("widened")));
    const obj = (conf: Abs["conf"]): Abs =>
      makeAbs(
        { k: "obj", slots: { a: { value: prim(conf) } } },
        v("o"),
        undefined,
        "exact",
      );
    expect(absKey(obj("exact"))).toBe(absKey(obj("widened")));
    expect(absKeyWithConf(obj("exact"))).not.toBe(absKeyWithConf(obj("widened")));
  });

  it("同 conf 同结构 ⇒ 同键（缓存仍可命中）", () => {
    expect(absKeyWithConf(prim("path"))).toBe(absKeyWithConf(prim("path")));
  });
});

describe("ABS-05 instantiate memo 用带 conf 的键（修消费方，不扩大默认键）", () => {
  it("identity 函数：实参 conf 不再被缓存顶替（#widened / #mock 不冒充 #exact）", () => {
    const g = generalizeFromAst("f", `export function f(x) { return x; }`)!;
    const rExact = g.instantiate([prim("exact")]);
    const rWidened = g.instantiate([prim("widened")]);
    const rMock = g.instantiate([prim("mock")]);
    expect(rExact.conf).toBe("exact");
    expect(rWidened.conf).toBe("widened");
    expect(rMock.conf).toBe("mock");
    expect(formatAbs(rWidened)).toContain("#widened");
    // 同 conf 重复调用仍命中（对象身份共享 = memo 生效）
    expect(g.instantiate([prim("exact")])).toBe(rExact);
  });

  it("instantiateMemoKey 对嵌套 conf 也区分（args 键全文可判）", () => {
    const arr = (conf: Abs["conf"]): Abs =>
      makeAbs({ k: "arr", element: prim(conf) }, v("xs"), undefined, "exact");
    const k1 = instantiateMemoKey([arr("exact")], { op: "true" });
    const k2 = instantiateMemoKey([arr("widened")], { op: "true" });
    expect(k1.key).not.toBe(k2.key);
  });
});

describe("ABS-05 冷/暖等价（check memo）", () => {
  const source = `
export function add(a, b) { return a + b; }
export function id(x) { return x; }
`;

  it("同一源码冷跑与热跑（memo 命中）的 CheckJson 逐字节一致", () => {
    resetCheckSourceMemo();
    const cold = checkSource("/t/abs05.js", source, undefined, { entryThrows: "off" });
    const warm = checkSource("/t/abs05.js", source, undefined, { entryThrows: "off" });
    expect(JSON.stringify(serializeCheckJson(warm))).toBe(
      JSON.stringify(serializeCheckJson(cold)),
    );
    // 诊断 / 签名条数一致（逐字节已涵盖；这里给出可读证据）
    expect(warm.issues.length).toBe(cold.issues.length);
    expect(warm.signatures.map((s) => s.display)).toEqual(
      cold.signatures.map((s) => s.display),
    );
  });
});
