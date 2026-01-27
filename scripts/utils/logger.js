/**
 * Development-aware logger
 * - In dev: all levels output to console
 * - In prod: only warn/error output
 */

const isDev = import.meta.env.DEV;

/**
 * Logger with tag support
 * Usage: log.info('[Marketplace]', 'Loaded', count, 'robots')
 */
export const log = {
    /**
     * Debug level - dev only, for verbose debugging
     */
    debug: (...args) => isDev && console.debug(...args),

    /**
     * Info level - dev only, for general information
     */
    info: (...args) => isDev && console.log(...args),

    /**
     * Warn level - always shown, for warnings
     */
    warn: (...args) => console.warn(...args),

    /**
     * Error level - always shown, for errors
     */
    error: (...args) => console.error(...args),
};

export default log;
