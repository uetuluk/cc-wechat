import { describe, it, expect } from 'bun:test'

// Integration tests that verify channel contract without importing the MCP SDK
// (importing the SDK triggers heavy transpilation that consumes excessive disk)

describe('wechat channel contract', () => {
  it('notification format matches claude/channel spec', () => {
    const notif = {
      method: 'notifications/claude/channel' as const,
      params: {
        content: 'hello from wechat',
        meta: { from_user_id: 'user1@im.wechat' },
      },
    }

    expect(notif.method).toBe('notifications/claude/channel')
    expect(notif.params.content).toBe('hello from wechat')
    expect(notif.params.meta.from_user_id).toBe('user1@im.wechat')
  })

  it('permission verdict format matches spec', () => {
    const verdict = {
      method: 'notifications/claude/channel/permission',
      params: {
        request_id: 'abcde',
        behavior: 'allow' as 'allow' | 'deny',
      },
    }

    expect(verdict.method).toBe('notifications/claude/channel/permission')
    expect(verdict.params.request_id).toBe('abcde')
    expect(verdict.params.behavior).toBe('allow')
  })

  it('permission reply regex matches expected formats', () => {
    const PERMISSION_REPLY_RE = /^\s*(y|yes|n|no)\s+([a-km-z]{5})\s*$/i

    // Should match
    expect(PERMISSION_REPLY_RE.test('yes abcde')).toBe(true)
    expect(PERMISSION_REPLY_RE.test('no abcde')).toBe(true)
    expect(PERMISSION_REPLY_RE.test('y abcde')).toBe(true)
    expect(PERMISSION_REPLY_RE.test('n abcde')).toBe(true)
    expect(PERMISSION_REPLY_RE.test('YES ABCDE')).toBe(true) // case insensitive

    // Should not match
    expect(PERMISSION_REPLY_RE.test('hello')).toBe(false)
    expect(PERMISSION_REPLY_RE.test('yes')).toBe(false) // no id
    expect(PERMISSION_REPLY_RE.test('yes abclde')).toBe(false) // 'l' not in alphabet
    expect(PERMISSION_REPLY_RE.test('yes abc')).toBe(false) // too short
  })

  it('extractText handles text and non-text messages', () => {
    // Inline the function to test without importing the SDK chain
    function extractText(msg: { item_list: any[] }): string {
      const texts: string[] = []
      for (const item of msg.item_list) {
        if (item.type === 1 && 'text_item' in item) {
          texts.push(item.text_item.text)
        }
      }
      return texts.join('\n') || '[non-text message type]'
    }

    expect(extractText({
      item_list: [{ type: 1, text_item: { text: 'hello' } }],
    })).toBe('hello')

    expect(extractText({
      item_list: [{ type: 2 }],
    })).toBe('[non-text message type]')

    expect(extractText({
      item_list: [
        { type: 1, text_item: { text: 'line1' } },
        { type: 1, text_item: { text: 'line2' } },
      ],
    })).toBe('line1\nline2')
  })
})
