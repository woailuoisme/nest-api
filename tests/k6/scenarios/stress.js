import { scenarioRegistry } from '../config.js';
import { createScenarioRunner } from '../workflow.js';

/**
 * 3. 极限压力测试 (Stress Test)
 * 阶梯式加大并发 (30 -> 80 -> 150 VUs, ~3.5m)，探测数据库连接池、Redis 与 Fastify 真实承载拐点。
 */
const { profile, thresholds, thinkTime, enableRegister } = scenarioRegistry.stress;
const runner = createScenarioRunner({
  scenario: 'stress',
  title: 'NestForge Stress Test Report',
  thinkTime,
  enableRegister,
});

export const options = {
  scenarios: {
    stress: profile,
  },
  thresholds,
};

export const setup = runner.setup;
export default runner.run;
export const handleSummary = runner.handleSummary;
