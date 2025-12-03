// centralized strings for the entire app
// edit here and rebuild to update all text throughout the site

const strings = {
  // app-level navigation and layout
  app: {
    logo: '+ just type',
    welcome: (username) => `hey, ${username}`,
    tabs: {
      writer: 'writer',
      slates: 'my slates',
      account: 'account',
      login: 'login / sign-up'
    },
    hints: {
      toggleTip: 'tip: use the toggle to switch between writer and slates'
    }
  },

  // writer component
  writer: {
    titlePlaceholder: 'slate title...',
    contentPlaceholder: 'just start typing...',
    zenMode: {
      on: 'zen mode on',
      off: 'zen mode off'
    },
    stats: {
      words: (count) => `${count} words`,
      chars: (count) => `${count} chars`
    },
    buttons: {
      about: 'about',
      publish: 'publish',
      published: 'published',
      save: 'save',
      exportTxt: 'export as txt',
      exportPdf: 'export as pdf'
    },
    menu: {
      unpublishSlate: 'unpublish slate',
      getShareLink: 'get shareable link',
      copyLink: 'copy link',
      saveToAccount: 'Save to Account',
      exportAsTXT: 'Export as TXT',
      exportAsPDF: 'Export as PDF',
      aboutJustType: 'About JustType',
      unpublishSlateAction: 'Unpublish Slate',
      getShareLinkAction: 'Get Shareable Link',
      copyShareLink: 'Copy Shareable Link'
    },
    status: {
      ready: 'ready',
      unpublished: 'unpublished',
      linkCopied: 'link copied!'
    },
    about: {
      title: 'about justtype',
      description1: 'a minimalist writing app designed to help you just type, and not worry about the rest..',
      description2: 'write freely, save your work, and share them when you\'re ready.',
      encryptionTitle: 'end-to-end encryption',
      encryptionDetails: 'your slates are encrypted with AES-256-GCM before storage. each user has a unique encryption key derived from your password using PBKDF2. even if our storage is compromised, your private slates remain secure. published slates are stored unencrypted for public access.',
      securityChallenge: '',
      version: (v) => `version ${v}`,
      close: 'close'
    }
  },

  // slate manager
  slates: {
    title: 'my slates',
    newSlate: '+ new slate',
    empty: {
      message: 'no slates yet',
      cta: 'create your first slate!'
    },
    loading: 'loading slates...',
    stats: {
      wordsShort: (count) => `${count}w`,
      charsShort: (count) => `${count}c`,
      words: (count) => `${count} words`,
      chars: (count) => `${count} chars`,
      updated: (date) => `updated: ${date}`,
      published: (date) => `published: ${date}`,
      unpublished: 'unpublished',
      pubShort: (date) => `pub: ${date}`
    },
    menu: {
      publish: 'publish',
      unpublish: 'unpublish',
      delete: 'delete'
    },
    deleteModal: {
      title: 'delete slate?',
      message: (title) => `Are you sure you want to delete "${title}"? This cannot be undone!`,
      confirm: 'delete',
      cancel: 'cancel'
    }
  },

  // auth modal
  auth: {
    login: {
      title: 'login',
      username: 'username',
      usernamePlaceholder: 'enter username',
      password: 'password',
      passwordPlaceholder: 'enter password',
      submit: 'login',
      noAccount: 'don\'t have an account?',
      signupLink: 'sign up'
    },
    signup: {
      title: 'sign up',
      username: 'username',
      usernamePlaceholder: 'choose username',
      email: 'email',
      emailPlaceholder: 'your email',
      password: 'password',
      passwordPlaceholder: 'create password',
      confirmPassword: 'confirm password',
      confirmPasswordPlaceholder: 'confirm password',
      submit: 'create account',
      haveAccount: 'already have an account?',
      loginLink: 'login'
    },
    verify: {
      title: 'verify your email',
      instructions: (email) => `a 6-digit code should be sent to ${email}. enter it below to verify your account.`,
      codePlaceholder: '6-digit code',
      label: 'verification code',
      submit: 'verify',
      resend: 'resend code',
      skip: 'skip for now' // this should be deprecated. -alfa
    }
  },

  // account settings
  account: {
    title: 'account settings',
    info: {
      title: 'account info',
      username: 'username:',
      email: 'email:',
      verified: 'verified',
      notVerified: 'not verified', // should be deprecared as well -alfa
      change: 'change'
    },
    password: {
      title: 'change password',
      currentPlaceholder: 'current password',
      newPlaceholder: 'new password',
      confirmPlaceholder: 'confirm new password',
      submit: 'change password',
      submitting: 'changing...',
      errors: {
        mismatch: 'New passwords do not match',
        tooShort: 'New password must be at least 6 characters',
        changeFailed: 'Failed to change password'
      },
      success: 'Password changed successfully'
    },
    sessions: {
      title: 'sessions',
      loading: 'loading sessions...',
      count: (count) => `active sessions: ${count}`,
      unknownDevice: 'Unknown Device',
      unknownIp: 'Unknown IP',
      localhost: 'localhost',
      currentBadge: 'current',
      lastActive: (time) => `last active: ${time}`,
      created: (time) => `created: ${time}`,
      logout: 'logout',
      logoutAll: 'logout all sessions',
      loggingOut: 'logging out...',
      time: {
        justNow: 'just now',
        minutesAgo: (mins) => `${mins}m ago`,
        hoursAgo: (hrs) => `${hrs}h ago`,
        daysAgo: (days) => `${days}d ago`
      },
      modal: {
        title: 'logout from all devices?',
        message: 'you will need to login again on all devices, including this one.',
        confirm: 'logout all',
        cancel: 'cancel'
      },
      errors: {
        logoutAllFailed: 'Failed to logout from all sessions'
      }
    },
    danger: {
      title: 'danger zone',
      warning: 'Once you delete your account, all your slates will be permanently shredded and burned. Try bringing that back.',
      confirmPlaceholder: (username) => `type "${username}" to confirm`,
      confirmInstruction: (username) => `type ${username} to confirm`,
      submit: 'delete account',
      submitting: 'deleting...',
      modal: {
        cancel: 'cancel'
      },
      errors: {
        confirmMismatch: (username) => `Please type "${username}" to confirm`
      }
    },
    emailChange: {
      title: 'change email',
      newEmailPlaceholder: 'new email address',
      submitSend: 'send code',
      submittingSend: 'sending...',
      cancel: 'cancel',
      verifyInstructions: (email) => `Enter the 6-digit code sent to ${email}`,
      codePlaceholder: 'verification code',
      submitVerify: 'verify',
      submittingVerify: 'verifying...',
      success: {
        codeSent: (email) => `Verification code sent to your new email`,
        changed: 'Email changed successfully!'
      },
      errors: {
        sendFailed: 'Failed to send verification code',
        verifyFailed: 'Failed to verify code'
      }
    }
  },

  // what is this? :0
  admin: {
    login: {
      title: 'admin console',
      tokenLabel: 'admin token',
      tokenPlaceholder: 'enter admin token',
      submit: 'login',
      errors: {
        authFailed: 'Authentication failed',
        failed: 'Failed to authenticate'
      }
    },
    dashboard: {
      title: 'admin console',
      logout: 'logout',
      tabs: {
        overview: 'Overview',
        users: 'Users',
        logs: 'Logs',
        health: 'Health'
      },
      stats: {
        title: 'stats',
        totalUsers: 'total users:',
        totalSlates: 'total slates:',
        publishedSlates: 'published slates:'
      },
      users: {
        title: 'users',
        loading: 'loading...',
        loadingUsers: 'loading users...',
        slateCount: (count) => `${count} slates`,
        verified: 'verified',
        notVerified: 'not verified', // should be deprecated!
        joined: (date) => `joined ${date}`,
        deleteUser: 'delete user',
        noUsers: 'no users found',
        table: {
          id: 'id',
          username: 'username',
          email: 'email',
          verified: 'verified',
          slates: 'slates',
          storage: 'storage',
          joined: 'joined',
          actions: 'actions'
        },
        pagination: {
          showing: (start, end, total) => `showing ${start}-${end} of ${total} users`,
          prev: 'prev',
          next: 'next'
        },
        deleteConfirm: (username) => `Are you sure you want to delete user "${username}"? This will delete all their slates and cannot be undone.`,
        deleteSuccess: (username) => `User "${username}" deleted successfully`,
        errors: {
          fetchFailed: 'Failed to fetch users',
          deleteFailed: 'Failed to delete user'
        }
      },
      overview: {
        b2Title: 'b2 storage usage',
        classB: 'class b (reads)',
        classC: 'class c (writes)',
        bandwidth: 'bandwidth',
        dailyCap: (percent, limit) => `${percent}% of ${limit} daily cap`,
        quickStats: 'quick stats',
        totalUsers: 'total users',
        totalSlates: 'total slates',
        published: 'published',
        storageUsed: 'storage used',
        todayGrowth: (count) => `+${count} today`
      },
      logs: {
        title: 'activity logs',
        loading: 'loading...',
        noLogs: 'no logs found',
        table: {
          time: 'time',
          action: 'action',
          target: 'target',
          details: 'details',
          ip: 'ip address'
        }
      },
      health: {
        title: 'system health',
        loading: 'loading...'
      }
    }
  },

  // public viewer
  public: {
    loading: 'loading...',
    byAuthor: (author) => `by ${author}`,
    stats: {
      words: (count) => `${count} words`,
      chars: (count) => `${count} chars`,
      updated: (date) => `updated: ${date}`
    }
  },

  // email templates
  email: {
    verification: {
      subject: 'verify your just type account',
      body: (username, code) => `hey ${username},

your code is: ${code}

it lasts for 10 minutes!

if this wasn't you, lmao. probably a typo. 

- justtype`
    },
    passwordReset: {
      subject: 'reset your just type password',
      body: (username, code) => `hey ${username},

the password reset code is: ${code}

it lasts for 10 minutes!

wasn't you? are you sure?? well someone's trying to get into your account.
or they mistyped their email? either way, it's safe to ignore this email!

- justtype`
    }
  },

  // common error messages
  errors: {
    generic: 'something went wrong </3',
    network: 'network error',
    unauthorized: 'unauthorized!',
    notFound: 'not found',
    saveFailed: 'failed to save',
    loadFailed: 'failed to load',
    deleteFailed: 'failed to delete',
    deleteSlate: 'Failed to delete slate',
    publishFailed: 'Failed to update publish status',
    loginFailed: 'login failed',
    signupFailed: 'signup failed',
    verificationFailed: 'verification failed',
    passwordChangeFailed: 'password change failed',
    emailChangeFailed: 'email change failed',
    sessionExpired: 'session expired'
  },

  // success messages
  success: {
    saved: 'saved!',
    deleted: 'deleted!',
    verified: 'verified!',
    emailSent: 'email sent!',
    passwordChanged: 'password changed!',
    emailChanged: 'email changed!'
  }
};

// Export for ES6 modules (client/Vite)
export { strings };

// Also export for CommonJS (server)
if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
  try {
    module.exports = { strings };
  } catch (e) {
    // Ignore error in ES6 module context
  }
}
