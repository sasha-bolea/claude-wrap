import type { Item } from '@claude-wrap/protocol'
import { t } from './i18n.ts'
import { Markdown } from './Markdown.tsx'

type ToolCall = Extract<Item, { kind: 'toolCall' }>
type TurnEnd = Extract<Item, { kind: 'turnEnd' }>

// One-line summary of a tool call: the most telling field of its input.
function toolSummary(input: unknown): string {
  const fields = (input ?? {}) as Record<string, unknown>
  const value = fields.command ?? fields.file_path ?? fields.pattern ?? fields.url ?? fields.query ?? fields.description ?? fields.prompt
  return typeof value === 'string' ? value : ''
}

// Tool card: closed shows name, summary and state; open shows input and result.
function ToolCard({ item }: { item: ToolCall }) {
  const state = item.result === undefined ? t('toolRunning') : item.isError ? t('toolFailed') : t('toolDone')
  return (
    <details className={`item tool${item.isError ? ' failed' : ''}`}>
      <summary>
        <span className="tool-name">{item.name}</span>
        <span className="tool-summary">{toolSummary(item.input)}</span>
        <span className="tool-state">{state}</span>
      </summary>
      <div className="tool-body">
        <pre>{JSON.stringify(item.input, null, 2)}</pre>
        {item.result !== undefined && <pre>{item.result}</pre>}
      </div>
    </details>
  )
}

// End of a turn: interruption, error, or duration and cost.
function turnEndText(item: TurnEnd): string {
  if (item.interrupted) return t('interrupted')
  if (item.error) return t('turnError', { error: item.error })
  return t('turnStats', { seconds: ((item.durationMs ?? 0) / 1000).toFixed(1), cost: (item.costUsd ?? 0).toFixed(4) })
}

// One transcript item, rendered by kind.
export function ItemView({ item, openExternal }: { item: Item; openExternal?: (url: string) => void }) {
  switch (item.kind) {
    case 'user':
      return <div className="item user">{item.text}</div>
    case 'assistantText':
      return (
        <div className="item assistant-text">
          <Markdown text={item.text} openExternal={openExternal} />
        </div>
      )
    case 'thinking':
      return <div className="item thinking">{item.text}</div>
    case 'toolCall':
      return <ToolCard item={item} />
    case 'turnEnd':
      return <div className={`item turn-end${item.error ? ' failed' : ''}`}>{turnEndText(item)}</div>
    case 'notice':
      return <div className={`item notice ${item.level}`}>{item.text}</div>
    case 'compactBoundary':
      return <div className="item notice info">{t('compacted')}</div>
    case 'localCommandOutput':
      return <pre className="item local-output">{item.text}</pre>
  }
}
