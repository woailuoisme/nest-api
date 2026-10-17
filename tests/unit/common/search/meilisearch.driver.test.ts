import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeiliSearchDriver } from '@/common/search/drivers/meilisearch.driver';

describe('MeiliSearchDriver', () => {
  let driver: MeiliSearchDriver;

  beforeEach(() => {
    driver = new MeiliSearchDriver('meilisearch://masterKey@127.0.0.1:7700');
  });

  it('name 应为 meilisearch 且能获取内部 client', () => {
    expect(driver.name).toBe('meilisearch');
    expect(driver.getClient()).toBeDefined();
  });

  it('createOrUpdateIndex 当索引不存在时应调用 createIndex', async () => {
    await driver.createOrUpdateIndex('users', 'id');
    const client = driver.getClient();
    expect(client.createIndex).toHaveBeenCalledWith('users', { primaryKey: 'id' });
  });

  it('updateSettings 应更新 searchable/filterable 等属性', async () => {
    await driver.updateSettings('users', {
      searchableAttributes: ['name', 'email'],
      filterableAttributes: ['role'],
    });
    const client = driver.getClient();
    const index = client.index('users');
    expect(index.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        searchableAttributes: ['name', 'email'],
        filterableAttributes: ['role'],
      }),
    );
  });

  it('addDocuments 应将文档推入指定索引', async () => {
    await driver.addDocuments('users', [{ id: '1', name: 'Alice' }], 'id');
    const client = driver.getClient();
    const index = client.index('users');
    expect(index.addDocuments).toHaveBeenCalledWith([{ id: '1', name: 'Alice' }], { primaryKey: 'id' });
  });

  it('deleteDocuments 与 deleteDocument 应正确委托', async () => {
    const client = driver.getClient();
    const index = client.index('users');

    await driver.deleteDocuments('users', ['1', '2']);
    expect(index.deleteDocuments).toHaveBeenCalledWith(['1', '2']);

    await driver.deleteDocument('users', '1');
    expect(index.deleteDocument).toHaveBeenCalledWith('1');
  });

  it('search 应规范化转换响应信封', async () => {
    const result = await driver.search('users', 'search-term', { limit: 10, offset: 0 });
    expect(result.hits).toEqual([{ id: '1', name: 'Hit 1' }]);
    expect(result.query).toBe('search-term');
    expect(result.processingTimeMs).toBe(4);
  });

  it('checkHealth 当 Meilisearch 正常时返回 up 与版本号', async () => {
    const health = await driver.checkHealth();
    expect(health).toEqual({
      status: 'up',
      driver: 'meilisearch',
      version: '1.12.0',
    });
  });

  it('checkHealth 当 isHealthy 失败或抛错时返回 down', async () => {
    const client = driver.getClient();
    vi.mocked(client.isHealthy).mockResolvedValueOnce(false);
    const health = await driver.checkHealth();
    expect(health.status).toBe('down');
  });
});
