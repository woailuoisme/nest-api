/**
 * Minimal .env read/write helpers shared by jwt:secret and app:init.
 *
 * Only "locate the single line by key" replace/append is supported; full dotenv
 * syntax (multi-line values, inline comments, etc.) is intentionally not parsed.
 */

/** Read the current value of a key (quotes and surrounding whitespace stripped); undefined when missing or empty */
export function readEnvValue(content: string, key: string): string | undefined {
  const match = content.match(new RegExp(`^${key}=(.*)$`, 'm'));
  const value = match?.[1]?.trim().replace(/^(['"])(.*)\1$/, '$2');
  return value || undefined;
}

/** Overwrite a key in place; append a new line when the key is absent */
export function upsertEnvValue(content: string, key: string, value: string): string {
  const regex = new RegExp(`^${key}=.*$`, 'm');
  const line = `${key}=${value}`;
  if (regex.test(content)) return content.replace(regex, line);

  const prefix = content && !content.endsWith('\n') ? '\n' : '';
  return `${content}${prefix}${line}\n`;
}
