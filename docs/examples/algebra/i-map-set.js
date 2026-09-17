// 示例 I：Map / Set 字面量条目追踪（C1）
// 考察：m.set("k", v) 成对出现后 m.get("k") 精确回查；
// Set 构造从数组填元素，for-of / Array.from 取到元素联合。
//
// 逐 case 真值（infer 输出）：
//   lookup("alice")      → { id: "alice", name: "Alice" }  #exact
//   dedup([1, 2, 2, 3])  → [1, 2, 2, 3]（Set 保元素；未做去重语义）
//
// 边界形态：
//   已建模：Map 字面量 key → value；Set 元素 from iterable
//   保守：Map.get 非字面量 key → 已知 value 并集

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
