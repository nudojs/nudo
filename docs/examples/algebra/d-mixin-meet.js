// 示例 D：spread / 槽位 meet
// 考察：两个对象形状的合并（meet）：右值覆盖同槽，其余槽位并集；
// 调用点保留字面量（exact），Combined 保留全部成员

function mixin(base, ext) {
  return { ...base, ...ext };
}

mixin({ host: "localhost", port: 8080 }, { port: 3000, debug: true });
mixin({ id: 1 }, { name: "ada" });

export { mixin };
