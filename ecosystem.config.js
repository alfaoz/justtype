// PM2 configuration for production
// NOTE: Update 'interpreter' path to match your node installation
module.exports = {
  apps: [{
    name: 'justtype',
    script: './server/index.js',
    interpreter: 'node', // or specify your node path
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
