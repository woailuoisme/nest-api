import { Controller, Get, Post, UseGuards, VERSION_NEUTRAL } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RouteListCommand } from '@/commands/route-list.command';

class DummyGuard {
  canActivate() {
    return true;
  }
}

@Controller('test')
class TestController {
  @Get('hello')
  getHello() {
    return 'hello';
  }

  @Post('create')
  @UseGuards(DummyGuard)
  createItem() {
    return 'created';
  }
}

describe('RouteListCommand', () => {
  let command: RouteListCommand;

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [DiscoveryModule],
      controllers: [TestController],
      providers: [RouteListCommand],
    }).compile();

    command = moduleRef.get<RouteListCommand>(RouteListCommand);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should discover routes from registered controllers', () => {
    const routes = command.getRoutes();
    expect(routes).toHaveLength(2);

    const getRoute = routes.find((r) => r.method === 'GET');
    expect(getRoute).toBeDefined();
    expect(getRoute?.path).toBe('/v1/test/hello');
    expect(getRoute?.action).toBe('TestController#getHello');
    expect(getRoute?.guards).toEqual([]);

    const postRoute = routes.find((r) => r.method === 'POST');
    expect(postRoute).toBeDefined();
    expect(postRoute?.path).toBe('/v1/test/create');
    expect(postRoute?.action).toBe('TestController#createItem');
    expect(postRoute?.guards).toEqual(['DummyGuard']);
  });

  it('should filter by method option', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await command.run([], { method: 'POST' });

    const allLogs = logSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(allLogs).toContain('/v1/test/create');
    expect(allLogs).not.toContain('/v1/test/hello');
    expect(allLogs).toContain('Total routes: 1');
  });

  it('should filter by path option', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await command.run([], { path: 'hello' });

    const allLogs = logSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(allLogs).toContain('/v1/test/hello');
    expect(allLogs).not.toContain('/v1/test/create');
    expect(allLogs).toContain('Total routes: 1');
  });

  it('should output JSON when --json option is provided', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await command.run([], { json: true });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const jsonOutput = JSON.parse(logSpy.mock.calls[0][0]);
    expect(Array.isArray(jsonOutput)).toBe(true);
    expect(jsonOutput).toHaveLength(2);
    expect(jsonOutput[0]).toHaveProperty('method');
    expect(jsonOutput[0]).toHaveProperty('path');
    expect(jsonOutput[0]).toHaveProperty('action');
    expect(jsonOutput[0]).toHaveProperty('guards');
  });

  it('should parse command option flags correctly', () => {
    expect(command.parseMethod('get')).toBe('get');
    expect(command.parsePath('users')).toBe('users');
    expect(command.parseJson()).toBe(true);
  });

  it('should skip /v1 prefix for VERSION_NEUTRAL controllers', async () => {
    @Controller({ path: 'broadcasting', version: VERSION_NEUTRAL })
    class NeutralController {
      @Post('auth')
      auth() {
        return 'auth';
      }
    }

    const moduleRef = await Test.createTestingModule({
      imports: [DiscoveryModule],
      controllers: [NeutralController],
      providers: [RouteListCommand],
    }).compile();

    const cmd = moduleRef.get<RouteListCommand>(RouteListCommand);
    const routes = cmd.getRoutes();
    expect(routes).toHaveLength(1);
    expect(routes[0].path).toBe('/broadcasting/auth');
  });
});
