import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { riskySettingsKeys, unclassifiedSettings } from './settingsKeys.ts'

const FIXTURE = `export declare interface Settings {
    apiKeyHelper?: string;
    model?: string;
    statusLine?: {
        type: 'command';
        command: string;
    };
    newThing?: {
        endpointUrl?: string;
    };
}`

describe('settings classification (probe check)', () => {
  it('finds top-level keys whose name or nested keys mention command/helper/url/path/hook', () => {
    expect(riskySettingsKeys(FIXTURE)).toEqual(['apiKeyHelper', 'statusLine', 'newThing'])
    expect(unclassifiedSettings(FIXTURE)).toEqual(['newThing'])
  })

  it('every risky key of the installed SDK is classified', () => {
    const sdkEntry = createRequire(import.meta.url).resolve('@anthropic-ai/claude-agent-sdk')
    expect(unclassifiedSettings(readFileSync(join(dirname(sdkEntry), 'sdk.d.ts'), 'utf8'))).toEqual([])
  })
})
