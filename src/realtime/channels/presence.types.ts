/**
 * Presence 成员基础属性
 */
export interface PresenceMemberInfo {
  email?: string;
  name?: string;
  role?: string;
  [key: string]: unknown;
}

/**
 * Presence 频道成员实体契约
 */
export interface PresenceMember<T = PresenceMemberInfo> {
  userId: string;
  clientId?: string;
  userInfo: T;
  joinedAt: number;
  updatedAt: number;
}

/** 默认 Presence 租期超时时间（秒）：客户端若 60s 内未发起心跳保活则自动判定离线 */
export const DEFAULT_PRESENCE_TTL_SECONDS = 60;
