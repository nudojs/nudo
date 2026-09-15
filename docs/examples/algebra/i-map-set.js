// 示例 I：Map / Set 精度边界
// 考察：Map 只记录 K / V 的整体类型，不维护字面量 key → value 的映射——
// 即使 m.set("k", v) 字面量成对出现，m.get("k") 仍求值为 unknown；
// Set 的迭代器未建模，for-of 逐元素分发丢失（元素 unknown）。
//
// 逐 case 真值（infer 输出）：
//   lookup("alice")      → unknown  #partial（Map.get 字面量 key 不回查）
//   dedup([1, 2, 2, 3])  → []（case 头）· intension 侧 unknown[]——
//                          Set for-of 元素 unknown，数组形状保留但为空
//
// 边界形态（写算法前先查这张表，避免依赖未建模方法）：
//   已建模：对象字面量的字面量 key 索引投影（见 e-index-proj.js）
//   未建模：Map.get 字面量回查 / Map.has 收窄 / Set for-of 迭代

/**
 * @nudo:case "map-get" ("alice")
 */
function lookup(key) {
  const m = new Map();
  m.set("alice", { id: "alice", name: "Alice" });
  m.set("bob", { id: "bob", name: "Bob" });
  return m.get(key);
}

/**
 * @nudo:case "set-forof" ([1, 2, 2, 3])
 */
function dedup(arr) {
  const out = [];
  for (const v of new Set(arr)) out.push(v);
  return out;
}

export { lookup, dedup };
