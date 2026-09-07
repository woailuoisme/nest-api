import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import type { Server, Socket } from 'socket.io';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '@/common/constants/roles';
import { ChannelManager } from '@/realtime/channels/channel-manager.service';
import { RealtimeGateway } from '@/realtime/realtime.gateway';

describe('RealtimeGateway', () => {
  let gateway: RealtimeGateway;
  let jwtService: { verifyAsync: ReturnType<typeof vi.fn> };
  let configService: { get: ReturnType<typeof vi.fn> };
  let channelManager: ChannelManager;
  let mockServer: {
    to: ReturnType<typeof vi.fn>;
    emit: ReturnType<typeof vi.fn>;
    disconnectSockets: ReturnType<typeof vi.fn>;
    sockets: { sockets: Map<string, any> };
  };

  beforeEach(() => {
    jwtService = { verifyAsync: vi.fn() };
    configService = { get: vi.fn().mockReturnValue('jwt-secret') };
    channelManager = new ChannelManager();
    mockServer = {
      to: vi.fn().mockReturnThis(),
      emit: vi.fn(),
      disconnectSockets: vi.fn(),
      sockets: { sockets: new Map([['socket-1', {}]]) },
    };

    gateway = new RealtimeGateway(
      jwtService as unknown as JwtService,
      configService as unknown as ConfigService<any, true>,
      channelManager,
    );
    gateway.server = mockServer as unknown as Server;
  });

  const createMockSocket = (auth: Record<string, any> = {}, userPayload?: any): Socket => {
    return {
      id: 'sock-1',
      handshake: { auth, headers: {}, query: {} },
      data: userPayload ? { user: userPayload } : {},
      join: vi.fn(),
      leave: vi.fn(),
      emit: vi.fn(),
      disconnect: vi.fn(),
    } as unknown as Socket;
  };

  it('handleConnection 鉴权成功后应加入用户专属房间并下发 connected 回执', async () => {
    const socket = createMockSocket({ token: 'valid-jwt' });
    jwtService.verifyAsync.mockResolvedValue({ sub: '100', email: 'a@b.com', role: Role.ADMIN });

    await gateway.handleConnection(socket);

    expect(socket.join).toHaveBeenCalledWith('user:100');
    expect(socket.emit).toHaveBeenCalledWith('connected', expect.objectContaining({ userId: 100 }));
    expect(socket.disconnect).not.toHaveBeenCalled();
  });

  it('handleConnection 未携带 token 应下发 error 并断开连接', async () => {
    vi.useFakeTimers();
    const socket = createMockSocket({});

    await gateway.handleConnection(socket);

    expect(socket.emit).toHaveBeenCalledWith('error', expect.any(Object));
    vi.advanceTimersByTime(50);
    expect(socket.disconnect).toHaveBeenCalledWith(true);
    vi.useRealTimers();
  });

  it('handleSubscribe 针对未认证客户端应拒绝并返回 unauthorized', async () => {
    const socket = createMockSocket({});
    const res = await gateway.handleSubscribe(socket, { channel: 'orders.live' });

    expect(socket.join).not.toHaveBeenCalled();
    expect(res).toMatchObject({ status: 'unauthorized' });
  });

  it('handleSubscribe 针对公共频道在认证后应加入房间并返回 ok', async () => {
    const socket = createMockSocket({}, { id: 100, role: Role.USER });
    const res = await gateway.handleSubscribe(socket, { channel: 'orders.live' });

    expect(socket.join).toHaveBeenCalledWith('orders.live');
    expect(res).toMatchObject({ status: 'ok', channel: 'orders.live' });
  });

  it('handleSubscribe 针对未授权的私有频道应拒绝并返回 forbidden', async () => {
    // 用户 100 尝试订阅用户 200 的私有频道
    const socket = createMockSocket({}, { id: 100, role: Role.USER });
    const res = await gateway.handleSubscribe(socket, { channel: 'private:user.200' });

    expect(socket.join).not.toHaveBeenCalled();
    expect(res).toMatchObject({ status: 'forbidden', channel: 'private:user.200' });
  });

  it('handleSubscribe 针对有权限的私有频道应允许加入', async () => {
    // 用户 100 订阅自身私有频道
    const socket = createMockSocket({}, { id: 100, role: Role.USER });
    const res = await gateway.handleSubscribe(socket, { channel: 'private:user.100' });

    expect(socket.join).toHaveBeenCalledWith('private:user.100');
    expect(res).toMatchObject({ status: 'ok', channel: 'private:user.100' });
  });

  it('handleUnsubscribe 应退出房间并返回 ok', () => {
    const socket = createMockSocket({});
    const res = gateway.handleUnsubscribe(socket, { channel: 'orders.live' });

    expect(socket.leave).toHaveBeenCalledWith('orders.live');
    expect(res).toMatchObject({ status: 'ok', channel: 'orders.live' });
  });

  it('sendToUser 应向用户专属房间投递', () => {
    gateway.sendToUser({
      event: 'order:paid',
      targetUserId: 100,
      data: { orderId: 'O1' },
      timestamp: Date.now(),
    });

    expect(mockServer.to).toHaveBeenCalledWith('user:100');
    expect(mockServer.emit).toHaveBeenCalledWith('order:paid', { orderId: 'O1' });
  });

  it('broadcast 应向指定频道投递', () => {
    gateway.broadcast({
      event: 'site:notice',
      channel: 'announcements',
      data: { msg: 'update' },
      timestamp: Date.now(),
    });

    expect(mockServer.to).toHaveBeenCalledWith('announcements');
    expect(mockServer.emit).toHaveBeenCalledWith('site:notice', { msg: 'update' });
  });
});
