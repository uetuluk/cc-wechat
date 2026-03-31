import type { ILinkClient } from './ilink-client'
import type { WeixinMessage } from './types'
import { writeFile } from 'fs/promises'
import { join, dirname } from 'path'

const DEBUG_LOG = join(dirname(new URL(import.meta.url).pathname).replace('/src', ''), 'debug-poller.log')

async function debugLog(msg: string) {
  await writeFile(DEBUG_LOG, `${new Date().toISOString()} ${msg}\n`, { flag: 'a' }).catch(() => {})
}

export async function startPoller(
  client: ILinkClient,
  initialCursor: string,
  onMessage: (msg: WeixinMessage) => void,
  signal: AbortSignal,
): Promise<void> {
  let cursor = initialCursor
  await debugLog(`poller started, cursor="${cursor}"`)

  while (!signal.aborted) {
    try {
      await debugLog(`calling getUpdates with cursor="${cursor.substring(0, 20)}..."`)
      const response = await client.getUpdates(cursor)
      await debugLog(`getUpdates returned ret=${response.ret} msgs=${response.msgs?.length ?? 'undefined'} raw=${JSON.stringify(response).substring(0, 200)}`)

      if (response.ret !== 0) {
        await debugLog(`non-zero ret=${response.ret}, retrying in 5s`)
        await new Promise(r => setTimeout(r, 5000))
        continue
      }

      cursor = response.get_updates_buf

      for (const msg of response.msgs) {
        await debugLog(`delivering message from ${msg.from_user_id}`)
        onMessage(msg)
      }
    } catch (err) {
      if (signal.aborted) break
      await debugLog(`error: ${err}`)
      await new Promise(r => setTimeout(r, 5000))
    }
  }
}
