import type { Query, SDKControlGetContextUsageResponse, SDKControlGetUsageResponse, SDKRateLimitInfo } from '@anthropic-ai/claude-agent-sdk'
import type { ContextGauge, ContextUsage, PlanLimits, Usage } from '@athome/protocol'

// /context and /usage data from the CLI, reduced to what the panels show.

// The context answer as the protocol carries it: the window is the one usage is measured against (rawMaxTokens, the
// autocompact window), MCP tools summed per server.
export function toContextUsage(answer: SDKControlGetContextUsageResponse): ContextUsage {
  const servers = new Map<string, { name: string; tools: number; tokens: number }>()
  for (const tool of answer.mcpTools) {
    const server = servers.get(tool.serverName) ?? { name: tool.serverName, tools: 0, tokens: 0 }
    server.tools++
    server.tokens += tool.tokens
    servers.set(tool.serverName, server)
  }
  return {
    model: answer.model,
    totalTokens: answer.totalTokens,
    maxTokens: answer.rawMaxTokens,
    percentage: answer.percentage,
    categories: answer.categories.map(({ name, tokens, kind }) => ({ name, tokens, kind })),
    autoCompact: answer.isAutoCompactEnabled,
    ...(answer.autoCompactThreshold === undefined ? {} : { autoCompactThreshold: answer.autoCompactThreshold }),
    memoryFiles: answer.memoryFiles.map(({ path, type, tokens }) => ({ path, type, tokens })),
    mcpServers: [...servers.values()].sort((a, b) => b.tokens - a.tokens)
  }
}

type Window = { utilization: number | null; resets_at: string | null } | null | undefined

// A reset time in plain ISO 8601 (the CLI sends microseconds and an offset, which Safari may not parse).
function isoTime(time: string | null): string | null {
  const date = time ? new Date(time) : undefined
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : time
}

// A plan usage window, or nothing when the CLI has none.
function limitWindow(window: Window): { utilization: number | null; resetsAt: string | null } | undefined {
  return window ? { utilization: window.utilization, resetsAt: isoTime(window.resets_at) } : undefined
}

// The usage answer as the protocol carries it (no behaviors: the panel shows cost and limits only).
export function toUsage(answer: SDKControlGetUsageResponse): Usage {
  const limits = answer.rate_limits_available ? answer.rate_limits : null
  const extra = limits?.extra_usage
  const windows = limits && {
    fiveHour: limitWindow(limits.five_hour),
    sevenDay: limitWindow(limits.seven_day),
    sevenDayOpus: limitWindow(limits.seven_day_opus),
    sevenDaySonnet: limitWindow(limits.seven_day_sonnet)
  }
  return {
    session: {
      costUsd: answer.session.total_cost_usd,
      durationMs: answer.session.total_duration_ms,
      apiDurationMs: answer.session.total_api_duration_ms,
      linesAdded: answer.session.total_lines_added,
      linesRemoved: answer.session.total_lines_removed,
      models: Object.entries(answer.session.model_usage).map(([model, used]) => ({
        model,
        inputTokens: used.inputTokens,
        outputTokens: used.outputTokens,
        cacheReadTokens: used.cacheReadInputTokens,
        cacheWriteTokens: used.cacheCreationInputTokens,
        costUsd: used.costUSD
      }))
    },
    subscription: answer.subscription_type,
    limits:
      limits && windows
        ? {
            ...Object.fromEntries(Object.entries(windows).filter(([, window]) => window)),
            models: (limits.model_scoped ?? []).map((window) => ({ name: window.display_name, utilization: window.utilization, resetsAt: isoTime(window.resets_at) })),
            ...(extra ? { extra: { enabled: extra.is_enabled, utilization: extra.utilization, usedCredits: extra.used_credits, monthlyLimit: extra.monthly_limit, currency: extra.currency ?? null } } : {})
          }
        : null
  }
}

// The composer's gauge of the context window, from a /context answer.
export function toContextGauge(answer: SDKControlGetContextUsageResponse): ContextGauge {
  return { percentage: answer.percentage, totalTokens: answer.totalTokens, maxTokens: answer.rawMaxTokens }
}

// The composer's plan windows (5 hours, week) from a usage answer; undefined where plan limits do not apply.
export function toPlanLimits(usage: Usage): PlanLimits | undefined {
  if (!usage.limits) return undefined
  const { fiveHour, sevenDay } = usage.limits
  return { ...(fiveHour ? { fiveHour } : {}), ...(sevenDay ? { sevenDay } : {}) }
}

// A window of a rate_limit_event: utilization as a fraction (0-1), reset in epoch seconds.
type EventWindow = { utilization?: number; resetsAt?: number }

// The plan windows a rate_limit_event carries. CLI 2.1.287 sends `unifiedWindows` (five_hour and seven_day, outside the
// SDK's types) with every event, also for accounts added with a token, which the /usage call cannot read (their token
// has no profile scope); otherwise the event's own window. Undefined when it carries none.
export function planLimitsFromEvent(info: SDKRateLimitInfo): PlanLimits | undefined {
  const window = (event: EventWindow | undefined) =>
    event && typeof event.utilization === 'number' ? { utilization: Math.round(event.utilization * 1000) / 10, resetsAt: event.resetsAt ? new Date(event.resetsAt * 1000).toISOString() : null } : undefined
  const unified = (info as { unifiedWindows?: { five_hour?: EventWindow; seven_day?: EventWindow } }).unifiedWindows
  const own = { utilization: info.utilization, resetsAt: info.resetsAt }
  const fiveHour = window(unified?.five_hour ?? (info.rateLimitType === 'five_hour' ? own : undefined))
  const sevenDay = window(unified?.seven_day ?? (info.rateLimitType === 'seven_day' ? own : undefined))
  if (!fiveHour && !sevenDay) return undefined
  return { ...(fiveHour ? { fiveHour } : {}), ...(sevenDay ? { sevenDay } : {}) }
}

// Asks the CLI for the /usage data. The SDK marks this method experimental (its name will change): it stays here,
// behind one place, covered by smoke:usage on the real CLI.
export function readUsage(query: Query): Promise<SDKControlGetUsageResponse> {
  return query.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true })
}
