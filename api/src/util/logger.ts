const levels = ['debug', 'info', 'warn', 'error'] as const;
type Level = (typeof levels)[number];

const currentLevel: Level = (process.env.LOG_LEVEL as Level) ?? 'info';
const threshold = levels.indexOf(currentLevel);

function emit(level: Level, msg: string, extra?: Record<string, unknown>): void {
  if (levels.indexOf(level) < threshold) return;
  const line = { t: new Date().toISOString(), level, msg, ...extra };
  const out = JSON.stringify(line);
  if (level === 'error' || level === 'warn') console.error(out);
  else console.log(out);
}

export const log = {
  debug: (msg: string, extra?: Record<string, unknown>) => emit('debug', msg, extra),
  info: (msg: string, extra?: Record<string, unknown>) => emit('info', msg, extra),
  warn: (msg: string, extra?: Record<string, unknown>) => emit('warn', msg, extra),
  error: (msg: string, extra?: Record<string, unknown>) => emit('error', msg, extra),
};
