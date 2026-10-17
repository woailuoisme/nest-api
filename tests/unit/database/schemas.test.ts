import { describe, expect, it } from 'vitest';

import * as schema from '@/database/drizzle/schema';
import { media } from '@/database/drizzle/schema/media.schema';
import { notifications } from '@/database/drizzle/schema/notifications.schema';

describe('Drizzle Schemas Integrity', () => {
  describe('schema/index.ts 统一聚合导出', () => {
    it('应完整导出所有领域表定义', () => {
      expect(schema.user).toBeDefined();
      expect(schema.session).toBeDefined();
      expect(schema.account).toBeDefined();
      expect(schema.verification).toBeDefined();
      expect(schema.twoFactor).toBeDefined();
      expect(schema.apikey).toBeDefined();
      expect(schema.organization).toBeDefined();
      expect(schema.member).toBeDefined();
      expect(schema.invitation).toBeDefined();
      expect(schema.jwks).toBeDefined();
      expect(schema.deviceCode).toBeDefined();
      expect(schema.media).toBeDefined();
      expect(schema.notifications).toBeDefined();
    });
  });

  describe('media Schema', () => {
    it('应包含符合 Laravel Spatie MediaLibrary 规范的多态媒体字段', () => {
      const cols = media;
      expect(cols.id).toBeDefined();
      expect(cols.uuid).toBeDefined();
      expect(cols.modelType).toBeDefined();
      expect(cols.modelId).toBeDefined();
      expect(cols.collectionName).toBeDefined();
      expect(cols.name).toBeDefined();
      expect(cols.fileName).toBeDefined();
      expect(cols.mimeType).toBeDefined();
      expect(cols.disk).toBeDefined();
      expect(cols.conversionsDisk).toBeDefined();
      expect(cols.size).toBeDefined();
      expect(cols.manipulations).toBeDefined();
      expect(cols.customProperties).toBeDefined();
      expect(cols.generatedConversions).toBeDefined();
      expect(cols.responsiveImages).toBeDefined();
      expect(cols.orderColumn).toBeDefined();
      expect(cols.createdAt).toBeDefined();
      expect(cols.updatedAt).toBeDefined();
    });
  });

  describe('notifications Schema', () => {
    it('应包含符合 Laravel 数据库通知规范的字段', () => {
      const cols = notifications;
      expect(cols.id).toBeDefined();
      expect(cols.type).toBeDefined();
      expect(cols.notifiableType).toBeDefined();
      expect(cols.notifiableId).toBeDefined();
      expect(cols.data).toBeDefined();
      expect(cols.readAt).toBeDefined();
      expect(cols.createdAt).toBeDefined();
      expect(cols.updatedAt).toBeDefined();
    });
  });
});
