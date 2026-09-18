import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { extname, parse } from 'node:path';
import { deburr } from 'es-toolkit/string';
import type { UploadedFile } from '@/common/storage/interfaces/upload.interface';
import type { MediaSaveOptions } from '../interfaces/media.interface';

const DEFAULT_PREFIX = 'media';

/**
 * 将字符串转为 URL/路径友好的 ASCII slug（去除特殊字符、连续破折号）
 */
export function slugify(text: string): string {
  return deburr(text)
    .replace(/[^a-zA-Z0-9_-]/g, '-') // 替换非字母数字和下划线为连字符
    .replace(/-+/g, '-') // 合并连续连字符
    .replace(/^-|-$/g, '') // 去除首尾连字符
    .toLowerCase()
    .slice(0, 80); // 截断避免过长
}

/**
 * 获取当前 UTC 年月日字符串 (YYYYMMDD)
 */
export function getUtcDateString(date = new Date()): string {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

/**
 * 计算 Buffer 或文件的 SHA-256 哈希值
 */
export async function computeFileHash(file: UploadedFile, contentBuffer?: Buffer): Promise<string> {
  if (contentBuffer) {
    return createHash('sha256').update(contentBuffer).digest('hex');
  }
  if (file.type === 'memory') {
    return createHash('sha256').update(file.buffer).digest('hex');
  }

  // 流式模式：从临时文件增量计算哈希（for-await 与项目其余流处理保持一致，异常自然上抛）
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file.tmpPath)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

/**
 * 根据命名策略生成目标存储相对路径
 *
 * @param file 上传文件对象
 * @param options 媒体保存选项
 * @param contentBuffer 可选的处理后文件 Buffer (如转 WebP 后的内容)
 * @param overrideExt 可选覆盖的文件扩展名 (如 '.webp')
 */
export async function buildMediaPath(
  file: UploadedFile,
  options?: MediaSaveOptions,
  contentBuffer?: Buffer,
  overrideExt?: string,
): Promise<string> {
  const prefix = options?.prefix ?? DEFAULT_PREFIX;
  const naming = options?.naming ?? 'date-uuid';
  const originalExt = extname(file.filename).toLowerCase();
  const ext = overrideExt ? (overrideExt.startsWith('.') ? overrideExt : `.${overrideExt}`) : originalExt;

  if (typeof naming === 'function') {
    return naming(file, options, contentBuffer);
  }

  switch (naming) {
    case 'hash': {
      const hash = await computeFileHash(file, contentBuffer);
      // 分散在两级目录中，防止单目录下文件过多 (如 uploads/media/a1/b2/a1b2c3d4...webp)
      const dir1 = hash.slice(0, 2);
      const dir2 = hash.slice(2, 4);
      return `${prefix}/${dir1}/${dir2}/${hash}${ext}`;
    }

    case 'slug-random': {
      const nameWithoutExt = parse(file.filename).name;
      const safeSlug = slugify(nameWithoutExt) || 'file';
      const randomSuffix = randomUUID().replace(/-/g, '').slice(0, 8);
      const yyyymmdd = getUtcDateString();
      return `${prefix}/${yyyymmdd}/${safeSlug}-${randomSuffix}${ext}`;
    }

    default: {
      const yyyymmdd = getUtcDateString();
      const uuid = randomUUID();
      return `${prefix}/${yyyymmdd}/${uuid}${ext}`;
    }
  }
}

/**
 * 为主文件路径生成变体/缩略图路径
 * 例如: media/20260813/abc.webp + 'thumb' + '.webp' → media/20260813/abc_thumb.webp
 */
export function buildVariantPath(mainPath: string, variantName: string, format = 'webp'): string {
  const parsed = parse(mainPath);
  const ext = format.startsWith('.') ? format : `.${format}`;
  const dir = parsed.dir ? `${parsed.dir}/` : '';
  return `${dir}${parsed.name}_${variantName}${ext}`;
}
