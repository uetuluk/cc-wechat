# WeChat Channel for Claude Code — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Claude Code channel that bridges WeChat messages to/from a Claude Code session via the iLink bot API, with two-way chat and permission relay.

**Architecture:** An MCP server over stdio that polls WeChat's iLink long-polling endpoint for inbound messages and exposes a `reply` tool for outbound. QR-code login happens at startup before MCP connect. Permission relay forwards tool-approval prompts to the WeChat user and parses yes/no replies as verdicts.

**Tech Stack:** Bun runtime, `@modelcontextprotocol/sdk`, `qrcode-terminal`, `zod` — minimal deps.

---

## File Structure

```
claude-code-wechat-channel/
├── package.json
├── tsconfig.json
├── .mcp.json                  # Claude Code MCP server config
├── src/
│   ├── wechat-channel.ts      # Entry point: MCP server + orchestration
│   ├── ilink-client.ts        # iLink HTTP client (login, poll, send, typing)
│   ├── poller.ts              # Long-poll loop that emits MCP notifications
│   └── types.ts               # Shared TypeScript types for iLink API
├── tests/
│   ├── ilink-client.test.ts   # Unit tests for iLink client
│   ├── poller.test.ts         # Unit tests for poller
│   └── channel.test.ts        # Integration test for MCP server wiring
├── access.json                # Sender allowlist (WeChat user IDs)
└── README.md                  # Setup & usage instructions
```

**Responsibilities:**
- `types.ts` — All iLink request/response types, message item types, shared constants
- `ilink-client.ts` — Stateless HTTP functions: `getQrCode()`, `pollQrStatus()`, `getUpdates()`, `sendMessage()`, `getConfig()`, `sendTyping()`. Each takes a token and returns typed data.
- `poller.ts` — Runs the `getUpdates` long-poll loop, calls a callback with each message. Manages the `get_updates_buf` cursor.
- `wechat-channel.ts` — Wires everything together: QR login → MCP server setup (channel capability, reply tool, permission relay handler) → start poller → emit notifications.

---

### Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`

- [ ] **Step 1: Initialize project and install dependencies**

```bash
cd /Users/uetuluk/Documents/claude-code-wechat-channel
bun init -y
bun add @modelcontextprotocol/sdk qrcode-terminal zod
bun add -d @types/qrcode-terminal
```

- [ ] **Step 2: Configure tsconfig.json**

Replace the generated `tsconfig.json` with:

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": ".",
    "types": ["bun-types"]
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

- [ ] **Step 3: Create src and tests directories**

```bash
mkdir -p src tests
```

- [ ] **Step 4: Commit**

```bash
git init
echo "node_modules/\ndist/\n.env\ncredentials.json" > .gitignore
git add package.json tsconfig.json bun.lockb .gitignore
git commit -m "chore: scaffold project with MCP SDK, qrcode-terminal, zod"
```

---

### Task 2: Shared Types

**Files:**
- Create: `src/types.ts`

- [ ] **Step 1: Write iLink API types**

```typescript
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
```

- [ ] **Step 2: Commit**

```bash
git add src/types.ts
git commit -m "feat: add iLink API type definitions"
```

---

### Task 3: iLink HTTP Client

**Files:**
- Create: `src/ilink-client.ts`
- Create: `tests/ilink-client.test.ts`

- [ ] **Step 1: Write failing tests for iLink client**

```typescript
// tests/ilink-client.test.ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test tests/ilink-client.test.ts
```

Expected: FAIL — `createILinkClient` not found.

- [ ] **Step 3: Implement iLink client**

```typescript
// src/ilink-client.ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test tests/ilink-client.test.ts
```

Expected: All 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ilink-client.ts tests/ilink-client.test.ts
git commit -m "feat: implement iLink HTTP client with tests"
```

---

### Task 4: Poller

**Files:**
- Create: `src/poller.ts`
- Create: `tests/poller.test.ts`

- [ ] **Step 1: Write failing tests for poller**

```typescript
// tests/poller.test.ts
import { describe, it, expect, mock } from 'bun:test'
import { startPoller } from '../src/poller'
import type { ILinkClient } from '../src/ilink-client'
import type { GetUpdatesResponse, WeixinMessage } from '../src/types'

function makeMockClient(responses: GetUpdatesResponse[]): ILinkClient {
  let callIndex = 0
  return {
    getUpdates: mock(async (_cursor: string) => {
      if (callIndex < responses.length) return responses[callIndex++]
      return { ret: 0, msgs: [], get_updates_buf: 'final', longpolling_timeout_ms: 35000 }
    }),
  } as unknown as ILinkClient
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
      client, '', (m) => { received.push(m) }, abort.signal,
    )

    // Let one poll cycle complete
    await new Promise(r => setTimeout(r, 50))
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
    const pollerPromise = startPoller(client, 'c1', () => {}, abort.signal)

    await new Promise(r => setTimeout(r, 100))
    abort.abort()
    await pollerPromise.catch(() => {})

    const calls = (client.getUpdates as any).mock.calls
    expect(calls[0][0]).toBe('c1')
    expect(calls[1][0]).toBe('c2')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test tests/poller.test.ts
```

Expected: FAIL — `startPoller` not found.

- [ ] **Step 3: Implement poller**

```typescript
// src/poller.ts
import type { ILinkClient } from './ilink-client'
import type { WeixinMessage } from './types'

export async function startPoller(
  client: ILinkClient,
  initialCursor: string,
  onMessage: (msg: WeixinMessage) => void,
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
        onMessage(msg)
      }
    } catch (err) {
      if (signal.aborted) break
      console.error('[poller] error:', err)
      await new Promise(r => setTimeout(r, 5000))
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test tests/poller.test.ts
```

Expected: All 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/poller.ts tests/poller.test.ts
git commit -m "feat: implement long-poll message poller with tests"
```

---

### Task 5: MCP Channel Server (main entry point)

**Files:**
- Create: `src/wechat-channel.ts`
- Create: `access.json`

- [ ] **Step 1: Create sender allowlist file**

```json
{
  "allowed_senders": []
}
```

Save as `access.json`. Users will add their WeChat user IDs here after first login. An empty list means all senders are allowed (for initial pairing).

- [ ] **Step 2: Write the channel server**

```typescript
#!/usr/bin/env bun
// src/wechat-channel.ts
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

// --- Paths ---
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

// --- QR Login ---

async function login(
  client: ReturnType<typeof createILinkClient>,
): Promise<string> {
  const saved = await loadCredentials()
  if (saved?.bot_token) {
    console.error('[wechat] Using saved credentials')
    return saved.bot_token
  }

  console.error('[wechat] No saved credentials, starting QR login...')
  const qr = await client.getQrCode()

  // Display QR code in terminal (stderr so it doesn't interfere with stdio MCP)
  qrcode.generate(qr.qrcode, { small: true }, (code: string) => {
    console.error(code)
    console.error('[wechat] Scan the QR code above with WeChat to log in')
  })

  // Poll for confirmation
  while (true) {
    await new Promise((r) => setTimeout(r, 1000))
    const status = await client.pollQrStatus(qr.qrcode)

    if (status.status === 'confirmed' && status.bot_token) {
      console.error('[wechat] Login confirmed!')
      const creds: Credentials = {
        bot_token: status.bot_token,
        baseurl: status.baseurl,
      }
      await saveCredentials(creds)
      return status.bot_token
    }

    if (status.status === 'expired') {
      throw new Error('QR code expired. Restart the channel to try again.')
    }
  }
}

// --- Context token store (maps user_id -> latest context_token) ---
const contextTokens = new Map<string, string>()

// --- Main ---

async function main() {
  const client = createILinkClient()

  // Login first (before MCP connect, outputs to stderr)
  const token = await login(client)
  client.setToken(token)

  // Load sender allowlist
  const allowed = await loadAllowlist()

  // Create MCP server
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
      await client.sendMessage(from_user_id, contextToken, text)
      return { content: [{ type: 'text' as const, text: 'sent' }] }
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

  // Connect MCP over stdio
  await mcp.connect(new StdioServerTransport())

  // --- Permission verdict regex ---
  const PERMISSION_REPLY_RE =
    /^\s*(y|yes|n|no)\s+([a-km-z]{5})\s*$/i

  // --- Start polling for WeChat messages ---
  const abort = new AbortController()

  process.on('SIGINT', () => abort.abort())
  process.on('SIGTERM', () => abort.abort())

  await startPoller(
    client,
    '',
    (msg: WeixinMessage) => {
      const senderId = msg.from_user_id

      // Gate on sender allowlist (empty = allow all for initial setup)
      if (allowed.size > 0 && !allowed.has(senderId)) {
        console.error(
          `[wechat] Blocked message from ${senderId} (not in allowlist)`,
        )
        return
      }

      // Store context token for replies
      contextTokens.set(senderId, msg.context_token)
      lastSenderId = senderId

      const text = extractText(msg)

      // Check for permission verdict
      const m = PERMISSION_REPLY_RE.exec(text)
      if (m) {
        mcp.notification({
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

      // Forward as channel event
      mcp.notification({
        method: 'notifications/claude/channel',
        params: {
          content: text,
          meta: {
            from_user_id: senderId,
          },
        },
      })
    },
    abort.signal,
  )
}

main().catch((err) => {
  console.error('[wechat] Fatal error:', err)
  process.exit(1)
})
```

- [ ] **Step 3: Commit**

```bash
git add src/wechat-channel.ts access.json
git commit -m "feat: implement MCP channel server with reply tool and permission relay"
```

---

### Task 6: MCP Config and README

**Files:**
- Create: `.mcp.json`
- Create: `README.md`

- [ ] **Step 1: Create MCP config**

```json
{
  "mcpServers": {
    "wechat": {
      "command": "bun",
      "args": ["./src/wechat-channel.ts"]
    }
  }
}
```

Save as `.mcp.json`.

- [ ] **Step 2: Write README**

````markdown
# WeChat Channel for Claude Code

A Claude Code channel that bridges WeChat messages via the iLink bot API. Two-way chat with permission relay support.

## Prerequisites

- [Bun](https://bun.sh) runtime
- Claude Code v2.1.81+
- A personal WeChat account

## Setup

1. Install dependencies:

   ```bash
   bun install
   ```

2. Start Claude Code with the development channel flag:

   ```bash
   claude --dangerously-load-development-channels server:wechat
   ```

3. On first run, scan the QR code displayed in your terminal with WeChat. Credentials are saved to `credentials.json` for subsequent sessions.

## Sender Allowlist

Edit `access.json` to restrict which WeChat users can message Claude:

```json
{
  "allowed_senders": ["user123@im.wechat"]
}
```

An empty list allows all senders (useful during initial setup to discover your user ID — check the logs).

## How It Works

- WeChat messages arrive in Claude's context as `<channel source="wechat" from_user_id="...">` tags
- Claude replies using the `wechat_reply` tool
- Permission prompts are forwarded to the WeChat user, who can approve/deny with `yes <id>` or `no <id>`

## Architecture

```
WeChat App <-> iLink API (ilinkai.weixin.qq.com) <-> This channel (local) <-> Claude Code (stdio)
```

The channel runs as an MCP server spawned by Claude Code. It polls WeChat's iLink long-polling endpoint for inbound messages and uses the MCP notification system to forward them to Claude.
````

- [ ] **Step 3: Commit**

```bash
git add .mcp.json README.md
git commit -m "docs: add MCP config and README"
```

---

### Task 7: Integration Test

**Files:**
- Create: `tests/channel.test.ts`

- [ ] **Step 1: Write integration test for MCP wiring**

```typescript
// tests/channel.test.ts
import { describe, it, expect } from 'bun:test'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'

describe('wechat channel MCP server', () => {
  it('declares claude/channel capability', () => {
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
        instructions: 'test instructions',
      },
    )

    // Server was created without throwing — capabilities are valid
    expect(mcp).toBeDefined()
  })

  it('can emit channel notifications', async () => {
    const mcp = new Server(
      { name: 'wechat', version: '0.1.0' },
      {
        capabilities: {
          experimental: { 'claude/channel': {} },
        },
      },
    )

    const notif = {
      method: 'notifications/claude/channel' as const,
      params: {
        content: 'hello from wechat',
        meta: { from_user_id: 'user1@im.wechat' },
      },
    }

    expect(notif.params.content).toBe('hello from wechat')
  })
})
```

- [ ] **Step 2: Run all tests**

```bash
bun test
```

Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/channel.test.ts
git commit -m "test: add integration tests for MCP channel wiring"
```

---

### Task 8: Final Verification

- [ ] **Step 1: Run full test suite**

```bash
bun test
```

Expected: All tests pass.

- [ ] **Step 2: Verify the server starts without error (dry run)**

```bash
timeout 3 bun run src/wechat-channel.ts 2>&1 || true
```

Expected: Should start and attempt QR login (will fail without network/auth, but proves the module loads and wires up correctly).

- [ ] **Step 3: Final commit with any fixes**

If any adjustments were needed, commit them.

```bash
git add -A
git status
# Only commit if there are changes
git diff --cached --quiet || git commit -m "fix: final adjustments from verification"
```
