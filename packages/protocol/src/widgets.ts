import { z } from 'zod'

// Chat widgets: HTML Claude puts in a reply as a fenced block, shown by the app in an isolated frame. A ```widget block
// carries the HTML itself; a ```widget:<name> block carries JSON data for a widget of the library
// (~/.claude/widgets/<name>.html, made with /creawidget).

// htmlBytes: largest widget file of the library; name: longest widget name.
export const WIDGET_LIMITS = { htmlBytes: 200 * 1024, name: 40 } as const
// A library widget's name: its file name without .html (lowercase letters, digits, dashes).
export const WIDGET_NAME = /^[a-z0-9][a-z0-9-]*$/
// The language of a widget fence: `widget` or `widget:<name>`.
export const WIDGET_LANGUAGE = 'widget'

export const widgetNameSchema = z.string().min(1).max(WIDGET_LIMITS.name).regex(WIDGET_NAME)
// A widget of the library: its name and the description of its <meta name="description">, if any.
export const widgetInfoSchema = z.object({ name: widgetNameSchema, description: z.string().max(500).optional() })
export type WidgetInfo = z.infer<typeof widgetInfoSchema>
export * from './widgetFrame.ts'
