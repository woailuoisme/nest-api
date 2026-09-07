import type { Socket } from 'socket.io';

/**
 * 从 Socket.IO 客户端连接握手中提取 JWT 认证 Token
 * 优先级：
 * 1. `client.handshake.auth.token`（Socket.IO 官方推荐客户端传参位置）
 * 2. `headers.authorization`（标准 Bearer Token 请求头）
 * 3. `query.token`（降级兼容 Query String 传参）
 */
export function extractSocketToken(client: Socket): string | null {
  const authToken = client.handshake.auth?.token;
  if (typeof authToken === 'string' && authToken.trim().length > 0) {
    return authToken.trim();
  }

  const authHeader = client.handshake.headers?.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }

  const queryToken = client.handshake.query?.token;
  if (typeof queryToken === 'string' && queryToken.trim().length > 0) {
    return queryToken.trim();
  }

  return null;
}
