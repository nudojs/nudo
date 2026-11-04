/**
 * A6：fn 形状的重载集承载位（`overloads`）——派发精化，不是赋值语义。
 *
 * 契约（见 abs.ts 的 fn shape 注释）：
 * 1. `instantiateReturn` 在实参**唯一按声明序命中**某 arm（同元数 + 逐参 leq）
 *    时用该 arm 的返回位；零命中回落 union 返回面（不新造 may-throw）。
 * 2. `overloads` 是 Abs 数据 ⇒ subst/snapshot 必须搬运（α 替换 / 等价副本）。
 * 3. `absKey` 区分不同重载集（memo/fingerprint 不得串）。
 * 4. union 面（paramTypes/returnType）仍是权威外延面：leq/展示不读 overloads。
 */
import { describe, it, expect } from "vitest";
import { abs, num, str, numLit, strLit, boolLit, unknown } from "../abs.ts";
import type { Abs } from "../abs.ts";
import { absKey } from "../abs-key.ts";
import { instantiateReturn, snapshotAbs, substAbs } from "../hof.ts";
import { getFnImpl, relationFn } from "../abs-fn.ts";
import { v as varTerm } from "../term.ts";
import { pTrue } from "../pred.ts";

function numAbs(): Abs {
  return num();
}
function strAbs(): Abs {
  return str();
}

/** convert(x: string): string; convert(x: number): number */
function overloadedConvert(): Abs {
  const arms = [
    { paramTypes: [strAbs()], returnType: strAbs() },
    { paramTypes: [numAbs()], returnType: numAbs() },
  ];
  return abs(
    {
      k: "fn",
      params: ["x"],
      paramTypes: [abs({ k: "sum", members: [strAbs(), numAbs()] }, undefined, undefined, "exact")],
      returnType: abs({ k: "sum", members: [strAbs(), numAbs()] }, undefined, undefined, "exact"),
      overloads: arms,
    },
    varTerm("convert"),
    pTrue,
    "path",
  );
}

describe("A6: fn overloads 承载位", () => {
  it("按实参选臂（声明序首个命中）：number 实参 ⇒ number arm 返回", () => {
    const r = instantiateReturn(overloadedConvert(), [numLit(1)]);
    expect(absKey(r)).toBe(absKey(numAbs()));
  });

  it("按实参选臂：string 实参 ⇒ string arm 返回", () => {
    const r = instantiateReturn(overloadedConvert(), [strLit("a")]);
    expect(absKey(r)).toBe(absKey(strAbs()));
  });

  it("零命中 ⇒ 回落 union 返回面（不新造 may-throw）", () => {
    const r = instantiateReturn(overloadedConvert(), [boolLit(true)]);
    expect(r.shape.k).toBe("sum");
  });

  it("元数不匹配 ⇒ 回落 union 面", () => {
    const r = instantiateReturn(overloadedConvert(), [numLit(1), numLit(2)]);
    expect(r.shape.k).toBe("sum");
  });

  it("泛型 arm：T => T，实参 number ⇒ 返回 number", () => {
    const tv = varTerm("T");
    const generic: Abs = abs(
      {
        k: "fn",
        params: ["x"],
        paramTypes: [abs({ k: "any" }, tv, pTrue, "path")],
        returnType: abs({ k: "any" }, tv, pTrue, "path"),
        overloads: [
          {
            paramTypes: [abs({ k: "any" }, tv, pTrue, "path")],
            returnType: abs({ k: "any" }, tv, pTrue, "path"),
          },
          { paramTypes: [strAbs()], returnType: strAbs() },
        ],
      },
      varTerm("id"),
      pTrue,
      "path",
    );
    const r = instantiateReturn(generic, [numLit(7)]);
    // 泛型 T 绑定到实参本身（lit 7），不是拓宽后的 prim
    expect(absKey(r)).toBe(absKey(numLit(7)));
  });

  it("substAbs 按 map 替换 arm 内的 α（overloads 是 Abs 数据）", () => {
    const tv = varTerm("E");
    const fn: Abs = abs(
      {
        k: "fn",
        params: ["x"],
        paramTypes: [abs({ k: "arr", element: abs({ k: "any" }, tv, pTrue, "path") }, undefined, undefined, "path")],
        returnType: abs({ k: "any" }, tv, pTrue, "path"),
        overloads: [
          {
            paramTypes: [
              abs({ k: "arr", element: abs({ k: "any" }, tv, pTrue, "path") }, undefined, undefined, "path"),
            ],
            returnType: abs({ k: "any" }, tv, pTrue, "path"),
          },
          { paramTypes: [numAbs()], returnType: numAbs() },
        ],
      },
      varTerm("first"),
      pTrue,
      "path",
    );
    const substituted = substAbs(fn, new Map([["E", numAbs()]]));
    if (substituted.shape.k !== "fn") throw new Error("expected fn");
    const arm = substituted.shape.overloads![0]!;
    expect(absKey(arm.returnType)).toBe(absKey(numAbs()));
  });

  it("snapshotAbs 深拷贝 overloads（等价副本，不共享 arm 数组）", () => {
    const fn = overloadedConvert();
    const snap = snapshotAbs(fn);
    if (fn.shape.k !== "fn" || snap.shape.k !== "fn") throw new Error("expected fn");
    expect(snap.shape.overloads).toHaveLength(2);
    expect(snap.shape.overloads).not.toBe(fn.shape.overloads);
    expect(snap.shape.overloads![0]!.paramTypes).not.toBe(
      fn.shape.overloads![0]!.paramTypes,
    );
    expect(absKey(snap)).toBe(absKey(fn));
  });

  it("snapshotAbs 搬运 fn impl（A7 镜像：快照不得退化为 shape-only）", () => {
    // relationFn 挂 impl（relation 槽 + fingerprint）；快照必须保留
    const rel = relationFn([numAbs()], strAbs(), { throws: numAbs() });
    const snap = snapshotAbs(rel);
    const impl = getFnImpl(snap);
    expect(impl).toBeDefined();
    expect(impl!.relation?.returnType).toBeDefined();
    expect(absKey(impl!.relation!.returnType)).toBe(absKey(strAbs()));
  });

  it("absKey 区分不同重载集（同 union 面、不同 arm ⇒ 不同 key）", () => {
    const base = overloadedConvert();
    if (base.shape.k !== "fn") throw new Error("expected fn");
    const swapped: Abs = abs(
      {
        ...base.shape,
        overloads: [
          { paramTypes: [numAbs()], returnType: numAbs() },
          { paramTypes: [strAbs()], returnType: strAbs() },
        ],
      },
      base.term,
      base.pred,
      base.conf,
    );
    expect(absKey(swapped)).not.toBe(absKey(base));
    // 无 overloads 的同形 fn 与有 overloads 的 key 不同
    const { overloads: _drop, ...plainShape } = base.shape;
    const plain = abs(plainShape, base.term, base.pred, base.conf);
    expect(absKey(plain)).not.toBe(absKey(base));
  });

  it("unknown 返回 arm 不参与（半截签名不发明派发）", () => {
    const fn: Abs = abs(
      {
        k: "fn",
        params: ["x"],
        paramTypes: [numAbs()],
        returnType: unknown,
        overloads: [
          { paramTypes: [numAbs()], returnType: unknown },
          { paramTypes: [strAbs()], returnType: strAbs() },
        ],
      },
      varTerm("f"),
      pTrue,
      "path",
    );
    const r = instantiateReturn(fn, [numLit(1)]);
    // 首个命中 arm 的返回是 unknown —— 这是诚实值，不回落也不发明
    expect(absKey(r)).toBe(absKey(unknown));
  });
});
