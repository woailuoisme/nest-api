import {
  baseThresholds,
  scenarioProfiles,
  smokeThresholds,
  soakThresholds,
  spikeThresholds,
  stressThresholds,
} from './config.js';
import { ScenarioRunner } from './workflow.js';

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

const scenarioConfigs = {
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
  },
  stress: {
    profile: scenarioProfiles.stress,
    thresholds: stressThresholds,
    thinkTime: 0.1,
  },
  spike: {
    profile: scenarioProfiles.spike,
    thresholds: spikeThresholds,
    thinkTime: 0.05,
  },
  soak: {
    profile: scenarioProfiles.soak,
    thresholds: soakThresholds,
    thinkTime: 0.3,
  },
};

const active = scenarioConfigs[targetScenario] || scenarioConfigs.load;

export const options = {
  scenarios: {
    [targetScenario]: active.profile,
  },
  thresholds: active.thresholds,
};

const runner = ScenarioRunner.create({
  scenario: targetScenario,
  title: `NestForge [${targetScenario.toUpperCase()}] Performance Test Report`,
  thinkTime: active.thinkTime,
  enableRegister: active.enableRegister || false,
});

export const setup = runner.setup;
export default runner.run;
export const handleSummary = runner.handleSummary;
