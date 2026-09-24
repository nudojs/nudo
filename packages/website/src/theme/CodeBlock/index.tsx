import React, {isValidElement, useMemo, type ReactNode} from 'react';
import useIsBrowser from '@docusaurus/useIsBrowser';
import useBaseUrl from '@docusaurus/useBaseUrl';
import Translate from '@docusaurus/Translate';
// LSP-G8：经根级 shim 导入——Docusaurus v4 若上提 Content/*，只改 shim
import ElementContent from './Element';
import StringContent from './String';
import type {Props} from '@theme/CodeBlock';

/**
 * Best attempt to make the children a plain string so it is copyable. If there
 * are react elements, we will not be able to copy the content, and it will
 * return `children` as-is; otherwise, it concatenates the string children
 * together.
 */
function maybeStringifyChildren(children: ReactNode): ReactNode {
  if (React.Children.toArray(children).some((el) => isValidElement(el))) {
    return children;
  }
  // The children is now guaranteed to be one/more plain strings
  return Array.isArray(children) ? children.join('') : (children as string);
}

const RUNNABLE_LANGUAGES = new Set(['js', 'javascript']);

/**
 * Playground preload query for runnable code blocks.
 * Encoding mirrors /playground's decode (`decodeURIComponent(atob(raw))`);
 * blocks marked with `noplayground` meta opt out. Language comes from the
 * prism `language-<lang>` className (md fences do not pass a `language` prop).
 */
function playgroundQuery(
  className: string | undefined,
  metastring: string | undefined,
  code: string,
): string | undefined {
  const language = /language-([\w-]+)/.exec(className ?? '')?.[1];
  if (!RUNNABLE_LANGUAGES.has(language ?? '')) return undefined;
  if (metastring?.split(/\s+/).includes('noplayground')) return undefined;
  try {
    const encoded = btoa(encodeURIComponent(code));
    return `code=${encoded}`;
  } catch {
    return undefined;
  }
}

export default function CodeBlock({
  children: rawChildren,
  ...props
}: Props): ReactNode {
  // The Prism theme on SSR is always the default theme but the site theme can
  // be in a different mode. React hydration doesn't update DOM styles that come
  // from SSR. Hence force a re-render after mounting to apply the current
  // relevant styles.
  const isBrowser = useIsBrowser();
  const playgroundBaseUrl = useBaseUrl('/playground');
  const children = maybeStringifyChildren(rawChildren);
  const block =
    typeof children === 'string' ? (
      <StringContent key={String(isBrowser)} {...props}>
        {children}
      </StringContent>
    ) : (
      <ElementContent key={String(isBrowser)} {...props}>
        {children}
      </ElementContent>
    );

  const playgroundHref = useMemo(() => {
    if (typeof children !== 'string') return undefined;
    const query = playgroundQuery(props.className, props.metastring, children);
    return query ? `${playgroundBaseUrl}?${query}` : undefined;
  }, [children, props.className, props.metastring, playgroundBaseUrl]);

  if (!playgroundHref) return block;

  return (
    <div className="nudo-code-playground">
      <div className="nudo-code-playground-bar">
        <a
          className="nudo-code-playground-link"
          href={playgroundHref}
          target="_blank"
          rel="noopener noreferrer"
          title="Open this snippet in the browser playground"
        >
          <Translate id="theme.CodeBlock.runInPlayground">
            Run in Playground
          </Translate>
          <span aria-hidden="true"> ↗</span>
        </a>
      </div>
      {block}
    </div>
  );
}
