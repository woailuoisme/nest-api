import { describe, expect, it } from 'vitest';
import { NoopSearchDriver } from '@/common/search/drivers/noop.driver';

describe('NoopSearchDriver', () => {
  const driver = new NoopSearchDriver();

  it('name 属性应为 noop', () => {
    expect(driver.name).toBe('noop');
  });

  it('索引增删查改应为安全空操作并不报错', async () => {
    await expect(driver.createOrUpdateIndex('test_idx')).resolves.toBeUndefined();
    await expect(driver.updateSettings('test_idx', { searchableAttributes: ['name'] })).resolves.toBeUndefined();
    await expect(driver.addDocuments('test_idx', [{ id: '1', name: 'foo' }])).resolves.toBeUndefined();
    await expect(driver.deleteDocument('test_idx', '1')).resolves.toBeUndefined();
    await expect(driver.deleteDocuments('test_idx', ['1', '2'])).resolves.toBeUndefined();
    await expect(driver.deleteAllDocuments('test_idx')).resolves.toBeUndefined();
    await expect(driver.deleteIndex('test_idx')).resolves.toBeUndefined();
  });

  it('search 应返回结构完整但为空的结果集', async () => {
    const result = await driver.search('test_idx', 'hello', { limit: 10, offset: 0 });
    expect(result).toEqual({
      hits: [],
      query: 'hello',
      limit: 10,
      offset: 0,
      estimatedTotalHits: 0,
      totalHits: 0,
      processingTimeMs: 0,
    });
  });

  it('checkHealth 应返回 up 状态与 driver 信息', async () => {
    const health = await driver.checkHealth();
    expect(health.status).toBe('up');
    expect(health.driver).toBe('noop');
  });
});
