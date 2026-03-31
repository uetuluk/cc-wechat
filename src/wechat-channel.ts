#!/usr/bin/env bun
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import qrcode from 'qrcode-terminal'
import { createILinkClient } from './ilink-client'
import { startPoller } from './poller'
import type { WeixinMessage, Credentials } from './types'
import { readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join, dirname } from 'path'

const PROJECT_DIR = dirname(new URL(import.meta.url).pathname).replace(
  '/src',
  '',
)
const CREDENTIALS_PATH = join(PROJECT_DIR, 'credentials.json')
const ACCESS_PATH = join(PROJECT_DIR, 'access.json')

// --- Helpers ---

function extractText(msg: WeixinMessage): string {
  const texts: string[] = []
  for (const item of msg.item_list) {
    if (item.type === 1 && 'text_item' in item) {
      texts.push(item.text_item.text)
    }
  }
  return texts.join('\n') || '[non-text message type]'
}

async function loadAllowlist(): Promise<Set<string>> {
  try {
    const data = JSON.parse(await readFile(ACCESS_PATH, 'utf-8'))
    return new Set(data.allowed_senders ?? [])
  } catch {
    return new Set()
  }
}

async function loadCredentials(): Promise<Credentials | null> {
  try {
    if (!existsSync(CREDENTIALS_PATH)) return null
    return JSON.parse(await readFile(CREDENTIALS_PATH, 'utf-8'))
  } catch {
    return null
  }
}

async function saveCredentials(creds: Credentials): Promise<void> {
  await writeFile(CREDENTIALS_PATH, JSON.stringify(creds, null, 2))
}

// --- QR Login via MCP elicitation ---

function generateQrText(data: string): Promise<string> {
  return new Promise((resolve) => {
    qrcode.generate(data, { small: true }, (text: string) => {
      resolve(text)
    })
  })
}

async function login(
  client: ReturnType<typeof createILinkClient>,
  mcp: InstanceType<typeof Server>,
): Promise<string> {
  const saved = await loadCredentials()
  if (saved?.bot_token) {
    console.error('[wechat] Using saved credentials')
    return saved.bot_token
  }

  console.error('[wechat] No saved credentials, starting QR login...')
  const qr = await client.getQrCode()

  // Generate text-art QR code from the scannable URL
  const qrUrl = qr.qrcode_img_content
  const qrText = await generateQrText(qrUrl)

  // Use MCP elicitation to show QR code to the user and wait for scan
  const elicitPromise = mcp.elicitInput({
    mode: 'form',
    message:
      `WeChat Login Required\n\n` +
      `Open WeChat on your phone, tap + > Scan, and scan this QR code:\n\n` +
      `${qrText}\n\n` +
      `Or open this URL on your phone: ${qrUrl}\n\n` +
      `Click "Confirm" below after you have scanned and approved in WeChat.`,
    requestedSchema: {
      type: 'object',
      properties: {
        confirmed: {
          type: 'boolean',
          title: 'I have scanned the QR code',
          default: true,
        },
      },
    },
  })

  // Poll for QR confirmation in parallel — it may complete before user clicks confirm
  const pollPromise = (async () => {
    while (true) {
      await new Promise((r) => setTimeout(r, 1000))
      const status = await client.pollQrStatus(qr.qrcode)

      if (status.status === 'confirmed' && status.bot_token) {
        return status
      }

      if (status.status === 'expired') {
        throw new Error('QR code expired. Restart the channel to try again.')
      }
    }
  })()

  // Wait for WeChat confirmation (polling completes when scan is approved)
  const status = await pollPromise

  console.error('[wechat] Login confirmed!')
  const creds: Credentials = {
    bot_token: status.bot_token!,
    baseurl: status.baseurl,
  }
  await saveCredentials(creds)
  return status.bot_token!
}

// --- Context token store (file-backed, survives process restarts) ---
const CONTEXT_TOKENS_PATH = join(PROJECT_DIR, '.context-tokens.json')

async function loadContextTokens(): Promise<Map<string, string>> {
  try {
    if (!existsSync(CONTEXT_TOKENS_PATH)) return new Map()
    const data = JSON.parse(await readFile(CONTEXT_TOKENS_PATH, 'utf-8'))
    return new Map(Object.entries(data))
  } catch {
    return new Map()
  }
}

async function saveContextTokens(tokens: Map<string, string>): Promise<void> {
  await writeFile(CONTEXT_TOKENS_PATH, JSON.stringify(Object.fromEntries(tokens), null, 2))
}

const contextTokens = await loadContextTokens()

// --- Main ---

async function main() {
  const client = createILinkClient()

  // Load sender allowlist
  const allowed = await loadAllowlist()

  // Create MCP server FIRST so Claude Code handshake succeeds immediately
  const mcp = new Server(
    { name: 'wechat', version: '0.1.0' },
    {
      capabilities: {
        experimental: {
          'claude/channel': {},
          'claude/channel/permission': {},
        },
        tools: {},
      },
      instructions:
        'Messages from WeChat arrive as <channel source="wechat" from_user_id="...">. ' +
        'Reply with the wechat_reply tool, passing the from_user_id from the tag. ' +
        'Permission prompts are forwarded to the WeChat user; they reply ' +
        'with "yes <id>" or "no <id>".',
    },
  )

  // --- Reply tool ---
  mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'wechat_reply',
        description: 'Send a text reply to a WeChat user',
        inputSchema: {
          type: 'object' as const,
          properties: {
            from_user_id: {
              type: 'string',
              description:
                'The WeChat user ID to reply to (from the channel tag)',
            },
            text: {
              type: 'string',
              description: 'The message text to send',
            },
          },
          required: ['from_user_id', 'text'],
        },
      },
    ],
  }))

  mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
    if (req.params.name === 'wechat_reply') {
      const { from_user_id, text } = req.params.arguments as {
        from_user_id: string
        text: string
      }
      const contextToken = contextTokens.get(from_user_id)
      if (!contextToken) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Error: no context_token for this user. They must send a message first.',
            },
          ],
        }
      }
      const result = await client.sendMessage(from_user_id, contextToken, text)
      console.error(`[wechat] sendMessage result: ${JSON.stringify(result)}`)
      return { content: [{ type: 'text' as const, text: `sent (api response: ${JSON.stringify(result)})` }] }
    }
    throw new Error(`unknown tool: ${req.params.name}`)
  })

  // --- Permission relay handler ---
  const PermissionRequestSchema = z.object({
    method: z.literal(
      'notifications/claude/channel/permission_request',
    ),
    params: z.object({
      request_id: z.string(),
      tool_name: z.string(),
      description: z.string(),
      input_preview: z.string(),
    }),
  })

  // Track which user to send permission prompts to (most recent sender)
  let lastSenderId: string | null = null

  mcp.setNotificationHandler(
    PermissionRequestSchema,
    async ({ params }) => {
      if (!lastSenderId) {
        console.error(
          '[wechat] Permission request but no active sender to forward to',
        )
        return
      }
      const contextToken = contextTokens.get(lastSenderId)
      if (!contextToken) return

      const prompt =
        `Claude wants to run ${params.tool_name}:\n${params.description}\n\n` +
        `Reply "yes ${params.request_id}" or "no ${params.request_id}"`

      await client.sendMessage(lastSenderId, contextToken, prompt)
    },
  )

  // Connect MCP over stdio FIRST so Claude Code handshake succeeds
  await mcp.connect(new StdioServerTransport())

  // Now login to WeChat via MCP elicitation (shows QR code to user)
  const token = await login(client, mcp)
  client.setToken(token)

  console.error('[wechat] Connected and logged in, starting message poller...')
  await writeFile(join(PROJECT_DIR, 'debug-startup.log'), `${new Date().toISOString()} token=${token.substring(0, 10)}... poller starting\n`, { flag: 'a' })

  // --- Permission verdict regex ---
  const PERMISSION_REPLY_RE =
    /^\s*(y|yes|n|no)\s+([a-km-z]{5})\s*$/i

  // --- Shutdown handler: exit when Claude Code closes the MCP connection ---
  const abort = new AbortController()
  let shuttingDown = false
  function shutdown(): void {
    if (shuttingDown) return
    shuttingDown = true
    console.error('[wechat] shutting down')
    abort.abort()
    setTimeout(() => process.exit(0), 2000)
  }
  process.stdin.on('end', shutdown)
  process.stdin.on('close', shutdown)
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)

  await startPoller(
    client,
    '',
    (msg: WeixinMessage) => {
      try {
        const senderId = msg.from_user_id
        console.error(`[wechat] Received message from ${senderId}`)
        // Debug: write received messages to a file so we can verify the poller works
        const debugPath = join(PROJECT_DIR, 'debug-messages.log')
        writeFile(debugPath, `${new Date().toISOString()} from=${senderId} text=${JSON.stringify(msg.item_list)}\n`, { flag: 'a' }).catch(() => {})

        // Gate on sender allowlist (empty = allow all for initial setup)
        if (allowed.size > 0 && !allowed.has(senderId)) {
          console.error(
            `[wechat] Blocked message from ${senderId} (not in allowlist)`,
          )
          return
        }

        // Store context token for replies (persist to file)
        contextTokens.set(senderId, msg.context_token)
        saveContextTokens(contextTokens).catch(() => {})
        lastSenderId = senderId

        const text = extractText(msg)
        console.error(`[wechat] Message text: ${text}`)

        // Check for permission verdict
        const m = PERMISSION_REPLY_RE.exec(text)
        if (m) {
          console.error(`[wechat] Permission verdict: ${m[1]} ${m[2]}`)
          void mcp.notification({
            method: 'notifications/claude/channel/permission' as any,
            params: {
              request_id: m[2].toLowerCase(),
              behavior: m[1].toLowerCase().startsWith('y')
                ? 'allow'
                : 'deny',
            },
          })
          return
        }

        // Forward as channel event (fire-and-forget, matching fakechat pattern)
        console.error(`[wechat] Forwarding to Claude Code as channel event`)
        void mcp.notification({
          method: 'notifications/claude/channel',
          params: {
            content: text,
            meta: {
              from_user_id: senderId,
            },
          },
        })
      } catch (err) {
        console.error(`[wechat] Error handling message:`, err)
      }
    },
    abort.signal,
  )
}

main().catch((err) => {
  console.error('[wechat] Fatal error:', err)
  process.exit(1)
})
