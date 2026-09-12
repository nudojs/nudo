// 示例 A：spread 配置对象
// 考察：多态 call-site 保留字面量；函数 join 是签名并（重载）
//
// 期望（多态）：
//   c1 → { host: "localhost", port: 3000, debug: true }          #exact
//   c2 → { host: "localhost", port: 8080, debug: false }         #exact
//   c3 → { host: "api.example.com", port: 8080, debug: false }   #exact
// combined 签名：函数类型的并（重载），不是 (P1|P2|P3)=>(R1|R2|R3)
//   | (({port:3000,debug:true}) => {host:"localhost",port:3000,debug:true})
//   | (({}) => {host:"localhost",port:8080,debug:false})
//   | (({host:"api.example.com"}) => {host:"api.example.com",port:8080,debug:false})
// generalize：
//   ∀ω. (ω) → Merge(defaults, ω)

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

module.exports = { createConfig };
