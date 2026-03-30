import { describe, it, expect, mock } from 'bun:test'
import { startPoller } from '../src/poller'

interface WeixinMessage {
  from_user_id: string
  to_user_id: string
  message_type: number
  message_state: number
  context_token: string
  item_list: { type: number; text_item?: { text: string } }[]
}

interface GetUpdatesResponse {
  ret: number
  msgs: WeixinMessage[]
  get_updates_buf: string
  longpolling_timeout_ms: number
}

function makeMockClient(responses: GetUpdatesResponse[]) {
  let callIndex = 0
  return {
    getUpdates: mock(async (_cursor: string) => {
      if (callIndex < responses.length) return responses[callIndex++]
      // Yield to event loop so abort signal can fire
      await new Promise(r => setTimeout(r, 50))
      return { ret: 0, msgs: [], get_updates_buf: 'final', longpolling_timeout_ms: 35000 }
    }),
  }
}

describe('startPoller', () => {
  it('calls onMessage for each received message', async () => {
    const msg: WeixinMessage = {
      from_user_id: 'user1@im.wechat',
      to_user_id: 'bot@im.bot',
      message_type: 1,
      message_state: 2,
      context_token: 'ctx1',
      item_list: [{ type: 1, text_item: { text: 'hello' } }],
    }

    const client = makeMockClient([
      { ret: 0, msgs: [msg], get_updates_buf: 'c2', longpolling_timeout_ms: 35000 },
    ])

    const received: WeixinMessage[] = []
    const abort = new AbortController()

    const pollerPromise = startPoller(
      client as any, '', (m) => { received.push(m as any) }, abort.signal,
    )

    await new Promise(r => setTimeout(r, 200))
    abort.abort()
    await pollerPromise.catch(() => {})

    expect(received.length).toBe(1)
    expect(received[0].from_user_id).toBe('user1@im.wechat')
  })

  it('updates cursor between polls', async () => {
    const client = makeMockClient([
      { ret: 0, msgs: [], get_updates_buf: 'c2', longpolling_timeout_ms: 35000 },
      { ret: 0, msgs: [], get_updates_buf: 'c3', longpolling_timeout_ms: 35000 },
    ])

    const abort = new AbortController()
    const pollerPromise = startPoller(client as any, 'c1', () => {}, abort.signal)

    await new Promise(r => setTimeout(r, 300))
    abort.abort()
    await pollerPromise.catch(() => {})

    const calls = client.getUpdates.mock.calls
    expect(calls[0][0]).toBe('c1')
    expect(calls[1][0]).toBe('c2')
  })
})
