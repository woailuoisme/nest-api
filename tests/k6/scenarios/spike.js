import { scenarioRegistry } from '../config.js';
import { createScenarioRunner } from '../workflow.js';

/**
 * 4. 突发流量脉冲测试 (Spike Test)
 * 模拟秒杀与突发洪峰流量 (10 -> 180 VUs 瞬间脉冲, ~1.5m)，验证限流保护与系统快速自愈弹性。
 */
const { profile, thresholds, thinkTime, enableRegister } = scenarioRegistry.spike;
const runner = createScenarioRunner({
  scenario: 'spike',
  title: 'NestForge Spike Test Report',
  thinkTime,
  enableRegister,
});

export const options = {
  scenarios: {
    spike: profile,
  },
  thresholds,
};

export const setup = runner.setup;
export default runner.run;
export const handleSummary = runner.handleSummary;
