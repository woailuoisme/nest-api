import { CallHandler, ExecutionContext, Injectable, NestInterceptor, Type } from '@nestjs/common';
import { Observable } from 'rxjs';

import { ResilienceObservableCommand } from './commands/index.js';
import { Strategy } from './strategies/index.js';

export function ResilienceInterceptor<T = unknown>(...strategies: Strategy[]): Type<NestInterceptor<T, T>> {
  class InterceptorCommand extends ResilienceObservableCommand {
    public constructor(run: (...args: unknown[]) => Observable<unknown>, group: string, name: string) {
      super(strategies, group, name);

      this.run = run;
    }

    public run: (...args: unknown[]) => Observable<unknown>;
  }

  @Injectable()
  class Interceptor implements NestInterceptor<T, T> {
    public intercept(context: ExecutionContext, next: CallHandler<T>): Observable<T> {
      const [group, name] = [context.getClass(), context.getHandler()].map((it) => it.name);
      const command = new InterceptorCommand(next.handle.bind(next), group, name);

      return command.execute() as Observable<T>;
    }
  }

  return Interceptor;
}
