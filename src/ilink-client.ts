import { ILINK_BASE_URL } from './types'
import type {
  QrCodeResponse,
  QrStatusResponse,
  GetUpdatesResponse,
  SendMessageResponse,
  GetConfigResponse,
} from './types'

function makeHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    AuthorizationType: 'ilink_bot_token',
    'X-WECHAT-UIN': btoa(String(Math.floor(Math.random() * 0xFFFFFFFF))),
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  return headers
}

export function createILinkClient(token?: string, baseUrl: string = ILINK_BASE_URL) {
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
          base_info: { channel_version: '1.0.2' },
        }),
      })
      return res.json()
    },

    async sendMessage(
      toUserId: string,
      contextToken: string,
      text: string,
    ): Promise<SendMessageResponse> {
      const res = await fetch(`${baseUrl}/ilink/bot/sendmessage`, {
        method: 'POST',
        headers: makeHeaders(token),
        body: JSON.stringify({
          msg: {
            to_user_id: toUserId,
            message_type: 2,
            message_state: 2,
            context_token: contextToken,
            item_list: [{ type: 1, text_item: { text } }],
          },
        }),
      })
      return res.json()
    },

    async getConfig(): Promise<GetConfigResponse> {
      const res = await fetch(`${baseUrl}/ilink/bot/getconfig`, {
        method: 'POST',
        headers: makeHeaders(token),
        body: JSON.stringify({}),
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
        }),
      })
    },

    setToken(newToken: string) {
      token = newToken
    },
  }
}

export type ILinkClient = ReturnType<typeof createILinkClient>
