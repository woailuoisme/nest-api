import http from 'k6/http';
import { Rate, Trend } from 'k6/metrics';

import { buildUrl, ENV } from './config.js';

/**
 * ==============================================================================
 * 极简 HTTP 客户端、度量指标与鉴权辅助库 (Client & Metrics & Auth)
 * ==============================================================================
 */

/** 1. 核心性能度量指标 */
export const flowSuccessRate = new Rate('flow_success_rate');
export const healthDuration = new Trend('health_duration', true);
export const userMeDuration = new Trend('user_me_duration', true);
export const userListDuration = new Trend('user_list_duration', true);
export const registerDuration = new Trend('register_duration', true);

/** 2. 统一 HTTP 请求客户端 (支持自动指标打点与异常统计) */
export class HttpClient {
  /**
   * @param {Object} [options]
   * @param {string} [options.token] - 默认鉴权 Bearer Token
   */
  constructor(options = {}) {
    this.token = options.token || null;
  }

  _headers(custom = {}) {
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...custom,
    };
    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }
    return headers;
  }

  _buildParams(url, options = {}) {
    return {
      headers: this._headers(options.headers),
      timeout: options.timeout || ENV.TIMEOUT,
      tags: { name: options.name || url },
    };
  }

  _handle(res, metric) {
    if (res?.timings?.duration !== undefined && metric?.add) {
      metric.add(res.timings.duration);
    }
    return res;
  }

  get(url, options = {}) {
    const params = this._buildParams(url, options);
    const res = http.get(url, params);
    return this._handle(res, options.metric);
  }

  post(url, body = {}, options = {}) {
    const payload = typeof body === 'string' ? body : JSON.stringify(body);
    const params = this._buildParams(url, options);
    const res = http.post(url, payload, params);
    return this._handle(res, options.metric);
  }

  static parseJson(res) {
    try {
      return JSON.parse(res.body);
    } catch {
      return null;
    }
  }
}

/** 3. 极速 setup() 鉴权预热：单次登录获取 Token (耗时 < 50ms) */
export function setupAuth() {
  const client = new HttpClient();
  console.log(`\n🚀 [k6 setup] 预热鉴权服务: ${ENV.BASE_URL} (用户: ${ENV.ADMIN_EMAIL})`);

  const url = buildUrl('/auth/login');
  const res = client.post(url, { email: ENV.ADMIN_EMAIL, password: ENV.ADMIN_PASSWORD }, { name: 'SETUP /auth/login' });

  const body = HttpClient.parseJson(res);
  const token = body?.data?.accessToken || null;

  if (res.status === 200 && token) {
    console.log('✅ [k6 setup] 鉴权预热成功，已获取有效 Bearer Token\n');
  } else {
    console.warn('⚠️ [k6 setup] 登录未获取到 Token，请确认已启动服务并执行 `just db-seed`\n');
  }

  return { token, baseUrl: ENV.BASE_URL };
}

/** 4. 生成零冲突唯一用户数据 (用于可选注册链路) */
export function generateMockUser() {
  const vu = typeof __VU !== 'undefined' ? __VU : 1;
  const iter = typeof __ITER !== 'undefined' ? __ITER : 0;
  const rand = Math.random().toString(36).substring(2, 6);
  return {
    name: `TestUser_${vu}_${iter}`,
    email: `k6_v${vu}i${iter}_${Date.now()}_${rand}@nestforge.test`.toLowerCase(),
    password: 'SecretPassword123!',
    locale: 'zh',
  };
}
