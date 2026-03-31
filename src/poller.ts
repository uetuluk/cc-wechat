import type { ILinkClient } from './ilink-client'
import type { WeixinMessage } from './types'

export async function startPoller(
  client: ILinkClient,
  initialCursor: string,
  onMessage: (msg: WeixinMessage) => void,
  signal: AbortSignal,
  onCursor?: (cursor: string) => void,
): Promise<void> {
  let cursor = initialCursor

  while (!signal.aborted) {
    try {
      const response = await client.getUpdates(cursor)

      if (response.ret !== undefined && response.ret !== 0) {
        await new Promise(r => setTimeout(r, 5000))
        continue
      }

      cursor = response.get_updates_buf
      onCursor?.(cursor)

      for (const msg of response.msgs) {
        onMessage(msg)
      }
    } catch (err) {
      if (signal.aborted) break
      await new Promise(r => setTimeout(r, 5000))
    }
  }
}
