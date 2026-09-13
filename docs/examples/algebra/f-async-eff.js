// 示例 F：异步效应链
// 考察：eff("promise") 的引入/消除；@nudo:mock 替换内置 API（fetch 无真实 I/O）
//
// loadUser(42)：case 头为 Promise<unknown>（形参 unknown），abs 走 mock 闭包
// → promise<{ id: 1, name: "ada" }> #path：fetch 返回 { ok: true, json: fn }，
// res.ok=true 使 throw 分支不可达；res.json() 经 mock 闭包求值

// @nudo:mock fetch = (url) => ({ ok: true, json: () => ({ id: 1, name: "ada" }) })

async function loadUser(id) {
  const res = await fetch(`/users/${id}`);
  if (!res.ok) throw new Error("fail");
  return res.json();
}

loadUser(42);

export { loadUser };
