import { StandardSchemaValidationPipe, UnprocessableEntityException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createApiValidationPipe } from '@/setup/middleware';

const TestSchema = z.object({
  name: z.string().trim().min(2),
  email: z.string().email(),
  age: z.coerce.number().int().min(18).optional(),
});

describe('createApiValidationPipe (Standard Schema 校验管道)', () => {
  const pipe = createApiValidationPipe();

  it('合法入参应成功通过并执行 trim 与类型转换', async () => {
    const input = {
      name: '  Alice  ',
      email: 'alice@example.com',
      age: '25',
    };

    const result = await pipe.transform(input, { type: 'body', schema: TestSchema });

    expect(result).toEqual({
      name: 'Alice',
      email: 'alice@example.com',
      age: 25,
    });
  });

  it('非法入参应抛出 UnprocessableEntityException (422) 并携带字段级错误 map', async () => {
    const invalidInput = {
      name: 'A', // too short
      email: 'invalid-email',
      age: 16, // < 18
    };

    let caughtError: UnprocessableEntityException | undefined;
    try {
      await pipe.transform(invalidInput, { type: 'body', schema: TestSchema });
    } catch (e) {
      caughtError = e as UnprocessableEntityException;
    }

    expect(caughtError).toBeInstanceOf(UnprocessableEntityException);
    expect(caughtError?.getStatus()).toBe(422);

    const response = caughtError?.getResponse() as {
      code?: string;
      message: string;
      fields?: Record<string, string[]>;
      errors: Record<string, string[]>;
    };
    expect(response.code).toBe('VALIDATION_FAILED');
    expect(response.message).toBe('Validation failed');
    expect(response.fields).toBeDefined();
    expect(response.fields?.name).toBeDefined();
    expect(response.fields?.email).toBeDefined();
    expect(response.fields?.age).toBeDefined();
    expect(response.errors).toBeDefined();
    expect(response.errors.name).toBeDefined();
    expect(response.errors.email).toBeDefined();
    expect(response.errors.age).toBeDefined();
  });

  it('嵌套字段错误应聚合为点分路径键', async () => {
    const NestedSchema = z.object({ profile: z.object({ nickname: z.string().min(2) }) });

    let caughtError: UnprocessableEntityException | undefined;
    try {
      await pipe.transform({ profile: { nickname: 'x' } }, { type: 'body', schema: NestedSchema });
    } catch (e) {
      caughtError = e as UnprocessableEntityException;
    }

    const response = caughtError?.getResponse() as { fields?: Record<string, string[]> };
    expect(Object.keys(response.fields ?? {})).toEqual(['profile.nickname']);
  });

  it('未声明 schema 的入参应直接透传，不触发校验', async () => {
    const rawData = { foo: 'bar' };
    const result = await pipe.transform(rawData, { type: 'body', metatype: Object });

    expect(result).toBe(rawData);
  });

  it('z.object 下未知字段被静默剥离（存量写接口契约）', async () => {
    const result = await pipe.transform(
      { name: 'Alice', email: 'alice@example.com', isAdmin: true, extraField: 'dropped' },
      { type: 'body', schema: TestSchema },
    );

    expect(result).toEqual({ name: 'Alice', email: 'alice@example.com' });
    expect(Object.keys(result)).not.toContain('isAdmin');
  });

  it('z.strictObject 下未知字段触发 422（可用于新增写接口防字段走私）', async () => {
    const StrictSchema = z.strictObject({ name: z.string().min(2) });

    let caughtError: UnprocessableEntityException | undefined;
    try {
      await pipe.transform({ name: 'Alice', isAdmin: true }, { type: 'body', schema: StrictSchema });
    } catch (e) {
      caughtError = e as UnprocessableEntityException;
    }

    const response = caughtError?.getResponse() as { fields?: Record<string, string[]> };
    expect(caughtError?.getStatus()).toBe(422);
    expect(JSON.stringify(response.fields)).toContain('Unrecognized key');
  });

  it('单值参数（@Body("email", { schema })）只校验被提取的值', async () => {
    await expect(pipe.transform('alice@example.com', { type: 'body', data: 'email', schema: z.email() })).resolves.toBe(
      'alice@example.com',
    );

    await expect(
      pipe.transform('not-an-email', { type: 'body', data: 'email', schema: z.email() }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('数组 schema 的元素错误带下标前缀', async () => {
    let caughtError: UnprocessableEntityException | undefined;
    try {
      await pipe.transform(
        [
          { name: 'Alice', email: 'alice@example.com' },
          { name: 'B', email: 'bad' },
        ],
        {
          type: 'body',
          schema: z.array(TestSchema),
        },
      );
    } catch (e) {
      caughtError = e as UnprocessableEntityException;
    }

    const response = caughtError?.getResponse() as { fields?: Record<string, string[]> };
    expect(Object.keys(response.fields ?? {})).toEqual(expect.arrayContaining(['1.name', '1.email']));
  });

  it('validateCustomDecorators 开启后自定义装饰器参数的 schema 才生效', async () => {
    const customMeta = { type: 'custom' as const, schema: z.email() };

    // 默认（false）：跳过校验，非法值原样通过 —— 这正是开启开关要防的隐蔽失效
    await expect(new StandardSchemaValidationPipe().transform('bad', customMeta)).resolves.toBe('bad');
    // 本仓库管道（true）：非法值被拒绝
    await expect(pipe.transform('bad', customMeta)).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});
