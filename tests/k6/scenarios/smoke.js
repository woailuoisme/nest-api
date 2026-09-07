import { scenarioProfiles, smokeThresholds } from '../config.js';
import { ScenarioRunner } from '../workflow.js';

/**
 * 1. 冒烟测试 (Smoke Test)
 * 极轻量负载 (1 VU, 15s)，全链路执行 (含新用户注册)，快速验证所有端点与契约可用性。
 */

export const options = {
  scenarios: {
    smoke: scenarioProfiles.smoke,
  },
  thresholds: smokeThresholds,
};

const runner = ScenarioRunner.create({
  scenario: 'smoke',
  title: 'NestForge Smoke Test Report',
  thinkTime: 0.5,
  enableRegister: true, // 冒烟阶段完整验证写链路与密码哈希
});

export const setup = runner.setup;
export default runner.run;
export const handleSummary = runner.handleSummary;
