import { describe, expect, it } from 'vitest';

import { RealtimeChannel, RealtimeNamespace } from '@/realtime/channels/channel.constants';

describe('RealtimeChannel 命名空间频道工厂', () => {
  it('应正确构造个人私有频道 (user#<userId>)', () => {
    const channel = RealtimeChannel.user('01931234-0000-7000-8000-000000000001');
    expect(channel).toBe('user#01931234-0000-7000-8000-000000000001');
  });

  it('应正确构造全网公开频道 (public:<name>)', () => {
    const channel = RealtimeChannel.public('announcements');
    expect(channel).toBe('public:announcements');
  });

  it('应正确构造协同房间频道 (room:<roomId>)', () => {
    const channel = RealtimeChannel.room('board-888');
    expect(channel).toBe('room:board-888');
  });

  it('应正确构造管理员受限频道 (admin:<topic>)', () => {
    const channel = RealtimeChannel.admin('metrics');
    expect(channel).toBe('admin:metrics');
  });

  describe('parse() 频道结构化解析', () => {
    it('应准确解析 user 个人命名空间频道', () => {
      const parsed = RealtimeChannel.parse('user#u-12345');
      expect(parsed).toEqual({
        namespace: RealtimeNamespace.USER,
        id: 'u-12345',
        isUserLimited: true,
      });
    });

    it('应准确解析 public 公开命名空间频道', () => {
      const parsed = RealtimeChannel.parse('public:live-feed');
      expect(parsed).toEqual({
        namespace: RealtimeNamespace.PUBLIC,
        id: 'live-feed',
        isUserLimited: false,
      });
    });

    it('应准确解析 room 协同房间命名空间频道', () => {
      const parsed = RealtimeChannel.parse('room:meeting-99');
      expect(parsed).toEqual({
        namespace: RealtimeNamespace.ROOM,
        id: 'meeting-99',
        isUserLimited: false,
      });
    });

    it('应准确解析 admin 管理员命名空间频道', () => {
      const parsed = RealtimeChannel.parse('admin:audit-log');
      expect(parsed).toEqual({
        namespace: RealtimeNamespace.ADMIN,
        id: 'audit-log',
        isUserLimited: false,
      });
    });

    it('面对未配置前缀的普通频道应优雅回退', () => {
      const parsed = RealtimeChannel.parse('chat-global');
      expect(parsed).toEqual({
        namespace: undefined,
        id: 'chat-global',
        isUserLimited: false,
      });
    });

    it('面对自定义前缀频道应按冒号分隔解析', () => {
      const parsed = RealtimeChannel.parse('custom:test');
      expect(parsed).toEqual({
        namespace: 'custom',
        id: 'test',
        isUserLimited: false,
      });
    });
  });
});
