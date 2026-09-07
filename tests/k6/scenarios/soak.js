import { scenarioProfiles, soakThresholds } from '../config.js';
import { ScenarioRunner } from '../workflow.js';

/**
 * 5. 浸泡/耐力测试 (Soak / Endurance Test)
 * 中等并发 (25 VUs) 长周期持续运行 (5m+)，排查内存泄漏、连接池未归还及长时间性能衰减。
 */

export const options = {
  scenarios: {
    soak: scenarioProfiles.soak,
  },
  thresholds: soakThresholds,
};

const runner = ScenarioRunner.create({
  scenario: 'soak',
  title: 'NestForge Soak / Endurance Test Report',
  thinkTime: 0.3,
});

export const setup = runner.setup;
export default runner.run;
export const handleSummary = runner.handleSummary;
