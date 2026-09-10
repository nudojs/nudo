// 示例 F：异步效应链
// 考察：eff("promise") 的引入/消除；throws；mock/harvest 置信度

async function loadUser(id) {
  const res = await fetch(`/users/${id}`);
  if (!res.ok) throw new Error("fail");
  return res.json();
}

// loadUser(42) → eff(promise, body) throws Error
// 若 json 仅 harvest 为 unknown → confidence #partial/#mock

module.exports = { loadUser };
