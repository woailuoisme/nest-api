import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '@/common/constants/roles';
import type { CurrentUserPayload } from '@/common/decorators/current-user.decorator';
import { BroadcastingController, RealtimeController } from '@/realtime/realtime.controller';
import type { RealtimeService } from '@/realtime/realtime.service';

describe('RealtimeController & BroadcastingController', () => {
  let controller: RealtimeController;
  let broadcastingController: BroadcastingController;
  let mockRealtimeService: {
    createSseStream: ReturnType<typeof vi.fn>;
    authenticatePusher: ReturnType<typeof vi.fn>;
  };
  let mockUser: CurrentUserPayload;

  beforeEach(() => {
    mockRealtimeService = {
      createSseStream: vi.fn().mockReturnValue(of({ type: 'connected', data: {} })),
      authenticatePusher: vi.fn().mockResolvedValue({ auth: 'pusher-key:sig-123' }),
    };

    controller = new RealtimeController(mockRealtimeService as unknown as RealtimeService);
    broadcastingController = new BroadcastingController(mockRealtimeService as unknown as RealtimeService);
    mockUser = { id: 1, email: 'test@example.com', role: Role.USER };
  });

  describe('stream()', () => {
    it('应委托给 realtimeService.createSseStream 构造流', () => {
      const mockReq = { raw: {} } as any;

      const stream$ = controller.stream(mockUser, mockReq);

      expect(mockRealtimeService.createSseStream).toHaveBeenCalledWith(mockUser, mockReq);
      expect(stream$).toBeDefined();
    });
  });

  describe('authenticate() (Pusher / Soketi Auth)', () => {
    it('RealtimeController.authenticate 应委托给 realtimeService.authenticatePusher', async () => {
      const dto = { socket_id: '123.456', channel_name: 'private-user.1' };
      const result = await controller.authenticate(mockUser, dto);

      expect(mockRealtimeService.authenticatePusher).toHaveBeenCalledWith(mockUser, dto);
      expect(result).toEqual({ auth: 'pusher-key:sig-123' });
    });

    it('BroadcastingController.authenticate 应委托给 realtimeService.authenticatePusher', async () => {
      const dto = { socket_id: '123.456', channel_name: 'private-user.1' };
      const result = await broadcastingController.authenticate(mockUser, dto);

      expect(mockRealtimeService.authenticatePusher).toHaveBeenCalledWith(mockUser, dto);
      expect(result).toEqual({ auth: 'pusher-key:sig-123' });
    });
  });
});
