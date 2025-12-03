// B2 Transaction Monitor
// Tracks Class B (reads) and Class C (writes) transactions
// Logs operations for analysis and debugging

class B2Monitor {
  constructor() {
    this.dailyStats = {
      classB: 0, // Downloads, listFiles, getFileInfo
      classC: 0, // Uploads, deletes
      bandwidth: 0, // Bytes downloaded
      date: this.getTodayString()
    };

    // Reset stats at midnight
    this.scheduleReset();
  }

  getTodayString() {
    return new Date().toISOString().split('T')[0];
  }

  scheduleReset() {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    const msUntilMidnight = tomorrow - now;

    setTimeout(() => {
      this.resetDaily();
      this.scheduleReset(); // Schedule next reset
    }, msUntilMidnight);
  }

  resetDaily() {
    const yesterday = this.dailyStats;
    console.log('=== B2 Daily Stats Summary ===');
    console.log(`Date: ${yesterday.date}`);
    console.log(`Class B (reads): ${yesterday.classB.toLocaleString()}`);
    console.log(`Class C (writes): ${yesterday.classC.toLocaleString()}`);
    console.log(`Bandwidth: ${(yesterday.bandwidth / 1024 / 1024).toFixed(2)} MB`);
    console.log('==============================');

    this.dailyStats = {
      classB: 0,
      classC: 0,
      bandwidth: 0,
      date: this.getTodayString()
    };
  }

  // Log and count Class B transaction (read)
  logClassB(operation, details = {}) {
    this.dailyStats.classB++;

    if (details.bytes) {
      this.dailyStats.bandwidth += details.bytes;
    }

    console.log(`[B2] Class B: ${operation}`, {
      total_today: this.dailyStats.classB,
      ...details
    });
  }

  // Log and count Class C transaction (write)
  logClassC(operation, details = {}) {
    this.dailyStats.classC++;

    console.log(`[B2] Class C: ${operation}`, {
      total_today: this.dailyStats.classC,
      ...details
    });
  }

  // Log errors separately for visibility
  logError(operation, error) {
    console.error(`[B2] ERROR: ${operation}`, {
      message: error.message,
      code: error.code,
      status: error.response?.status
    });
  }

  // Get current stats (for admin dashboard, etc.)
  getStats() {
    return {
      ...this.dailyStats,
      percentages: {
        classB: {
          used: this.dailyStats.classB,
          limit: 1252500,
          percent: ((this.dailyStats.classB / 1252500) * 100).toFixed(2)
        },
        classC: {
          used: this.dailyStats.classC,
          limit: 127500,
          percent: ((this.dailyStats.classC / 127500) * 100).toFixed(2)
        },
        bandwidth: {
          usedMB: (this.dailyStats.bandwidth / 1024 / 1024).toFixed(2),
          limitGB: 51,
          percent: ((this.dailyStats.bandwidth / 1024 / 1024 / 1024 / 51) * 100).toFixed(2)
        }
      }
    };
  }

  // Log stats every hour for monitoring
  startHourlyLogging() {
    setInterval(() => {
      const stats = this.getStats();
      console.log('=== Hourly B2 Stats ===');
      console.log(`Class B: ${stats.classB} (${stats.percentages.classB.percent}% of daily cap)`);
      console.log(`Class C: ${stats.classC} (${stats.percentages.classC.percent}% of daily cap)`);
      console.log(`Bandwidth: ${stats.percentages.bandwidth.usedMB} MB (${stats.percentages.bandwidth.percent}% of daily cap)`);
      console.log('======================');
    }, 60 * 60 * 1000); // Every hour
  }
}

const monitor = new B2Monitor();

// Start hourly logging
monitor.startHourlyLogging();

module.exports = monitor;
