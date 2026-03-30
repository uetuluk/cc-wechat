import type { ILinkClient } from './ilink-client'
import type { WeixinMessage } from './types'

export async function startPoller(
  client: ILinkClient,
  initialCursor: string,
  onMessage: (msg: WeixinMessage) => void | Promise<void>,
  signal: AbortSignal,
): Promise<void> {
  let cursor = initialCursor

  while (!signal.aborted) {
    try {
      const response = await client.getUpdates(cursor)
      if (response.ret !== 0) {
        console.error(
          `[poller] getUpdates returned ret=${response.ret}, retrying in 5s`,
        )
        await new Promise(r => setTimeout(r, 5000))
        continue
      }

      cursor = response.get_updates_buf

      for (const msg of response.msgs) {
        await onMessage(msg)
      }
    } catch (err) {
      if (signal.aborted) break
      console.error('[poller] error:', err)
      await new Promise(r => setTimeout(r, 5000))
    }
  }
}
