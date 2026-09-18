import { check, sleep } from 'k6';
import {
  flowSuccessRate,
  generateMockUser,
  HttpClient,
  healthDuration,
  registerDuration,
  setupAuth,
  userListDuration,
  userMeDuration,
} from './client.js';
import { buildUrl } from './config.js';
import { handleSummaryGenerator } from './reporter.js';

/**
 * ==============================================================================
 * 核心确定性业务流水线 (Deterministic Core Workflow)
 * ==============================================================================
 * 每个虚拟用户 (VU) 顺序模拟真实用户行为：
 * 1. 探针连通：检查服务就绪状态 (GET /health)
 * 2. 身份验证：通过 Bearer Token 访问个人中心 (GET /users/me)
 * 3. 核心查询：分页获取用户列表数据 (GET /users?page=1&pageSize=10)
 * 4. 可选写链路：新用户注册与 Argon2 慢哈希 (默认关闭，避免掩盖 I/O 真实瓶颈)
 * 5. 模拟思考：sleep(thinkTime)
 */
export function runWorkflow(setupData, options = {}) {
  const client = new HttpClient({ token: setupData?.token });
  let workflowOk = true;

  // 1. 无状态健康检查探针
  const healthRes = client.get(buildUrl('/health', false), {
    name: 'GET /health',
    metric: healthDuration,
  });
  const healthOk = check(healthRes, {
    'health status is 200': (r) => r.status === 200,
    'health body is ok': (r) => {
      const body = HttpClient.parseJson(r);
      return body && (body.status === 'ok' || body.success === true);
    },
  });
  if (!healthOk) workflowOk = false;

  // 2. 鉴权令牌检查与受保护接口调用
  if (!client.token) {
    check(null, { 'auth token is present': () => false });
    workflowOk = false;
  } else {
    // 获取个人信息 (兼容 BIGINT string / number 格式)
    const meRes = client.get(buildUrl('/users/me'), {
      name: 'GET /v1/users/me',
      metric: userMeDuration,
    });
    const meOk = check(meRes, {
      'users/me status is 200': (r) => r.status === 200,
      'users/me has user id': (r) => {
        const body = HttpClient.parseJson(r);
        const id = body?.data?.id;
        return typeof id === 'number' || (typeof id === 'string' && id.length > 0);
      },
    });
    if (!meOk) workflowOk = false;

    // 3. 核心业务：用户列表分页查询
    const listRes = client.get(buildUrl('/users?page=1&pageSize=10'), {
      name: 'GET /v1/users',
      metric: userListDuration,
    });
    const listOk = check(listRes, {
      'users list status is 200': (r) => r.status === 200,
      'users list returns array': (r) => {
        const body = HttpClient.parseJson(r);
        return Array.isArray(body?.data?.items);
      },
    });
    if (!listOk) workflowOk = false;
  }

  // 4. 可选写链路：新用户注册 (默认仅在冒烟测试或显式开启时执行)
  if (options.enableRegister === true) {
    const newUser = generateMockUser();
    const regRes = client.post(buildUrl('/auth/register'), newUser, {
      name: 'POST /v1/auth/register',
      metric: registerDuration,
    });
    const regOk = check(regRes, {
      'register status is 201': (r) => r.status === 201,
      'register returns token': (r) => {
        const body = HttpClient.parseJson(r);
        return !!body?.data?.accessToken;
      },
    });
    if (!regOk) workflowOk = false;
  }

  // 记录全流程成功率
  flowSuccessRate.add(workflowOk);

  // 5. 模拟用户思考时间 (Think Time)
  const thinkTime = options.thinkTime ?? 0.2;
  if (thinkTime > 0) {
    sleep(thinkTime);
  }
}

/**
 * 场景执行器工厂 (Scenario Runner Factory - Ubiquitous Language)
 * 把「报告标题 / 场景名 / 思考时间 / 写链路开关」收敛为 k6 入口所需的 setup + run + handleSummary 三件套，
 * 入口脚本只需声明自身差异即可直接导出，无需重复装配。
 */
export function createScenarioRunner(config = {}) {
  const {
    title = 'NestForge Performance Test Report',
    scenario = 'summary',
    thinkTime = 0.2,
    enableRegister = false,
  } = config;
  return {
    setup: () => setupAuth(),
    run: (setupData) => runWorkflow(setupData, { thinkTime, enableRegister }),
    handleSummary: (data) => handleSummaryGenerator(data, { title, scenario }),
  };
}
