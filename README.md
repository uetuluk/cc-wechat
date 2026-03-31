# WeChat Channel for Claude Code

A [Claude Code channel](https://code.claude.com/docs/en/channels-reference) that bridges your personal WeChat account to a Claude Code session via Tencent's [iLink bot API](https://ilinkai.weixin.qq.com). Two-way messaging with permission relay support.

## Features

- **Two-way chat** — WeChat messages arrive in Claude's context; Claude replies back to WeChat
- **Permission relay** — tool-approval prompts are forwarded to WeChat so you can approve/deny remotely
- **QR code login** — scan with WeChat to authenticate, credentials persist locally
- **Sender allowlist** — restrict which WeChat users can reach your session
- **Cursor persistence** — poller state survives reconnects so no messages are missed

## Prerequisites

- [Bun](https://bun.sh) runtime (v1.3+)
- [Claude Code](https://code.claude.com) v2.1.81+
- A personal WeChat account

## Installation

### Via Plugin Marketplace (recommended)

Add the marketplace and install:

```bash
# Add the marketplace
/plugin marketplace add uetuluk/cc-wechat

# Install the plugin
/plugin install cc-wechat@cc-wechat
```

Then start Claude Code with the channel enabled:

```bash
claude --channels plugin:cc-wechat@cc-wechat
```

> **Note:** During the research preview, custom channels require the development flag:
> ```bash
> claude --dangerously-load-development-channels plugin:cc-wechat@cc-wechat
> ```

### Via Local Plugin Directory

```bash
git clone https://github.com/uetuluk/cc-wechat.git
cd cc-wechat
bun install

claude --plugin-dir . --dangerously-load-development-channels server:wechat
```

### Via npm

```bash
npm install -g @uetuluk/cc-wechat
```

## Setup

On first run, a QR code dialog appears in Claude Code — scan it with WeChat to log in. Credentials are saved locally for subsequent sessions.

## How It Works

```
WeChat App <-> iLink API (ilinkai.weixin.qq.com) <-> This channel (local) <-> Claude Code (stdio)
```

The channel runs as an MCP server spawned by Claude Code. It polls WeChat's iLink long-polling endpoint for inbound messages and uses the MCP notification system to forward them to Claude.

- WeChat messages arrive in Claude's context as `<channel source="wechat" from_user_id="...">` tags
- Claude replies using the `wechat_reply` tool
- Permission prompts forward to WeChat; respond with `yes <id>` or `no <id>`

## Sender Allowlist

Edit `access.json` to restrict which WeChat users can message Claude:

```json
{
  "allowed_senders": ["user123@im.wechat"]
}
```

An empty list allows all senders (useful during initial setup to discover your user ID from the channel tags).

## Configuration

| File | Purpose |
|------|---------|
| `.mcp.json` | MCP server config (command + args) |
| `credentials.json` | Saved bot token (auto-created on login) |
| `access.json` | Sender allowlist |
| `.context-tokens.json` | Persisted context tokens for replies |
| `.poller-state.json` | Polling cursor (survives restarts) |

## Architecture

```
src/
  wechat-channel.ts   # Entry point: MCP server + orchestration
  ilink-client.ts     # iLink HTTP client (login, poll, send)
  poller.ts           # Long-poll loop with cursor management
  types.ts            # TypeScript types for iLink API
```

## Development

```bash
bun install
bun test
bun run typecheck
```

## License

MIT
