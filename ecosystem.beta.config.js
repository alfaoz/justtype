// PM2 configuration for the beta instance (beta.justtype.io)
// Runs from a separate checkout with its own .env (port 3006, separate DB, B2_PREFIX)
module.exports = {
  apps: [{
    name: 'justtype-beta',
    script: './server/index.js',
    interpreter: 'node',
    exec_mode: 'fork',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '300M',
    env: {
      NODE_ENV: 'production',
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    time: true,
  }],
};
