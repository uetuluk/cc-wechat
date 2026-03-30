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
