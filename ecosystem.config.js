// PM2 configuration for production
module.exports = {
  apps: [{
    name: 'justtype',
    script: './server/index.js',
    interpreter: '/root/.nvm/versions/node/v20.19.6/bin/node',
    exec_mode: 'fork',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production',
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    time: true,
  }],
};
