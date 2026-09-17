// 示例 E：索引投影
// 考察：对象形状 + 字面量 key → 按槽位精确投影；形状来自字面量即精确，
// 与对象是否扮演 "env" 角色无关
//
//   pick({ a: 1, b: "x" }, "a")  → 1          #exact
//   pick({ a: 1, b: "x" }, "b")  → "x"        #exact
//   pick(env, "PATH")            → "/usr/bin" #exact
//   Combined: 1 | "x" | "/usr/bin"
//
// 边界：动态 key（符号 string）→ 保守并集所有槽（不再 unknown）
//   pickDynamic({ a: 1, b: "x" }, T.string) → 1 | "x"  #exact

function pick(obj, key) {
  return obj[key];
}

pick({ a: 1, b: "x" }, "a");
pick({ a: 1, b: "x" }, "b");

const env = { PATH: "/usr/bin", HOME: "/root" };
pick(env, "PATH");

/**
 * @nudo:case "dynamic key" ({ a: 1, b: "x" }, T.string)
 */
function pickDynamic(obj, key) {
  return obj[key];
}

export { pick, pickDynamic };
