/**
 * createLogger — single factory that installs the redaction hook before
 * every log record is serialised.
 *
 * All API, worker and webhook-receiver bootstraps MUST obtain their logger
 * from this factory. Direct instantiation of NestJS Logger or console.* is
 * forbidden outside this module (enforced by guard test logger-factory-guard.spec.ts).
 *
 * The factory returns an object compatible with NestJS LoggerService (structural
 * typing — no runtime import of @nestjs/common required so the package stays
 * framework-agnostic). Pass the result to NestFactory.create() / createApplicationContext()
 * via the `logger` option.
 *
 * Usage:
 *   import { createLogger } from '@opsninja/observability';
 *   const app = await NestFactory.create(AppModule, { logger: createLogger({ context: 'Bootstrap' }) });
 */

import { redactObject } from '../privacy/redactor';

// NestJS-compatible LogLevel union — duplicated from @nestjs/common to avoid
// a runtime dependency on the framework inside this shared library.
export type LogLevel = 'verbose' | 'debug' | 'log' | 'warn' | 'error' | 'fatal';

// NestJS LoggerService structural interface (subset used by NestFactory).
export interface NestLoggerService {
  log(message: unknown, ...optionalParams: unknown[]): void;
  error(message: unknown, ...optionalParams: unknown[]): void;
  warn(message: unknown, ...optionalParams: unknown[]): void;
  debug?(message: unknown, ...optionalParams: unknown[]): void;
  verbose?(message: unknown, ...optionalParams: unknown[]): void;
  fatal?(message: unknown, ...optionalParams: unknown[]): void;
  setLogLevels?(levels: string[]): void;
}

export interface CreateLoggerOptions {
  /** NestJS context label shown in the level field (default: 'Application'). */
  context?: string;
  /** Minimum log level. Records below this level are silently dropped (default: 'log'). */
  minLevel?: LogLevel;
}

/** Ordered severity; lower index = lower priority. */
const LEVEL_ORDER: LogLevel[] = ['verbose', 'debug', 'log', 'warn', 'error', 'fatal'];

function shouldLog(level: LogLevel, minLevel: LogLevel): boolean {
  return LEVEL_ORDER.indexOf(level) >= LEVEL_ORDER.indexOf(minLevel);
}

function serializeArg(arg: unknown): unknown {
  if (arg === null || arg === undefined) return arg;
  if (typeof arg === 'string') return arg;
  return redactObject(arg);
}

function emit(
  level: LogLevel,
  defaultContext: string,
  message: unknown,
  ...optionalParams: unknown[]
): void {
  // NestJS passes the context string as the last optionalParam.
  const lastParam = optionalParams[optionalParams.length - 1];
  const context = typeof lastParam === 'string' ? lastParam : defaultContext;
  const extraParams =
    typeof lastParam === 'string' ? optionalParams.slice(0, -1) : optionalParams;

  const redactedMessage =
    typeof message === 'string' ? message : redactObject(message);
  const redactedParams = extraParams.map(serializeArg);

  const record: Record<string, unknown> = {
    level,
    context,
    message: redactedMessage,
  };

  if (redactedParams.length === 1) {
    record['meta'] = redactedParams[0];
  } else if (redactedParams.length > 1) {
    record['meta'] = redactedParams;
  }

  const line = JSON.stringify(record);

  if (level === 'error' || level === 'fatal') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
}

class RedactingLogger implements NestLoggerService {
  constructor(
    private readonly ctx: string,
    private readonly minLevel: LogLevel,
  ) {}

  log(message: unknown, ...rest: unknown[]): void {
    if (shouldLog('log', this.minLevel)) emit('log', this.ctx, message, ...rest);
  }

  error(message: unknown, ...rest: unknown[]): void {
    if (shouldLog('error', this.minLevel)) emit('error', this.ctx, message, ...rest);
  }

  warn(message: unknown, ...rest: unknown[]): void {
    if (shouldLog('warn', this.minLevel)) emit('warn', this.ctx, message, ...rest);
  }

  debug(message: unknown, ...rest: unknown[]): void {
    if (shouldLog('debug', this.minLevel)) emit('debug', this.ctx, message, ...rest);
  }

  verbose(message: unknown, ...rest: unknown[]): void {
    if (shouldLog('verbose', this.minLevel)) emit('verbose', this.ctx, message, ...rest);
  }

  fatal(message: unknown, ...rest: unknown[]): void {
    if (shouldLog('fatal', this.minLevel)) emit('fatal', this.ctx, message, ...rest);
  }

  setLogLevels?(_levels: string[]): void {
    // NestJS may call this; no-op — level is fixed at construction time.
  }
}

/**
 * Create a NestJS-compatible logger that redacts PII before serialisation.
 * Pass the returned object directly to NestFactory as the `logger` option.
 */
export function createLogger(opts: CreateLoggerOptions = {}): NestLoggerService {
  const context = opts.context ?? 'Application';
  const minLevel: LogLevel = opts.minLevel ?? 'log';
  return new RedactingLogger(context, minLevel);
}
