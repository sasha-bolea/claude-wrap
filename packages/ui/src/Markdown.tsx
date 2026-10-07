import { useRef, useState, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { t } from './i18n.ts'
import { Icon } from './touch/icons.tsx'

// How long the copy button shows its tick after a copy (ms).
const COPIED_MS = 1500

// A code block with a button that copies its text (a tick for a moment after it worked).
// children: the block's content as react-markdown renders it.
function CodeBlock({ children }: { children?: ReactNode }) {
  const pre = useRef<HTMLPreElement>(null)
  const [copied, setCopied] = useState(false)
  const copy = () =>
    navigator.clipboard?.writeText(pre.current?.textContent ?? '').then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), COPIED_MS)
    }, () => undefined)
  return (
    <div className="code-block">
      <pre ref={pre}>{children}</pre>
      <button type="button" className={`copy-code${copied ? ' done' : ''}`} aria-label={t(copied ? 'codeCopied' : 'copyCode')} title={t('copyCode')} onClick={() => void copy()}>
        <Icon name={copied ? 'check' : 'copy'} />
      </button>
    </div>
  )
}

// Untrusted markdown (assistant text, plans): raw HTML is never rendered (react-markdown default, no rehype-raw),
// images become links so a prompt-injected image cannot leak data by loading a URL, and links open outside.
// openExternal: opens an https link in the system browser (desktop); absent → links are inert text.
export function Markdown({ text, openExternal }: { text: string; openExternal?: (url: string) => void }) {
  // Clicking a link never navigates the app window.
  const follow = (href: string | undefined) => (event: React.MouseEvent) => {
    event.preventDefault()
    if (href) openExternal?.(href)
  }
  const components: Components = {
    pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
    a: ({ href, children }) => (
      <a href={href} onClick={follow(href)}>
        {children}
      </a>
    ),
    img: ({ src, alt }) => {
      const href = typeof src === 'string' ? src : undefined
      return (
        <a href={href} onClick={follow(href)}>
          {alt || href}
        </a>
      )
    }
  }
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {text}
    </ReactMarkdown>
  )
}
