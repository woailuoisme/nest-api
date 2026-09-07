import { describe, expect, it } from 'vitest';
import { matchesFilters, matchesSearch, parseLogLine } from '@/setup/log-viewer/engine/parser';

describe('LogViewer Parser (engine/parser.ts)', () => {
  it('应正确解析标准的 Pino JSON 日志行', () => {
    const rawLine = JSON.stringify({
      level: 50,
      time: 1772280000000,
      pid: 1234,
      hostname: 'test-host',
      context: 'AuthService',
      msg: 'Invalid credentials provided',
      reqId: 'req-abc-123',
      err: {
        type: 'UnauthorizedException',
        message: 'Invalid credentials',
        stack: 'Error: Invalid credentials\n    at AuthService.login (/app/src/auth.ts:10:15)',
      },
    });

    const parsed = parseLogLine(rawLine, 'app.log', 1);

    expect(parsed.id).toBe('app.log-1');
    expect(parsed.levelNumber).toBe(50);
    expect(parsed.level).toBe('error');
    expect(parsed.msg).toBe('Invalid credentials provided');
    expect(parsed.context).toBe('AuthService');
    expect(parsed.reqId).toBe('req-abc-123');
    expect(parsed.err?.type).toBe('UnauthorizedException');
    expect(parsed.stack).toContain('AuthService.login');
  });

  it('非 JSON 日志行应安全降级为 info 级别的纯文本条目', () => {
    const nonJsonLine = '[2026-08-28] Plain text fallback log output';
    const parsed = parseLogLine(nonJsonLine, 'app.log', 2);

    expect(parsed.id).toBe('app.log-2');
    expect(parsed.levelNumber).toBe(30);
    expect(parsed.level).toBe('info');
    expect(parsed.msg).toBe(nonJsonLine);
    expect(parsed.raw.msg).toBe(nonJsonLine);
  });

  describe('matchesSearch', () => {
    it('应在 msg、context、reqId、url、stack 任意命中时返回 true', () => {
      const raw = {
        msg: 'User login success',
        context: 'AuthController',
        reqId: 'req-123',
        req: { url: '/api/v1/auth/login' },
        err: { stack: 'at LoginHandler' },
      };

      expect(matchesSearch(raw, 'login')).toBe(true);
      expect(matchesSearch(raw, 'authcontroller')).toBe(true);
      expect(matchesSearch(raw, 'req-123')).toBe(true);
      expect(matchesSearch(raw, 'loginhandler')).toBe(true);
      expect(matchesSearch(raw, 'non-existent')).toBe(false);
    });
  });

  describe('matchesFilters', () => {
    const entry = parseLogLine(
      JSON.stringify({
        level: 40,
        msg: 'Slow query detected',
        context: 'DrizzleService',
      }),
      'app.log',
      1,
    );

    it('当级别在 filterLevels 中且满足搜索词时返回 true', () => {
      expect(matchesFilters(entry, ['warn', 'error'], 'slow')).toBe(true);
    });

    it('当级别不在 filterLevels 时返回 false', () => {
      expect(matchesFilters(entry, ['error'], null)).toBe(false);
    });

    it('当搜索词不匹配时返回 false', () => {
      expect(matchesFilters(entry, ['warn'], 'timeout')).toBe(false);
    });
  });
});
