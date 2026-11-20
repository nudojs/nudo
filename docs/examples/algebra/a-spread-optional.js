// 示例 A：spread 配置对象
// 考察：多态 call-site 保留字面量；Combined 是逐调用点结果的字面量并
//
// 逐调用点（infer 输出的 case 头，即真值）：
//   createConfig({ port: 3000, debug: true })
//     → { host: "localhost", port: 3000, debug: true }          #exact
//   createConfig({})
//     → { host: "localhost", port: 8080, debug: false }         #exact
//   createConfig({ host: "api.example.com" })
//     → { host: "api.example.com", port: 8080, debug: false }   #exact
// Combined：三个结果的观测并（不是函数重载）；`--format dts` 生成单一签名：
//   参数形状是逐调用点的拓宽并，返回位按观测拓宽到基类型
//   （host: string / port: number / debug: boolean），逐点字面量只留在 JSDoc
//   Case 行（观测值 ≠ 函数类型）。
// generalize（intension 行）：(options) => { host, port, debug } 默认形状

function createConfig(options) {
  return {
    host: "localhost",
    port: 8080,
    debug: false,
    ...options,
  };
}

createConfig({ port: 3000, debug: true });
createConfig({});
createConfig({ host: "api.example.com" });

export { createConfig };

// 返回位是观测的拓宽（host: string / port: number / debug: boolean）；
// 每个调用点的精确字面量只保留在导出产物的 JSDoc `Case:` 行。
