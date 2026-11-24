import type { TabState } from '@shared/model'
import { api, errorMessage } from '../api'
import { Icon } from '../components/Icon'
import { SqlEditor } from '../editor/SqlEditor'
import { connectionById, notify, openConsole } from '../store'

type DdlState = Extract<TabState, { kind: 'ddl' }>

export function DdlTab({ tab }: { tab: DdlState }) {
  const engine = connectionById(tab.connectionId)?.engine ?? 'postgres'
  return (
    <>
      <div className="console-toolbar">
        <button className="btn" onClick={() => openConsole(tab.connectionId, tab.text)}>
          <Icon name="console" /> Open in Console
        </button>
        <button
          className="btn"
          onClick={() =>
            void api
              .copyText(tab.text)
              .then(() => notify('success', 'DDL copied'))
              .catch((err) => notify('error', errorMessage(err)))
          }
        >
          <Icon name="copy" /> Copy
        </button>
        <span style={{ flex: 1 }} />
        <span className="muted small">read-only · generated from the catalog</span>
      </div>
      <SqlEditor value={tab.text} engine={engine} readOnly />
    </>
  )
}
