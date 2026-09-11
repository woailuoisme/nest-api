/**
 * Centrifugo 频道命名空间枚举
 * 对应 deploy/centrifugo/config.yaml 中的 namespaces 定义
 */
export enum RealtimeNamespace {
  /** 个人专属频道：支持断线重连补发与历史回溯 */
  USER = 'user',
  /** 公共广播频道：客户端免订阅令牌直接收听 */
  PUBLIC = 'public',
  /** 多人协同互动房间：支持在席列表 (Presence)、上下线事件与历史回溯 */
  ROOM = 'room',
  /** 管理员专享频道：强制 RBAC 守卫鉴权 */
  ADMIN = 'admin',
}

/**
 * 强类型频道命名工厂 (RealtimeChannel)
 * 封装工业级 Centrifugo 频道规范，避免业务层硬编码字符串
 */
export const RealtimeChannel = {
  /**
   * 生成个人私有用户通道 (User-limited channel)
   * 格式: user#<userId>
   * 特性: 当开启 allow_user_limited_channels 时，Centrifugo 本地核验 sub，无需单独签发 Subscription Token
   */
  user(userId: string): string {
    return `user#${userId}`;
  },

  /**
   * 生成公共广播通道
   * 格式: public:<topic>
   */
  public(topic: string): string {
    return `public:${topic}`;
  },

  /**
   * 生成多人互动协作房间
   * 格式: room:<roomId>
   */
  room(roomId: string): string {
    return `room:${roomId}`;
  },

  /**
   * 生成管理后台专享受限通道
   * 格式: admin:<domain>
   */
  admin(domain: string): string {
    return `admin:${domain}`;
  },

  /**
   * 解析频道信息（命名空间与标识符）
   */
  parse(channel: string): { namespace?: string; id?: string; isUserLimited: boolean } {
    if (channel.includes('#')) {
      const [namespace, id] = channel.split('#');
      return { namespace, id, isUserLimited: true };
    }

    if (channel.includes(':')) {
      const [namespace, id] = channel.split(':');
      return { namespace, id, isUserLimited: false };
    }

    return { namespace: undefined, id: channel, isUserLimited: false };
  },
} as const;
