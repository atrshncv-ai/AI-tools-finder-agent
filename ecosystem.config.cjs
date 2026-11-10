// PM2 ecosystem — news agent (production).
//
// Usage: pm2 start ecosystem.config.cjs && pm2 save
//
// Two processes, both from this repository (R16 — no external runtime):
//   news-agent-web      the Hono + tRPC server and the built dashboard (dist/boot.js)
//   hermes-ralph-loop   the pipeline loop; it publishes ONE release per UTC day
//
// app/.env is the only source of configuration. PM2 does not read dotenv files
// on its own, and a process started without DATABASE_URL fails at boot, so the
// file is read here and merged into the process environment. Empty values are
// dropped: an empty variable must not override a default baked into the code.
// Values are passed to PM2 only; nothing from app/.env is ever printed.

const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const APP_ROOT = process.env.APP_ROOT || `${__dirname}/app`;

function readEnvFile(path) {
  const values = {};
  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return values;
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));
    if (quoted && value.length >= 2) value = value.slice(1, -1);
    if (value !== "") values[match[1]] = value;
  }
  return values;
}

const sharedEnv = {
  NODE_ENV: "production",
  ...readEnvFile(resolve(APP_ROOT, ".env")),
};

module.exports = {
  apps: [
    {
      name: "news-agent-web",
      cwd: APP_ROOT,
      script: "dist/boot.js",
      env: sharedEnv,
      instances: 1,
      autorestart: true,
      max_memory_restart: "512M",
      out_file: "/var/log/news-agent/web.out.log",
      error_file: "/var/log/news-agent/web.err.log",
      merge_logs: true,
    },
    {
      name: "hermes-ralph-loop",
      cwd: APP_ROOT,
      script: "scripts/hermes/ralph-loop.sh",
      interpreter: "/bin/bash",
      env: sharedEnv,
      instances: 1,
      autorestart: true,
      restart_delay: 60000,
      max_memory_restart: "512M",
      out_file: "/var/log/news-agent/hermes.out.log",
      error_file: "/var/log/news-agent/hermes.err.log",
      merge_logs: true,
    },
  ],
};
