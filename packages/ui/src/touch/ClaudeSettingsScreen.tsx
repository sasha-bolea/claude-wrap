import { useEffect, useState, type KeyboardEvent } from 'react'
import { CLAUDE_MODELS, type ClaudeSettingChange, type ClaudeSettings } from '@athome/protocol'
import { t } from '../i18n.ts'
import { useTouch } from './context.tsx'
import { Icon } from './icons.tsx'
import { InspectBody, InspectTop, useInspect, useReloadOnTop } from './inspect.tsx'
import { SwitchRow } from './parts.tsx'

// The longest language name the setting accepts (the protocol's limit).
const LANGUAGE_MAX = 100

// The sheet of the default model: the models as a radio menu; picking one closes the sheet.
function ModelSheet({ current, onPick }: { current: ClaudeSettings['model']; onPick: (model: ClaudeSettings['model']) => void }) {
  const { closeSheet } = useTouch()
  return (
    <ul className="menu" role="radiogroup" aria-label={t('ccModel')}>
      {CLAUDE_MODELS.map((model) => (
        <li key={model}>
          <button
            role="radio"
            aria-checked={model === current}
            onClick={() => {
              closeSheet()
              onPick(model)
            }}
          >
            {t(`ccModel_${model}`)}
          </button>
        </li>
      ))}
    </ul>
  )
}

// The sheet of the reply language: a text field with Save, and Back to default (saves '').
function LanguageSheet({ current, onSave }: { current: string; onSave: (language: string) => Promise<boolean> }) {
  const { closeSheet } = useTouch()
  const [text, setText] = useState(current)
  const [busy, setBusy] = useState(false)
  const save = (language: string) => {
    setBusy(true)
    void onSave(language).then((saved) => (saved ? closeSheet() : setBusy(false)))
  }
  const submit = (event: KeyboardEvent) => event.key === 'Enter' && !busy && save(text)
  return (
    <>
      <label className="label" htmlFor="claude-language">
        {t('ccLanguageLabel')}
      </label>
      <input className="field" id="claude-language" autoComplete="off" maxLength={LANGUAGE_MAX} value={text} onChange={(event) => setText(event.target.value)} onKeyDown={submit} />
      <p className="muted flat">{t('ccLanguageHelp')}</p>
      <button className="button primary block" disabled={busy} onClick={() => save(text)}>
        {t('save')}
      </button>
      {current && (
        <button className="button block" disabled={busy} onClick={() => save('')}>
          {t('ccLanguageReset')}
        </button>
      )}
    </>
  )
}

// Settings → Claude Code settings, as /config: the options of the user's settings file that change Claude here too.
// Global (no session). Each change is saved at once and every live session takes it; a refusal shows its reason and
// puts the row back.
export function ClaudeSettingsScreen() {
  const { connection, openSheet, toast, fail } = useTouch()
  const inspect = useInspect(() => connection.request('settings.claudeCode', {}), [connection])
  useReloadOnTop(inspect)
  // Values saved and not yet read back, shown at once; dropped when the file is read again.
  const [pending, setPending] = useState<Partial<ClaudeSettings>>({})
  useEffect(() => setPending({}), [inspect.data])
  // Saves one change. Returns whether it was saved.
  const apply = (change: ClaudeSettingChange): Promise<boolean> => {
    setPending((now) => ({ ...now, [change.key]: change.value }))
    return connection.request('settings.setClaudeCode', { change }).then(
      () => {
        inspect.reload()
        toast(t('ccSaved'))
        return true
      },
      (failure: unknown) => {
        setPending((now) => Object.fromEntries(Object.entries(now).filter(([key]) => key !== change.key)))
        fail(failure)
        return false
      }
    )
  }
  return (
    <section className="screen" aria-label={t('later_config')}>
      <InspectTop title={t('later_config')} onRefresh={inspect.reload} />
      <InspectBody inspect={inspect}>
        {({ values: saved, file }) => {
          const values: ClaudeSettings = { ...saved, ...pending }
          const toggle = (key: 'thinking' | 'autoCompact' | 'useAutoModeDuringPlan' | 'workflows' | 'workflowKeywordTriggerEnabled') => (value: boolean) => void apply({ key, value })
          return (
            <>
              <ul className="list">
                <li className="row">
                  <button className="row-main" onClick={() => openSheet({ title: t('ccModel'), body: <ModelSheet current={values.model} onPick={(value) => void apply({ key: 'model', value })} /> })}>
                    <span className="row-title">{t('ccModel')}</span>
                    <span className="row-sub">{t(`ccModel_${values.model}`)}</span>
                    <span className="row-sub wrap">{t('ccModelHint')}</span>
                  </button>
                  <Icon name="chevron" className="chevron" />
                </li>
                <SwitchRow id="cc-thinking" title={t('ccThinking')} hint={t('ccThinkingHint')} checked={values.thinking} onChange={toggle('thinking')} />
                <li className="row">
                  <button className="row-main" onClick={() => openSheet({ title: t('ccLanguage'), field: true, body: <LanguageSheet current={values.language} onSave={(value) => apply({ key: 'language', value })} /> })}>
                    <span className="row-title">{t('ccLanguage')}</span>
                    <span className="row-sub">{values.language || t('ccLanguageDefault')}</span>
                  </button>
                  <Icon name="chevron" className="chevron" />
                </li>
                <SwitchRow id="cc-autocompact" title={t('ccAutoCompact')} hint={t('ccAutoCompactHint')} checked={values.autoCompact} onChange={toggle('autoCompact')} />
                <SwitchRow id="cc-automode-plan" title={t('ccAutoModePlan')} checked={values.useAutoModeDuringPlan} onChange={toggle('useAutoModeDuringPlan')} />
                <SwitchRow id="cc-workflows" title={t('ccWorkflows')} hint={t('ccWorkflowsHint')} checked={values.workflows} onChange={toggle('workflows')} />
                <SwitchRow id="cc-ultracode" title={t('ccUltracode')} hint={t('ccUltracodeHint')} checked={values.workflowKeywordTriggerEnabled} dim={!values.workflows} onChange={toggle('workflowKeywordTriggerEnabled')} />
                <li className="row stacked">
                  <span className="row-title" id="cc-worktree-label">
                    {t('ccWorktree')}
                  </span>
                  <div className="segmented effort cols-2" role="radiogroup" aria-labelledby="cc-worktree-label">
                    {(['fresh', 'head'] as const).map((base) => (
                      <label key={base}>
                        <input type="radio" name="cc-worktree" checked={values.worktreeBaseRef === base} onChange={() => void apply({ key: 'worktreeBaseRef', value: base })} />
                        <span>{t(`ccWorktree_${base}`)}</span>
                      </label>
                    ))}
                  </div>
                </li>
              </ul>
              <p className="muted flat pre-wrap selectable">{t('ccFooter', { file })}</p>
            </>
          )
        }}
      </InspectBody>
    </section>
  )
}
