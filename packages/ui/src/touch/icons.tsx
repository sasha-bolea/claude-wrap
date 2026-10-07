import type { ReactNode } from 'react'
import type { PermissionMode } from '@athome/protocol'

// Line icons of the touch layout (the prototype's set), drawn with the text colour. An icon-only button always has
// an aria-label: the icon itself is hidden from screen readers.
const SHAPES = {
  back: <path d="M15 5l-7 7 7 7" />,
  more: (
    <>
      <circle cx="5" cy="12" r="1.3" />
      <circle cx="12" cy="12" r="1.3" />
      <circle cx="19" cy="12" r="1.3" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6A7 7 0 0 0 5 12a7 7 0 0 0 .1 1.2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  // Brain: two lobes split by a centre line, with a fold on each side.
  brain: <path d="M12 5v14M12 5a3.2 3.2 0 0 0-6 1.2A3.4 3.4 0 0 0 4.5 12 3.4 3.4 0 0 0 6 16.5 3.2 3.2 0 0 0 12 19M12 5a3.2 3.2 0 0 1 6 1.2A3.4 3.4 0 0 1 19.5 12a3.4 3.4 0 0 1-1.5 4.5A3.2 3.2 0 0 1 12 19M8 10.5h1.5M14.5 13.5H16" />,
  terminal: <path d="M4 5h16v14H4zM7.5 9.5l3 2.5-3 2.5M12.5 15h4" />,
  photo: (
    <>
      <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
      <circle cx="12" cy="13" r="3.5" />
    </>
  ),
  history: <path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.6M4 4v4.6h4.6M12 8v4l3 2" />,
  send: <path d="M12 19V5M6 11l6-6 6 6" />,
  stop: <rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" stroke="none" />,
  folder: <path d="M3 6h6l2 2h10v11H3z" />,
  chevron: <path d="M9 5l7 7-7 7" />,
  up: <path d="M12 19V6M6 11l6-5 6 5" />,
  down: <path d="M12 5v13M6 13l6 5 6-5" />,
  files: <path d="M14 3H6v18h12V7zM14 3v4h4M9 12h6M9 16h6" />,
  note: <path d="M5 4h14v11l-5 5H5zM14 20v-5h5M8 9h8M8 13h4" />,
  pause: <path d="M9 6v12M15 6v12" />,
  play: <path d="M8 5.5v13l10-6.5z" />,
  file: <path d="M14 3H6v18h12V7zM14 3v4h4" />,
  code: <path d="M14 3H6v18h12V7zM14 3v4h4M10.5 11l-2 2.5 2 2.5M13.5 11l2 2.5-2 2.5" />,
  image: (
    <>
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="M20 16l-5-5-8 8" />
    </>
  ),
  trash: <path d="M4 7h16M10 7V4h4v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />,
  download: <path d="M12 4v11M7 10l5 5 5-5M5 19h14" />,
  upload: <path d="M12 15V4M7 9l5-5 5 5M5 19h14" />,
  'folder-plus': <path d="M3 6h6l2 2h10v11H3zM12 11v5M9.5 13.5h5" />,
  'to-chat': <path d="M4 5h16v11H9l-5 4zM12 7.5v5M9.5 10l2.5 2.5 2.5-2.5" />,
  chats: <path d="M4 5h12v9H9l-4 3v-3H4zM16 9h4v8h-1v3l-3-3h-5v-3" />,
  queue: <path d="M4 6h11M4 11h11M4 16h7M18 12v8M15 17l3 3 3-3" />,
  rewind: <path d="M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H10" />,
  unsend: <path d="M10 6L5 11l5 5M5 11h9a5 5 0 0 1 0 10h-4" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  copy: <path d="M9 9h11v11H9zM15 9V4H4v11h5" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  refresh: <path d="M20 12a8 8 0 1 1-2.4-5.7L20 8.6M20 4v4.6h-4.6" />,
  'mode-default': <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6zM10 10a2 2 0 1 1 2.7 1.9c-.5.2-.7.6-.7 1.1M12 16h.01" />,
  'mode-acceptEdits': <path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4" />,
  'mode-plan': <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />,
  'mode-auto': <path d="M13 3L5 14h6l-1 7 8-11h-6z" />,
  'mode-dontAsk': (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M6.5 6.5l11 11" />
    </>
  ),
  'mode-bypassPermissions': <path d="M13 3L5 14h6l-1 7 8-11h-6z" />
} satisfies Record<string, ReactNode>

export type IconName = keyof typeof SHAPES

// The icon of a permission mode.
export const modeIcon = (mode: PermissionMode): IconName => `mode-${mode}`

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg className={className ? `i ${className}` : 'i'} viewBox="0 0 24 24" aria-hidden="true">
      {SHAPES[name]}
    </svg>
  )
}
