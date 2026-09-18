/**
 * ==============================================================================
 * k6 综合环境配置与 SLA 质量守门标准 (Configuration & Profiles)
 * ==============================================================================
 */

/** 1. 核心环境变量配置 */
export const ENV = {
  /** 目标服务基准地址 (可通过 -e BASE_URL=... 覆盖) */
  BASE_URL: __ENV.BASE_URL || 'http://localhost:4300',

  /** 全局 API 路由前缀 */
  API_PREFIX: __ENV.API_PREFIX || '/v1',

  /** 预热登录使用的管理员账号 (用于快速获取 Bearer Token) */
  ADMIN_EMAIL: __ENV.ADMIN_EMAIL || 'admin@nestforge.dev',
  ADMIN_PASSWORD: __ENV.ADMIN_PASSWORD || 'admin123',

  /** 单请求超时时间 */
  TIMEOUT: __ENV.TIMEOUT || '10s',

  /** 浸泡测试时长 */
  SOAK_DURATION: __ENV.SOAK_DURATION || '5m',
};

/**
 * 构造完整 URL
 * @param {string} path
 * @param {boolean} [withPrefix=true]
 * @returns {string}
 */
export function buildUrl(path, withPrefix = true) {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  if (!withPrefix) {
    return `${ENV.BASE_URL}${cleanPath}`;
  }
  return `${ENV.BASE_URL}${ENV.API_PREFIX}${cleanPath}`;
}

/** 2. 5 大标准压测负载模型 (Scenario Profiles) */
export const scenarioProfiles = {
  /** 冒烟测试：1 VU, 15s 快速验证 */
  smoke: {
    executor: 'constant-vus',
    vus: 1,
    duration: '15s',
    gracefulStop: '5s',
  },

  /** 常规负载：20 VUs, 平滑爬坡与稳态 (~1m50s) */
  load: {
    executor: 'ramping-vus',
    startVUs: 0,
    stages: [
      { duration: '30s', target: 20 },
      { duration: '1m', target: 20 },
      { duration: '20s', target: 0 },
    ],
    gracefulRampDown: '10s',
  },

  /** 极限压力：30 -> 80 -> 150 VUs 阶梯加压 (~3m30s) */
  stress: {
    executor: 'ramping-vus',
    startVUs: 0,
    stages: [
      { duration: '30s', target: 30 },
      { duration: '45s', target: 80 },
      { duration: '45s', target: 150 },
      { duration: '1m', target: 150 },
      { duration: '30s', target: 0 },
    ],
    gracefulRampDown: '15s',
  },

  /** 突发脉冲：10 -> 180 VUs 瞬间洪峰 (~1m20s) */
  spike: {
    executor: 'ramping-vus',
    startVUs: 0,
    stages: [
      { duration: '10s', target: 10 },
      { duration: '10s', target: 180 },
      { duration: '30s', target: 180 },
      { duration: '15s', target: 10 },
      { duration: '15s', target: 0 },
    ],
    gracefulRampDown: '10s',
  },

  /** 浸泡耐力：25 VUs 恒定中等负载长跑 (5m+) */
  soak: {
    executor: 'ramping-vus',
    startVUs: 0,
    stages: [
      { duration: '30s', target: 25 },
      { duration: ENV.SOAK_DURATION, target: 25 },
      { duration: '30s', target: 0 },
    ],
    gracefulRampDown: '15s',
  },
};

/** 3. SLA 质量守门标准 (Thresholds) */
export const baseThresholds = {
  http_req_failed: ['rate<0.01'],
  http_req_duration: ['p(95)<800', 'p(99)<1500'],
  checks: ['rate>0.99'],
  flow_success_rate: ['rate>0.99'],
  user_me_duration: ['p(95)<100'],
};

export const smokeThresholds = {
  http_req_failed: ['rate==0'],
  http_req_duration: ['p(95)<800', 'p(99)<1200'],
  checks: ['rate==1.0'],
  flow_success_rate: ['rate==1.0'],
};

export const stressThresholds = {
  http_req_failed: ['rate<0.05'],
  http_req_duration: ['p(95)<600', 'p(99)<1200'],
  checks: ['rate>0.95'],
  flow_success_rate: ['rate>0.95'],
};

export const spikeThresholds = {
  http_req_failed: ['rate<0.10'],
  http_req_duration: ['p(95)<800', 'p(99)<2000'],
  checks: ['rate>0.90'],
};

export const soakThresholds = {
  http_req_failed: ['rate<0.01'],
  http_req_duration: ['p(90)<200', 'p(95)<350'],
  checks: ['rate>0.99'],
  flow_success_rate: ['rate>0.99'],
};

/**
 * 4. 场景注册表 (Scenario Registry)
 * 总入口 (main.js -e SCENARIO=xxx) 与独立入口 (scenarios/*.js) 共用的唯一配置源，
 * 避免「负载模型 / SLA 阈值 / 思考时间 / 写链路开关」在两侧各写一份而逐步漂移。
 */
export const scenarioRegistry = {
  smoke: {
    profile: scenarioProfiles.smoke,
    thresholds: smokeThresholds,
    thinkTime: 0.5,
    enableRegister: true,
  },
  load: {
    profile: scenarioProfiles.load,
    thresholds: baseThresholds,
    thinkTime: 0.2,
    enableRegister: false,
  },
  stress: {
    profile: scenarioProfiles.stress,
    thresholds: stressThresholds,
    thinkTime: 0.1,
    enableRegister: false,
  },
  spike: {
    profile: scenarioProfiles.spike,
    thresholds: spikeThresholds,
    thinkTime: 0.05,
    enableRegister: false,
  },
  soak: {
    profile: scenarioProfiles.soak,
    thresholds: soakThresholds,
    thinkTime: 0.3,
    enableRegister: false,
  },
};
