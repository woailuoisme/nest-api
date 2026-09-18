export interface TopicMatchResult {
  matched: boolean;
  params: Record<string, string>;
}

/** MQTT 5.0 共享订阅前缀：$share/{group}/{topic} */
const SHARED_PREFIX_REGEX = /^\$share\/[^/]*\//;

/**
 * 剥离 MQTT 5.0 共享订阅前缀 ($share/{group}/...)，无前缀时原样返回
 */
export function stripSharedPrefix(pattern: string): string {
  return pattern.replace(SHARED_PREFIX_REGEX, '');
}

/**
 * 将带命名参数的主题模式转为标准 MQTT 协议通配符模式
 * 例如:
 *   devices/:tenantId/:deviceId/telemetry -> devices/+/+/telemetry
 *   若配置 sharedGroup="workers"，则转为: $share/workers/devices/+/+/telemetry
 */
export function toMqttTopic(pattern: string, sharedGroup?: string): string {
  const stripped = stripSharedPrefix(pattern);
  const segments = stripped.split('/');
  const transformed = segments.map((seg) => (seg.startsWith(':') ? '+' : seg)).join('/');

  if (sharedGroup?.trim()) {
    return `$share/${sharedGroup.trim()}/${transformed}`;
  }

  return transformed;
}

/**
 * 校验并提取实际主题与模式的匹配结果与动态命名参数
 *
 * 支持：
 * - MQTT 单层通配符 '+'
 * - MQTT 多层通配符 '#' (必须处于末尾)
 * - 命名路由参数 ':paramName'
 */
export function matchTopic(pattern: string, actualTopic: string): TopicMatchResult {
  const cleanPattern = stripSharedPrefix(pattern);
  const patternSegments = cleanPattern.split('/');
  const actualSegments = actualTopic.split('/');

  const params: Record<string, string> = {};

  for (let i = 0; i < patternSegments.length; i++) {
    const pSeg = patternSegments[i];

    // 多层通配符 '#'
    if (pSeg === '#') {
      if (i === patternSegments.length - 1) {
        return { matched: true, params };
      }
      return { matched: false, params: {} };
    }

    const aSeg = actualSegments[i];
    if (aSeg === undefined) {
      return { matched: false, params: {} };
    }

    // 单层通配符 '+'
    if (pSeg === '+') {
      continue;
    }

    // 命名路径参数 ':param'
    if (pSeg.startsWith(':')) {
      const paramName = pSeg.slice(1);
      params[paramName] = aSeg;
      continue;
    }

    // 精确匹配
    if (pSeg !== aSeg) {
      return { matched: false, params: {} };
    }
  }

  // 若模式没有 '#'，则实际主题段数必须完全一致
  if (actualSegments.length !== patternSegments.length) {
    return { matched: false, params: {} };
  }

  return { matched: true, params };
}

/**
 * 快速判断实际主题是否匹配指定模式
 */
export function matchMqttTopic(pattern: string, actualTopic: string): boolean {
  return matchTopic(pattern, actualTopic).matched;
}

/**
 * 从实际主题中提取命名参数字典，不匹配时返回 null
 */
export function extractRouteParams(pattern: string, actualTopic: string): Record<string, string> | null {
  const result = matchTopic(pattern, actualTopic);
  return result.matched ? result.params : null;
}
