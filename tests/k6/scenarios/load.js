import { baseThresholds, scenarioProfiles } from '../config.js';
import { ScenarioRunner } from '../workflow.js';

/**
 * 2. 常规负载测试 (Average Load Test)
 * 模拟生产环境预期常态流量与日均峰值负载 (20 VUs, ~2m)，评估 P95/P99 响应时延与吞吐量。
 */

export const options = {
  scenarios: {
    load: scenarioProfiles.load,
  },
  thresholds: baseThresholds,
};

const runner = ScenarioRunner.create({
  scenario: 'load',
  title: 'NestForge Average Load Test Report',
  thinkTime: 0.2,
});

export const setup = runner.setup;
export default runner.run;
export const handleSummary = runner.handleSummary;
