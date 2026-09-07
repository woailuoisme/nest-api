import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { CreateUserSchema, UpdateUserSchema } from '@/api/admin/users/users.dto';
import { LoginSchema, RegisterSchema, ResetPasswordSchema } from '@/api/client/auth/auth.dto';

/** 校验 Zod Schema 并返回全部失败字段名 */
function validateSchema(schema: z.ZodTypeAny, data: unknown): string[] {
  const result = schema.safeParse(data);
  if (result.success) return [];
  return result.error.issues.map((issue) => issue.path.join('.'));
}

describe('W6 DTO 长度上限（argon2 慢哈希 DoS 防御）', () => {
  const longName = 'a'.repeat(101);
  const longPassword = 'x'.repeat(73);

  it('RegisterRequest：超长 password/name 被 MaxLength 拦截', () => {
    const errors = validateSchema(RegisterSchema, { name: longName, email: 'a@b.com', password: longPassword });

    expect(errors.length).toBe(2);
    expect(errors.sort()).toEqual(['name', 'password']);
  });

  it('RegisterRequest：72/100 边界值放行', () => {
    const errors = validateSchema(RegisterSchema, {
      name: 'a'.repeat(100),
      email: 'a@b.com',
      password: 'x'.repeat(72),
    });

    expect(errors).toHaveLength(0);
  });

  it('LoginRequest：超长 password 被拦截', () => {
    const errors = validateSchema(LoginSchema, { email: 'a@b.com', password: longPassword });

    expect(errors).toHaveLength(1);
    expect(errors[0]).toBe('password');
  });

  it('ResetPasswordRequest：超长 password 被拦截', () => {
    const errors = validateSchema(ResetPasswordSchema, { token: 'abc', password: longPassword });

    expect(errors).toHaveLength(1);
    expect(errors[0]).toBe('password');
  });

  it('CreateUserRequest：超长 name/password 被拦截', () => {
    const errors = validateSchema(CreateUserSchema, { name: longName, email: 'a@b.com', password: longPassword });

    expect(errors.length).toBe(2);
    expect(errors.sort()).toEqual(['name', 'password']);
  });

  it('UpdateUserRequest：超长 name 被拦截', () => {
    const errors = validateSchema(UpdateUserSchema, { name: longName });

    expect(errors).toHaveLength(1);
    expect(errors[0]).toBe('name');
  });
});
