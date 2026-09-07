import { scenarioProfiles, stressThresholds } from '../config.js';
import { ScenarioRunner } from '../workflow.js';

/**
 * 3. 极限压力测试 (Stress Test)
 * 阶梯式加大并发 (30 -> 80 -> 150 VUs, ~3.5m)，探测数据库连接池、Redis 与 Fastify 真实承载拐点。
 */

export const options = {
  scenarios: {
    stress: scenarioProfiles.stress,
  },
  thresholds: stressThresholds,
};

const runner = ScenarioRunner.create({
  scenario: 'stress',
  title: 'NestForge Stress Test Report',
  thinkTime: 0.1,
});

export const setup = runner.setup;
export default runner.run;
export const handleSummary = runner.handleSummary;
