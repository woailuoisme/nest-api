import { Injectable, VERSION_NEUTRAL } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA, VERSION_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common/enums/request-method.enum';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { sortBy, uniq, uniqBy } from 'es-toolkit';
import { Command, CommandRunner, Option } from 'nest-commander';
import { EXCLUDED_ROUTES } from '@/common/constants/app.constants';

export interface RouteInfo {
  method: string;
  path: string;
  action: string;
  guards: string[];
}

export interface RouteListCommandOptions {
  method?: string;
  path?: string;
  json?: boolean;
}

const HTTP_METHOD_MAP: Record<number, string> = {
  [RequestMethod.GET]: 'GET',
  [RequestMethod.POST]: 'POST',
  [RequestMethod.PUT]: 'PUT',
  [RequestMethod.DELETE]: 'DELETE',
  [RequestMethod.PATCH]: 'PATCH',
  [RequestMethod.ALL]: 'ALL',
  [RequestMethod.OPTIONS]: 'OPTIONS',
  [RequestMethod.HEAD]: 'HEAD',
  [RequestMethod.SEARCH]: 'SEARCH',
};

const METHOD_COLORS: Record<string, string> = {
  GET: '\x1b[32m', // Green
  POST: '\x1b[33m', // Yellow
  PUT: '\x1b[34m', // Blue
  PATCH: '\x1b[36m', // Cyan
  DELETE: '\x1b[31m', // Red
  HEAD: '\x1b[90m', // Gray
  OPTIONS: '\x1b[90m', // Gray
  ALL: '\x1b[35m', // Magenta
};
const RESET_COLOR = '\x1b[0m';
const BOLD = '\x1b[1m';
const GRAY = '\x1b[90m';

@Command({
  name: 'route:list',
  description: 'List all registered HTTP routes',
})
@Injectable()
export class RouteListCommand extends CommandRunner {
  constructor(
    private readonly discoveryService: DiscoveryService,
    private readonly metadataScanner: MetadataScanner,
    private readonly reflector: Reflector,
  ) {
    super();
  }

  async run(_passedParams: string[], options?: RouteListCommandOptions): Promise<void> {
    const routes = this.getRoutes();

    let filteredRoutes = routes;

    if (options?.method) {
      const filterMethod = options.method.toUpperCase();
      filteredRoutes = filteredRoutes.filter((r) => r.method.toUpperCase().includes(filterMethod));
    }

    if (options?.path) {
      const filterPath = options.path.toLowerCase();
      filteredRoutes = filteredRoutes.filter((r) => r.path.toLowerCase().includes(filterPath));
    }

    if (options?.json) {
      console.log(JSON.stringify(filteredRoutes, null, 2));
      return;
    }

    this.#renderTable(filteredRoutes);
  }

  @Option({
    flags: '-m, --method <method>',
    description: 'Filter routes by HTTP method (e.g. GET, POST)',
  })
  parseMethod(val: string): string {
    return val;
  }

  @Option({
    flags: '-p, --path <path>',
    description: 'Filter routes by path (substring match)',
  })
  parsePath(val: string): string {
    return val;
  }

  @Option({
    flags: '--json',
    description: 'Output routes in JSON format',
  })
  parseJson(): boolean {
    return true;
  }

  getRoutes(): RouteInfo[] {
    const controllers = this.discoveryService.getControllers();
    const routes: RouteInfo[] = [];

    for (const controller of controllers) {
      if (!controller.instance || !controller.metatype) {
        continue;
      }

      const controllerPathMetadata = this.reflector.get<string | string[] | undefined>(
        PATH_METADATA,
        controller.metatype,
      );
      const controllerPaths = this.#normalizePaths(controllerPathMetadata);

      const prototype = Object.getPrototypeOf(controller.instance);
      const methodNames = this.metadataScanner.getAllMethodNames(prototype);

      for (const methodName of methodNames) {
        const targetCallback = controller.instance[methodName];
        if (typeof targetCallback !== 'function') {
          continue;
        }

        const requestMethodNum = this.reflector.get<number | undefined>(METHOD_METADATA, targetCallback);
        if (requestMethodNum === undefined) {
          continue;
        }

        const methodStr = HTTP_METHOD_MAP[requestMethodNum] ?? 'UNKNOWN';
        const methodPathMetadata = this.reflector.get<string | string[] | undefined>(PATH_METADATA, targetCallback);
        const methodPaths = this.#normalizePaths(methodPathMetadata);

        type GuardType = { name?: string; constructor?: { name?: string } };
        const controllerGuards =
          this.reflector.get<GuardType[] | undefined>(GUARDS_METADATA, controller.metatype) ?? [];
        const methodGuards = this.reflector.get<GuardType[] | undefined>(GUARDS_METADATA, targetCallback) ?? [];

        const allGuards = [...controllerGuards, ...methodGuards].map((guard) =>
          typeof guard === 'function' ? guard.name : (guard.constructor?.name ?? 'AnonymousGuard'),
        );
        const uniqueGuards = uniq(allGuards);

        const controllerName = controller.metatype.name;
        const actionStr = `${controllerName}#${methodName}`;

        // NestJS 版本元数据：方法级优先，降级取 Controller 级，再降级默认 '1'
        const methodVersion = this.reflector.get<string | string[] | symbol | undefined>(
          VERSION_METADATA,
          targetCallback,
        );
        const controllerVersion = this.reflector.get<string | string[] | symbol | undefined>(
          VERSION_METADATA,
          controller.metatype,
        );
        const resolvedVersion = methodVersion ?? controllerVersion;

        for (const cPath of controllerPaths) {
          for (const mPath of methodPaths) {
            const fullPath = this.#combinePaths(cPath, mPath, resolvedVersion);
            routes.push({
              method: methodStr,
              path: fullPath,
              action: actionStr,
              guards: uniqueGuards,
            });
          }
        }
      }
    }

    const uniqueRoutes = uniqBy(routes, (r) => `${r.method}:${r.path}`);
    return sortBy(uniqueRoutes, [(r) => r.path, (r) => r.method]);
  }

  #normalizePaths(pathMetadata: string | string[] | undefined): string[] {
    if (!pathMetadata) return [''];
    if (Array.isArray(pathMetadata)) {
      return pathMetadata.length > 0 ? pathMetadata : [''];
    }
    return [pathMetadata];
  }

  #combinePaths(controllerPath: string, methodPath: string, version?: string | string[] | symbol): string {
    let combined = `/${controllerPath}/${methodPath}`.replace(/\/+/g, '/');
    if (combined.length > 1 && combined.endsWith('/')) {
      combined = combined.slice(0, -1);
    }
    const isExcluded = (EXCLUDED_ROUTES as readonly string[]).some((excluded) => {
      const prefix = excluded === '/' ? '/' : `/${excluded}`;
      return combined === prefix || combined.startsWith(`${prefix}/`);
    });
    // VERSION_NEUTRAL 路由不添加版本前缀（如 /broadcasting/auth）
    const isVersionNeutral = version === VERSION_NEUTRAL;
    if (!isExcluded && !isVersionNeutral) {
      combined = `/v1${combined}`;
    }
    return combined;
  }

  #renderTable(routes: RouteInfo[]): void {
    if (routes.length === 0) {
      console.log(`\n${GRAY}No routes found.${RESET_COLOR}\n`);
      return;
    }

    const headers = ['Method', 'URI', 'Action', 'Middleware / Guards'];

    const formattedRows = routes.map((r) => {
      const color = METHOD_COLORS[r.method] ?? RESET_COLOR;
      const coloredMethod = `${color}${BOLD}${r.method}${RESET_COLOR}`;
      const guardsStr = r.guards.length > 0 ? r.guards.join(', ') : `${GRAY}-${RESET_COLOR}`;
      return {
        methodRaw: r.method,
        methodDisplay: coloredMethod,
        path: r.path,
        action: r.action,
        guardsDisplay: guardsStr,
        guardsRaw: r.guards.length > 0 ? r.guards.join(', ') : '-',
      };
    });

    const colWidths = [
      Math.max(headers[0].length, ...formattedRows.map((r) => r.methodRaw.length)),
      Math.max(headers[1].length, ...formattedRows.map((r) => r.path.length)),
      Math.max(headers[2].length, ...formattedRows.map((r) => r.action.length)),
      Math.max(headers[3].length, ...formattedRows.map((r) => r.guardsRaw.length)),
    ];

    const pad = (str: string, length: number, rawLength?: number) => {
      const actualLen = rawLength ?? str.length;
      return str + ' '.repeat(Math.max(0, length - actualLen));
    };

    const topBorder = `┌${'─'.repeat(colWidths[0] + 2)}┬${'─'.repeat(colWidths[1] + 2)}┬${'─'.repeat(colWidths[2] + 2)}┬${'─'.repeat(colWidths[3] + 2)}┐`;
    const midBorder = `├${'─'.repeat(colWidths[0] + 2)}┼${'─'.repeat(colWidths[1] + 2)}┼${'─'.repeat(colWidths[2] + 2)}┼${'─'.repeat(colWidths[3] + 2)}┤`;
    const bottomBorder = `└${'─'.repeat(colWidths[0] + 2)}┴${'─'.repeat(colWidths[1] + 2)}┴${'─'.repeat(colWidths[2] + 2)}┴${'─'.repeat(colWidths[3] + 2)}┘`;

    const headerLine = `│ ${BOLD}${pad(headers[0], colWidths[0])}${RESET_COLOR} │ ${BOLD}${pad(headers[1], colWidths[1])}${RESET_COLOR} │ ${BOLD}${pad(headers[2], colWidths[2])}${RESET_COLOR} │ ${BOLD}${pad(headers[3], colWidths[3])}${RESET_COLOR} │`;

    console.log(`\n${topBorder}`);
    console.log(headerLine);
    console.log(midBorder);

    for (const row of formattedRows) {
      const line = `│ ${pad(row.methodDisplay, colWidths[0], row.methodRaw.length)} │ ${pad(row.path, colWidths[1])} │ ${pad(row.action, colWidths[2])} │ ${pad(row.guardsDisplay, colWidths[3], row.guardsRaw.length)} │`;
      console.log(line);
    }

    console.log(bottomBorder);
    console.log(`${GRAY}Total routes: ${routes.length}${RESET_COLOR}\n`);
  }
}
