// PM2 ecosystem — ИИ-новостной агент (production)
// Usage: pm2 start ecosystem.config.cjs && pm2 save
module.exports = {
  apps: [
    {
      name: 'news-agent-web',
      cwd: '/var/www/news-agent/app',
      script: 'dist/boot.js',
      env: {
        NODE_ENV: 'production',
      },
      instances: 1,
      autorestart: true,
      max_memory_restart: '512M',
      out_file: '/var/log/news-agent/web.out.log',
      error_file: '/var/log/news-agent/web.err.log',
      merge_logs: true,
    },
    {
      name: 'hermes-ralph-loop',
      cwd: '/var/www/news-agent/app',
      script: 'scripts/hermes/ralph-loop.sh',
      interpreter: '/bin/bash',
      instances: 1,
      autorestart: true,
      restart_delay: 60000,
      max_memory_restart: '512M',
      out_file: '/var/log/news-agent/hermes.out.log',
      error_file: '/var/log/news-agent/hermes.err.log',
      merge_logs: true,
    },
  ],
};
