import { useEffect } from 'react'
import type { Connection } from '@athome/client'
import type { CommandArgs } from '@athome/protocol'

// An answer to a request of Claude (permission, question, plan), as request.answer takes it.
export type Answer = Omit<CommandArgs<'request.answer'>, 'tabId' | 'requestId'>

// Receives the tab's transcript while the view is mounted.
export function useTabSubscription(connection: Connection, tabId: string, onError: (error: unknown) => void): void {
  useEffect(() => {
    connection.subscribeTab(tabId).catch(onError)
    return () => void connection.unsubscribeTab(tabId).catch(() => undefined)
    // onError is a fresh function every render: the subscription follows the tab only.
  }, [connection, tabId])
}
