import { t } from '../i18n.ts'
import { useTouch } from './context.tsx'
import { InspectBody, InspectTop, useInspect, useReloadOnTop, useSessionSub } from './inspect.tsx'

// A value that looks like a path or an id is shown in the mono font.
const looksTechnical = (value: string) => /^(~|\/|[A-Za-z]:[\\/])/.test(value) || /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value)

// The session's status, as /status: the CLI's sections (version, session, model, account, …) as titled rows of label
// and selectable value, then the settings files in effect with where each comes from. Asked again each time it comes
// back on top and with Read again.
export function StatusScreen({ tabId }: { tabId: string }) {
  const { connection } = useTouch()
  const inspect = useInspect(() => connection.request('tab.status', { tabId }), [connection, tabId])
  useReloadOnTop(inspect)
  return (
    <section className="screen" aria-label={t('later_status')}>
      <InspectTop title={t('later_status')} sub={useSessionSub(tabId)} onRefresh={inspect.reload} />
      <InspectBody inspect={inspect}>
        {(data) => (
          <>
            {data.sections.map((section, index) => (
              <div key={`${section.title}${index}`} className="group">
                <p className="label">{section.title}</p>
                <ul className="list">
                  {section.rows.map((row, at) => (
                    <li key={`${row.label}${at}`} className="row">
                      <span className="row-main">
                        <span className="row-title plain">{row.label}</span>
                        <span className={`row-sub wrap selectable${looksTechnical(row.value) ? ' mono-line' : ''}`}>{row.value || '–'}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <div className="group">
              <p className="label">{t('settingsFiles')}</p>
              {data.settingsFiles.length ? (
                <ul className="list">
                  {data.settingsFiles.map((file, index) => (
                    <li key={`${file.path}${index}`} className="row">
                      <span className="row-main">
                        <span className="row-chips">
                          <span className="chip">{file.source}</span>
                        </span>
                        <span className="row-sub wrap selectable mono-line">{file.path}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted flat">{t('noSettingsFiles')}</p>
              )}
            </div>
          </>
        )}
      </InspectBody>
    </section>
  )
}
