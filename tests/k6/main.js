import { scenarioRegistry } from './config.js';
import { createScenarioRunner } from './workflow.js';

/**
 * ==============================================================================
 * k6 综合测试统一调度入口 (Master Entry Point)
 * ==============================================================================
 * 支持通过 SCENARIO 环境变量快速切换目标压测场景：
 * 示例：k6 run -e SCENARIO=stress -e BASE_URL=http://localhost:4300 tests/k6/main.js
 *
 * 可选 SCENARIO:
 * - smoke   (冒烟验证)
 * - load    (常规负载，默认)
 * - stress  (极限压力)
 * - spike   (突发脉冲)
 * - soak    (耐力浸泡)
 */

const targetScenario = (__ENV.SCENARIO || 'load').toLowerCase();
// 未注册场景回退 load 的负载模型与阈值（场景键仍沿用用户输入，保证报告命名一致）
const active = scenarioRegistry[targetScenario] || scenarioRegistry.load;

export const options = {
  scenarios: {
    [targetScenario]: active.profile,
  },
  thresholds: active.thresholds,
};

const runner = createScenarioRunner({
  scenario: targetScenario,
  title: `NestForge [${targetScenario.toUpperCase()}] Performance Test Report`,
  thinkTime: active.thinkTime,
  enableRegister: active.enableRegister,
});

export const setup = runner.setup;
export default runner.run;
export const handleSummary = runner.handleSummary;
