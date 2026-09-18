import { scenarioRegistry } from '../config.js';
import { createScenarioRunner } from '../workflow.js';

/**
 * 5. 浸泡/耐力测试 (Soak / Endurance Test)
 * 中等并发 (25 VUs) 长周期持续运行 (5m+)，排查内存泄漏、连接池未归还及长时间性能衰减。
 */
const { profile, thresholds, thinkTime, enableRegister } = scenarioRegistry.soak;
const runner = createScenarioRunner({
  scenario: 'soak',
  title: 'NestForge Soak / Endurance Test Report',
  thinkTime,
  enableRegister,
});

export const options = {
  scenarios: {
    soak: profile,
  },
  thresholds,
};

export const setup = runner.setup;
export default runner.run;
export const handleSummary = runner.handleSummary;
