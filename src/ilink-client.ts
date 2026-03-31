import crypto from 'node:crypto'
import { ILINK_BASE_URL } from './types'
import type {
  QrCodeResponse,
  QrStatusResponse,
  GetUpdatesResponse,
  SendMessageResponse,
  GetConfigResponse,
} from './types'

const CHANNEL_VERSION = '1.0.2'
const ILINK_APP_ID = 'bot'
const ILINK_APP_CLIENT_VERSION = String((1 << 16) | (0 << 8) | 2)

function makeHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    AuthorizationType: 'ilink_bot_token',
    'X-WECHAT-UIN': btoa(String(Math.floor(Math.random() * 0xFFFFFFFF))),
    'iLink-App-Id': ILINK_APP_ID,
    'iLink-App-ClientVersion': ILINK_APP_CLIENT_VERSION,
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  return headers
}

export function createILinkClient(token?: string, baseUrl: string = ILINK_BASE_URL) {
  function makeBaseInfo() {
    return { channel_version: CHANNEL_VERSION }
  }

  return {
    async getQrCode(): Promise<QrCodeResponse> {
      const res = await fetch(`${baseUrl}/ilink/bot/get_bot_qrcode?bot_type=3`, {
        headers: makeHeaders(),
      })
      return res.json()
    },

    async pollQrStatus(qrcode: string): Promise<QrStatusResponse> {
      const res = await fetch(
        `${baseUrl}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`,
        { headers: makeHeaders() },
      )
      return res.json()
    },

    async getUpdates(cursor: string): Promise<GetUpdatesResponse> {
      const res = await fetch(`${baseUrl}/ilink/bot/getupdates`, {
        method: 'POST',
        headers: makeHeaders(token),
        body: JSON.stringify({
          get_updates_buf: cursor,
          base_info: makeBaseInfo(),
        }),
      })
      return res.json()
    },

    async sendMessage(
      toUserId: string,
      contextToken: string,
      text: string,
    ): Promise<SendMessageResponse> {
      const body = JSON.stringify({
        msg: {
          from_user_id: '',
          to_user_id: toUserId,
          client_id: `claude-code-wechat-${crypto.randomUUID()}`,
          message_type: 2,
          message_state: 2,
          context_token: contextToken,
          item_list: text ? [{ type: 1, text_item: { text } }] : undefined,
        },
        base_info: makeBaseInfo(),
      })

      const res = await fetch(`${baseUrl}/ilink/bot/sendmessage`, {
        method: 'POST',
        headers: {
          ...makeHeaders(token),
          'Content-Length': String(Buffer.byteLength(body, 'utf-8')),
        },
        body,
      })
      return res.json()
    },

    async getConfig(): Promise<GetConfigResponse> {
      const res = await fetch(`${baseUrl}/ilink/bot/getconfig`, {
        method: 'POST',
        headers: makeHeaders(token),
        body: JSON.stringify({
          base_info: makeBaseInfo(),
        }),
      })
      return res.json()
    },

    async sendTyping(toUserId: string, typingTicket: string): Promise<void> {
      await fetch(`${baseUrl}/ilink/bot/sendtyping`, {
        method: 'POST',
        headers: makeHeaders(token),
        body: JSON.stringify({
          to_user_id: toUserId,
          typing_ticket: typingTicket,
          base_info: makeBaseInfo(),
        }),
      })
    },

    setToken(newToken: string) {
      token = newToken
    },

    setBaseUrl(newBaseUrl: string) {
      baseUrl = newBaseUrl
    },
  }
}

export type ILinkClient = ReturnType<typeof createILinkClient>
