/**
 * LSP-G8 / Docusaurus v4 prep: upstream may relocate
 * `CodeBlock/Content/String` → `CodeBlock/String`.
 * This shim keeps one import path for the rest of the swizzle.
 */
export { default } from './Content/String';
export type { Props } from '@theme/CodeBlock/Content/String';
