import { SwaggerModule } from '@nestjs/swagger';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ROUTES } from '@/common/constants/app.constants';
import { setupApiDocumentation } from '@/setup/swagger';

describe('setupApiDocumentation', () => {
  const getMock = vi.fn();
  const mockHttpAdapter = {
    getInstance: vi.fn().mockReturnValue({ get: getMock }),
  };

  const fakeApp = {
    getHttpAdapter: vi.fn().mockReturnValue(mockHttpAdapter),
  } as unknown as Parameters<typeof setupApiDocumentation>[0];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(SwaggerModule, 'createDocument').mockReturnValue({
      openapi: '3.1.0',
      info: { title: 'Test API', version: '1.0.0' },
      paths: {},
    } as unknown as ReturnType<typeof SwaggerModule.createDocument>);
  });

  it('应成功构建客户端、管理后台与认证专有三 OpenAPI 文档、注册对应 json 路由与 Scalar 路由，并返回文档 URLs', async () => {
    const appUrl = 'http://localhost:4300';
    const returnedUrls = await setupApiDocumentation(fakeApp, appUrl);

    // 1. 断言 SwaggerModule.createDocument 被调用三次（Client / Admin / Auth）
    expect(SwaggerModule.createDocument).toHaveBeenCalledTimes(3);

    // 2. 断言注册了客户端、管理后台与认证专用 JSON 数据源路由
    expect(getMock).toHaveBeenCalledWith(`/${ROUTES.DOCS_JSON}`, expect.any(Function));
    expect(getMock).toHaveBeenCalledWith(`/${ROUTES.ADMIN_DOCS_JSON}`, expect.any(Function));
    expect(getMock).toHaveBeenCalledWith(`/${ROUTES.AUTH_DOCS_JSON}`, expect.any(Function));

    // 3. 断言注册了客户端、管理后台与认证专用 Scalar HTML 页面路由
    expect(getMock).toHaveBeenCalledWith(`/${ROUTES.DOCS}`, expect.any(Function));
    expect(getMock).toHaveBeenCalledWith(`/${ROUTES.ADMIN_DOCS}`, expect.any(Function));
    expect(getMock).toHaveBeenCalledWith(`/${ROUTES.AUTH_DOCS}`, expect.any(Function));

    // 4. 断言返回了三个标准的文档 URL
    expect(returnedUrls).toEqual({
      clientDocsUrl: `${appUrl}/${ROUTES.DOCS}`,
      adminDocsUrl: `${appUrl}/${ROUTES.ADMIN_DOCS}`,
      authDocsUrl: `${appUrl}/${ROUTES.AUTH_DOCS}`,
    });
  });
});
