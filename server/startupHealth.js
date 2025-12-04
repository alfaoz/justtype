// Startup health checks - validate environment and connections
const db = require('./database');
const b2Storage = require('./b2Storage');

const healthChecks = async () => {
  const results = [];
  let hasErrors = false;

  // 1. Required environment variables
  const required = {
    'JWT_SECRET': process.env.JWT_SECRET,
    'B2_APPLICATION_KEY_ID': process.env.B2_APPLICATION_KEY_ID,
    'B2_APPLICATION_KEY': process.env.B2_APPLICATION_KEY,
    'B2_BUCKET_ID': process.env.B2_BUCKET_ID,
  };

  for (const [key, value] of Object.entries(required)) {
    if (!value) {
      results.push({ check: key, status: 'FAIL', message: 'Missing (required)' });
      hasErrors = true;
    } else {
      results.push({ check: key, status: 'OK', message: 'Set' });
    }
  }

  // 2. Optional environment variables
  const optional = {
    'RESEND_API_KEY': process.env.RESEND_API_KEY,
    'ADMIN_PASSWORD': process.env.ADMIN_PASSWORD,
    'PORT': process.env.PORT,
  };

  for (const [key, value] of Object.entries(optional)) {
    if (!value) {
      results.push({ check: key, status: 'WARN', message: 'Not set (optional)' });
    } else {
      results.push({ check: key, status: 'OK', message: 'Set' });
    }
  }

  // 3. B2 Connection Test
  try {
    await b2Storage.authorize();
    results.push({ check: 'B2 Connection', status: 'OK', message: 'Authorized' });
  } catch (err) {
    results.push({ check: 'B2 Connection', status: 'FAIL', message: err.message });
    hasErrors = true;
  }

  // 4. Database Check
  try {
    const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get();
    const slateCount = db.prepare('SELECT COUNT(*) as count FROM slates').get();
    results.push({
      check: 'Database',
      status: 'OK',
      message: `${userCount.count} users, ${slateCount.count} slates`
    });
  } catch (err) {
    results.push({ check: 'Database', status: 'FAIL', message: err.message });
    hasErrors = true;
  }

  // 5. Disk Space Check
  try {
    const { execSync } = require('child_process');
    const diskUsage = execSync("df -h / | tail -1 | awk '{print $5}'").toString().trim();
    const diskAvail = execSync("df -h / | tail -1 | awk '{print $4}'").toString().trim();
    results.push({
      check: 'Disk Space',
      status: 'OK',
      message: `${diskUsage} used, ${diskAvail} available`
    });
  } catch (err) {
    results.push({ check: 'Disk Space', status: 'WARN', message: 'Could not check' });
  }

  // 6. Memory Check
  try {
    const totalMem = (require('os').totalmem() / 1024 / 1024 / 1024).toFixed(1);
    const freeMem = (require('os').freemem() / 1024 / 1024 / 1024).toFixed(1);
    results.push({
      check: 'Memory',
      status: 'OK',
      message: `${freeMem}GB free / ${totalMem}GB total`
    });
  } catch (err) {
    results.push({ check: 'Memory', status: 'WARN', message: 'Could not check' });
  }

  // Print results
  console.log('\n=== STARTUP HEALTH CHECK ===');
  results.forEach(r => {
    const icon = r.status === 'OK' ? '✓' : r.status === 'WARN' ? '⚠' : '✗';
    console.log(`${icon} ${r.check.padEnd(25)} ${r.message}`);
  });
  console.log('============================\n');

  // Exit if there are critical errors
  if (hasErrors) {
    console.error('FATAL: Startup health check failed. Exiting.');
    process.exit(1);
  }

  return results;
};

module.exports = { healthChecks };
