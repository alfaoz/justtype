const https = require('https');

// Cache for disposable email domains
let disposableDomains = new Set();
let lastFetch = 0;
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

// Fetch the latest disposable email domains list
async function fetchDisposableDomains() {
  return new Promise((resolve, reject) => {
    https.get('https://raw.githubusercontent.com/disposable-email-domains/disposable-email-domains/refs/heads/main/disposable_email_blocklist.conf', (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        const domains = data.split('\n').filter(line => line.trim() && !line.startsWith('#'));
        disposableDomains = new Set(domains);
        lastFetch = Date.now();
        console.log(`✓ Loaded ${disposableDomains.size} disposable email domains`);
        resolve();
      });
    }).on('error', (err) => {
      console.error('Failed to fetch disposable domains:', err);
      reject(err);
    });
  });
}

// Initialize on first load
fetchDisposableDomains().catch(err => {
  console.error('Initial fetch of disposable domains failed:', err);
});

function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

async function isDisposableEmail(email) {
  // Refresh cache if needed
  if (Date.now() - lastFetch > CACHE_DURATION) {
    try {
      await fetchDisposableDomains();
    } catch (err) {
      console.error('Failed to refresh disposable domains cache');
    }
  }

  const domain = email.split('@')[1]?.toLowerCase();
  return disposableDomains.has(domain);
}

async function validateEmailForRegistration(email) {
  if (!email) {
    return { valid: false, error: 'Email is required' };
  }

  if (!isValidEmail(email)) {
    return { valid: false, error: 'Invalid email format' };
  }

  if (await isDisposableEmail(email)) {
    return {
      valid: false,
      error: 'Temporary email addresses are not allowed. Please use a permanent email address to help prevent spam accounts.'
    };
  }

  return { valid: true };
}

module.exports = {
  isValidEmail,
  isDisposableEmail,
  validateEmailForRegistration,
};
