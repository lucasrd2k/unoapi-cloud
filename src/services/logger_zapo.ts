import type { Logger, LogLevel } from 'zapo-js'
import logger from './logger'

const normalizeLevel = (level: string | undefined): LogLevel => {
  if (level === 'trace' || level === 'debug' || level === 'info' || level === 'warn' || level === 'error') {
    return level
  }
  return level === 'fatal' ? 'error' : 'info'
}

const mergeContext = (bindings: Readonly<Record<string, unknown>>, context?: Readonly<Record<string, unknown>>) => ({
  ...bindings,
  ...(context || {}),
})

export const createZapoLogger = (
  bindings: Readonly<Record<string, unknown>> = {},
  level: LogLevel = normalizeLevel(logger.level),
): Logger => ({
  level,
  trace: (message, context) => logger.trace(mergeContext(bindings, context), message),
  debug: (message, context) => logger.debug(mergeContext(bindings, context), message),
  info: (message, context) => logger.info(mergeContext(bindings, context), message),
  warn: (message, context) => logger.warn(mergeContext(bindings, context), message),
  error: (message, context) => logger.error(mergeContext(bindings, context), message),
  child: (childBindings: Readonly<Record<string, unknown>>, options?: { readonly level?: LogLevel }) =>
    createZapoLogger({ ...bindings, ...childBindings }, options?.level || level),
})

export const zapoLogger = createZapoLogger({ provider: 'zapo' })
