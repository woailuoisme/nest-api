import { describe, expect, it } from 'vitest';

import { createFastifyAdapter } from '@/setup/adapter';

/** 在适配器实例上挂探针路由，验证 querystringParser 的最终产出 */
async function probeQuery(url: string) {
  const adapter = createFastifyAdapter();
  const instance = adapter.getInstance();
  instance.get('/probe', async (request) => request.query);
  await instance.ready();

  try {
    const response = await instance.inject({ method: 'GET', url });
    return { statusCode: response.statusCode, body: response.json() };
  } finally {
    await instance.close();
  }
}

describe('FastifyAdapter — 查询串解析', () => {
  it('应展开 filter / fields 并保留其余扁平参数', async () => {
    const { statusCode, body } = await probeQuery(
      '/probe?page=2&pageSize=20&filter[role]=ADMIN&filter[salary]=%3E%3D3000&sort=-createdAt&include=posts&fields[users]=id,name',
    );

    expect(statusCode).toBe(200);
    expect(body).toEqual({
      page: '2',
      pageSize: '20',
      filter: { role: 'ADMIN', salary: '>=3000' },
      sort: '-createdAt',
      include: 'posts',
      fields: { users: 'id,name' },
    });
  });

  it('同名标量键与括号键共存时不得抛错', async () => {
    const { statusCode, body } = await probeQuery('/probe?filter=x&filter[role]=ADMIN');
    expect(statusCode).toBe(200);
    expect(body).toEqual({ filter: 'x' });
  });

  it('深层嵌套键应保持字面量（仅展开一层）', async () => {
    const { statusCode, body } = await probeQuery('/probe?filter[age][gte]=18');
    expect(statusCode).toBe(200);
    expect(body).toEqual({ 'filter[age][gte]': '18' });
  });
});
