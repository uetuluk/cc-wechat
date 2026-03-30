// src/types.ts

// --- iLink API base ---

export const ILINK_BASE_URL = 'https://ilinkai.weixin.qq.com'

export interface ILinkHeaders {
  'Content-Type': 'application/json'
  AuthorizationType: 'ilink_bot_token'
  Authorization: `Bearer ${string}`
  'X-WECHAT-UIN': string
}

// --- QR Login ---

export interface QrCodeResponse {
  qrcode: string
  qrcode_img_content: string
}

export interface QrStatusResponse {
  status: 'confirmed' | 'pending' | 'expired'
  bot_token?: string
  baseurl?: string
}

// --- Messages ---

export const MessageItemType = {
  TEXT: 1,
  IMAGE: 2,
  VOICE: 3,
  FILE: 4,
  VIDEO: 5,
} as const

export type MessageItemTypeValue = (typeof MessageItemType)[keyof typeof MessageItemType]

export interface TextItem {
  type: 1
  text_item: { text: string }
}

export interface MediaItem {
  type: 2 | 3 | 4 | 5
  [key: string]: unknown
}

export type MessageItem = TextItem | MediaItem

export interface WeixinMessage {
  from_user_id: string
  to_user_id: string
  message_type: number
  message_state: number
  context_token: string
  item_list: MessageItem[]
}

export interface GetUpdatesRequest {
  get_updates_buf: string
  base_info: { channel_version: string }
}

export interface GetUpdatesResponse {
  ret: number
  msgs: WeixinMessage[]
  get_updates_buf: string
  longpolling_timeout_ms: number
}

export interface SendMessageRequest {
  msg: {
    to_user_id: string
    message_type: number
    message_state: number
    context_token: string
    item_list: MessageItem[]
  }
}

export interface SendMessageResponse {
  ret: number
}

// --- Config ---

export interface GetConfigResponse {
  typing_ticket: string
}

// --- Credentials (persisted locally) ---

export interface Credentials {
  bot_token: string
  baseurl?: string
}
