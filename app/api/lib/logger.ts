const LOG_LEVEL = process.env.LOG_LEVEL || "info";

interface LogEntry {
  level: string;
  time: string;
  msg: string;
  [key: string]: unknown;
}

function formatLog(entry: LogEntry): string {
  const base = `${entry.time} [${entry.level.toUpperCase()}] ${entry.msg}`;
  const extras = Object.entries(entry)
    .filter(([k]) => !["level", "time", "msg"].includes(k))
    .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`)
    .join(" ");
  return extras ? `${base} ${extras}` : base;
}

function log(level: string, msg: string, data?: Record<string, unknown>) {
  if (shouldLog(level)) {
    const entry: LogEntry = {
      level,
      time: new Date().toISOString(),
      msg,
      ...data,
    };
    console.log(formatLog(entry));
  }
}

function shouldLog(level: string): boolean {
  const levels = ["debug", "info", "warn", "error"];
  const currentIdx = levels.indexOf(LOG_LEVEL);
  const msgIdx = levels.indexOf(level);
  return msgIdx >= currentIdx;
}

export const logger = {
  debug: (msg: string, data?: Record<string, unknown>) => log("debug", msg, data),
  info: (msg: string, data?: Record<string, unknown>) => log("info", msg, data),
  warn: (msg: string, data?: Record<string, unknown>) => log("warn", msg, data),
  error: (msg: string, data?: Record<string, unknown>) => log("error", msg, data),
};
