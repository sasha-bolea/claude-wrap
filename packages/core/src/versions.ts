import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import corePackage from '../package.json' with { type: 'json' }

// Versions announced in welcome: core, the SDK, and the CLI the SDK bundles.
export function readVersions(): { coreVersion: string; sdkVersion: string; cliVersion: string } {
  const sdkEntry = createRequire(import.meta.url).resolve('@anthropic-ai/claude-agent-sdk')
  const sdkPackage = JSON.parse(readFileSync(join(dirname(sdkEntry), 'package.json'), 'utf8'))
  return { coreVersion: corePackage.version, sdkVersion: sdkPackage.version, cliVersion: sdkPackage.claudeCodeVersion }
}
