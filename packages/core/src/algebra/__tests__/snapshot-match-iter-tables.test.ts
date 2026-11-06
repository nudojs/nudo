/**
 * A7 镜像一致性：`snapshotAbs` 必须把 match-iter 身份侧表随副本迁移。
 *
 * 背景：`$copy`（fork / switch 臂重绑）早有 `copyMatchIterTables`，但
 * `snapshotAbs`（`algebra/hof.ts`）此前只搬了 fn impl 侧表 ⇒ 生成器 /
 * 模板标签 / matchAll / 用户迭代器 / Proxy 的**迭代元素 / 延迟异常 /
 * 委托视图**在快照副本上整体丢失：副本消费点查不到条目 ⇒ 元素面折空、
 * definite 体异常静默丢弃（L2 假阴）、dts 元素类型退 `Generator<unknown>`。
 *
 * 2026-11-06 补上迁移。与 `$copy` 同口径：**共享视图引用**（不是深拷贝）
 * ⇒ 副本消费会推进原对象状态，见下方负控钉（这是刻意的：生成器对象
 * 是「一次消费」的有状态值，副本代表同一次创建事件，与 `copyMatchIterTables`
 * 注释里的「臂内消费」一致）。
 *
 * 依赖方向：`hof.ts`（algebra 顶层）→ `exec/match-iter.ts`（子域），后者
 * 只依赖 algebra 顶层叶子（abs / objects / may-throw），不依赖 hof ⇒ 无环。
 */
import { describe, it, expect } from "vitest";
import { numLit, type Abs } from "../abs.ts";
import { snapshotAbs } from "../hof.ts";
import { formatAbs } from "../format/format.ts";
import { $gen, $yield } from "../exec/runtime/async.ts";
import { undef } from "../exec/runtime/state.ts";
import {
  registerGenElements,
  registerGenDrain,
  registerGenDeferred,
  matchIterElements,
  genDrainViewOf,
  peekAllGenElements,
  drainGenElements,
  replayGenDeferred,
} from "../exec/match-iter.ts";

/** 真实 `$gen` 产出的生成器对象（两个 yield）。 */
function gen(): Abs {
  return $gen(() => {
    $yield(numLit(1), 0);
    $yield(numLit(2), 0);
    return undef();
  });
}

const fmtAll = (g: Abs): string =>
  (matchIterElements(g) ?? []).map((a) => formatAbs(a)).join(" | ");

describe("snapshotAbs · match-iter 侧表迁移（A7 镜像）", () => {
  it("生成器对象的迭代元素面随副本迁移（改前副本折空）", () => {
    const g = gen();
    const copy = snapshotAbs(g);
    expect(fmtAll(g)).toBe("1  #exact | 2  #exact");
    expect(fmtAll(copy), "副本仍拿得到元素").toBe("1  #exact | 2  #exact");
  });

  it("drain 视图随副本迁移 ⇒ 副本可正常消费", () => {
    const g = gen();
    const copy = snapshotAbs(g);
    expect(genDrainViewOf(copy)?.exact).toBe(true);
    expect((drainGenElements(copy) ?? []).map((a) => formatAbs(a)).join(" | ")).toBe(
      "1  #exact | 2  #exact",
    );
  });

  it("延迟异常面随副本迁移（definite 载荷不静默丢弃）", () => {
    const src = gen();
    registerGenDeferred(src, { throw: numLit(42), soft: [] });
    const copy = snapshotAbs(src);
    expect(() => replayGenDeferred(copy)).toThrow();
    // 负控：未登记 deferred 的 Abs 不抛
    expect(() => replayGenDeferred(gen())).not.toThrow();
  });

  it("手工登记的 genElements / genDrain 同样随副本迁移", () => {
    const src = snapshotAbs(gen());
    registerGenElements(src, [numLit(7), numLit(8)]);
    registerGenDrain(src, {
      drain: () => [],
      peek: () => undefined,
      peekAll: () => [],
      exact: false,
    });
    const copy = snapshotAbs(src);
    expect(fmtAll(copy)).toBe("7  #exact | 8  #exact");
    expect(genDrainViewOf(copy)?.exact).toBe(false);
  });

  it("负控：迁移共享视图引用 ⇒ 副本消费推进原对象状态（与 $copy 同口径）", () => {
    const g = gen();
    const copy = snapshotAbs(g);
    expect((peekAllGenElements(g) ?? []).length).toBe(2);
    drainGenElements(copy);
    expect((peekAllGenElements(g) ?? []).length, "原对象同步被排空").toBe(0);
  });

  it("负控：非生成器 Abs 的快照无副作用（WeakMap miss 即返回）", () => {
    const plain = snapshotAbs(numLit(3));
    expect(formatAbs(plain)).toBe("3  #exact");
    expect(fmtAll(plain)).toBe("");
  });
});
