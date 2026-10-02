import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

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
