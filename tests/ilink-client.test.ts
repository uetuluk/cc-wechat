import { describe, it, expect, mock, beforeEach } from 'bun:test'
import { createILinkClient } from '../src/ilink-client'
import type { GetUpdatesResponse, SendMessageResponse, QrCodeResponse, QrStatusResponse } from '../src/types'

// Mock global fetch
const mockFetch = mock(() => Promise.resolve(new Response('{}', { status: 200 })))

describe('createILinkClient', () => {
  beforeEach(() => {
    mockFetch.mockClear()
    globalThis.fetch = mockFetch as any
  })

  it('getQrCode sends correct request', async () => {
    const qrResp: QrCodeResponse = { qrcode: 'abc', qrcode_img_content: 'base64...' }
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify(qrResp)))

    const client = createILinkClient()
    const result = await client.getQrCode()

    expect(result.qrcode).toBe('abc')
    const call = mockFetch.mock.calls[0]
    expect(call[0]).toContain('/ilink/bot/get_bot_qrcode?bot_type=3')
  })

  it('pollQrStatus returns token on confirmed', async () => {
    const statusResp: QrStatusResponse = { status: 'confirmed', bot_token: 'tok123' }
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify(statusResp)))

    const client = createILinkClient()
    const result = await client.pollQrStatus('abc')

    expect(result.status).toBe('confirmed')
    expect(result.bot_token).toBe('tok123')
  })

  it('getUpdates sends cursor and auth headers', async () => {
    const updatesResp: GetUpdatesResponse = {
      ret: 0, msgs: [], get_updates_buf: 'cursor2', longpolling_timeout_ms: 35000,
    }
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify(updatesResp)))

    const client = createILinkClient('mytoken')
    const result = await client.getUpdates('cursor1')

    expect(result.get_updates_buf).toBe('cursor2')
    const [url, opts] = mockFetch.mock.calls[0]
    expect(url).toContain('/ilink/bot/getupdates')
    expect((opts as any).headers.Authorization).toBe('Bearer mytoken')
  })

  it('sendMessage posts with context_token', async () => {
    const sendResp: SendMessageResponse = { ret: 0 }
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify(sendResp)))

    const client = createILinkClient('mytoken')
    await client.sendMessage('user@im.wechat', 'ctx_tok', 'hello')

    const [url, opts] = mockFetch.mock.calls[0]
    expect(url).toContain('/ilink/bot/sendmessage')
    const body = JSON.parse((opts as any).body)
    expect(body.msg.context_token).toBe('ctx_tok')
    expect(body.msg.item_list[0].text_item.text).toBe('hello')
  })
})
