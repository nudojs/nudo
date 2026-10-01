/**
 * docusaurus.config.ts 里 DefinePlugin 注入的构建期常量（webpack 字面量替换）。
 * 运行时并不存在这些全局变量——消费方必须用 `typeof` 守卫。
 */
declare const __NUDO_ENGINE_VERSION__: string;
declare const __NUDO_DOCS_COMMIT__: string;
