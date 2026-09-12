/**
 * 累加 multipart 表单文本字段至 body 对象：
 * - 首次出现：存储为单值
 * - 第二次出现：转换为数组 [first, second]
 * - 后续出现：追加至已有数组
 */
export function accumulateField(body: Record<string, unknown>, fieldname: string, value: unknown): void {
  if (fieldname === '__proto__' || fieldname === 'constructor' || fieldname === 'prototype') {
    return;
  }

  const existing = body[fieldname];

  if (existing === undefined) {
    body[fieldname] = value;
  } else if (Array.isArray(existing)) {
    existing.push(value);
  } else {
    body[fieldname] = [existing, value];
  }
}
