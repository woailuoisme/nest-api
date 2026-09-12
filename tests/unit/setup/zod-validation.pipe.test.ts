import { UnprocessableEntityException } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CustomZodValidationPipe } from '@/setup/middleware';

const TestSchema = z.object({
  name: z.string().trim().min(2),
  email: z.string().email(),
  age: z.coerce.number().int().min(18).optional(),
});

class TestDto extends createZodDto(TestSchema) {}

describe('CustomZodValidationPipe', () => {
  const pipe = new CustomZodValidationPipe();

  it('合法入参应成功通过并执行 trim 与类型转换', () => {
    const input = {
      name: '  Alice  ',
      email: 'alice@example.com',
      age: '25',
    };

    const result = pipe.transform(input, { type: 'body', metatype: TestDto });

    expect(result).toEqual({
      name: 'Alice',
      email: 'alice@example.com',
      age: 25,
    });
  });

  it('非法入参应抛出 UnprocessableEntityException (422) 并携带字段级错误 map', () => {
    const invalidInput = {
      name: 'A', // too short
      email: 'invalid-email',
      age: 16, // < 18
    };

    let caughtError: UnprocessableEntityException | undefined;
    try {
      pipe.transform(invalidInput, { type: 'body', metatype: TestDto });
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

  it('非 ZodDto 类型的入参应直接透传，不触发校验', () => {
    const rawData = { foo: 'bar' };
    const result = pipe.transform(rawData, { type: 'body', metatype: Object });

    expect(result).toBe(rawData);
  });
});
