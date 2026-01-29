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
    menu: {
      theme: 'theme',
      lightMode: 'light mode',
      darkMode: 'dark mode'
    },
    stats: {
      words: (count) => `${count} words`,
      chars: (count) => `${count} chars`
    },
    editingOptions: {
      title: 'editing',
      viMode: {
        label: 'vi mode',
        enabled: 'vi mode enabled',
        disabled: 'vi mode disabled',
        quiz: {
          title: 'enable vi mode?',
          question: 'what command quits vi?',
          placeholder: 'enter command',
          hint: 'hint: starts with :',
          correct: 'correct! vi mode enabled',
          incorrect: 'not quite. try again!',
          confirm: 'enable',
          cancel: 'cancel'
        }
      }
    },
    buttons: {
      about: 'about',
      feedback: 'feedback',
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
      unpublished: 'private draft',
      linkCopied: 'link copied!',
      privateDraft: 'private draft',
      savedAsPrivate: 'saved as private',
      published: 'published',
      republished: 'republished'
    },
    publishButton: {
      publish: 'publish',
      published: 'published',
      republish: 'republish'
    },
    about: {
      title: 'about justtype',
      description: 'minimalist writing app with cloud storage and sharing.',
      encryption: 'your slates are encrypted with AES-256-GCM. private slates stay encrypted, published ones are public.',
      links: {
        terms: 'terms',
        privacy: 'privacy',
        project: 'project'
      },
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
      privateDraft: 'private draft',
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
      loginLink: 'login',
      privacyNote: 'we store your IP for session security. you can disable this in account settings.'
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
      count: (count) => `${count} active ${count === 1 ? 'session' : 'sessions'}`,
      unknownDevice: 'unknown device',
      unknownIp: 'unknown ip',
      localhost: 'localhost',
      currentBadge: 'this device',
      trackIp: 'track ip addresses',
      trackIpDescription: 'store ip addresses for sessions. when disabled, only device info is shown.',
      lastActive: (time) => `last active ${time}`,
      created: (time) => `created ${time}`,
      logout: 'logout',
      signOut: 'sign out',
      signOutThisDevice: 'sign out this device',
      signingOut: 'signing out...',
      logoutAll: 'sign out all other sessions',
      logoutEverywhere: 'sign out everywhere',
      loggingOut: 'logging out...',
      time: {
        justNow: 'just now',
        minutesAgo: (mins) => `${mins}m ago`,
        hoursAgo: (hrs) => `${hrs}h ago`,
        daysAgo: (days) => `${days}d ago`
      },
      modal: {
        title: 'sign out all other sessions?',
        message: 'this will sign you out from all devices except this one.',
        confirm: 'sign out all',
        cancel: 'cancel'
      },
      everywhereModal: {
        title: 'sign out everywhere?',
        message: 'this will sign you out from all devices including this one. you will need to login again.',
        confirm: 'sign out everywhere',
        cancel: 'cancel'
      },
      errors: {
        logoutAllFailed: 'failed to logout from all sessions',
        logoutSessionFailed: 'failed to logout session'
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
    },
    googleAuth: {
      signInMethod: 'sign in method:',
      methods: {
        password: 'password',
        google: 'google',
        both: 'google + password'
      },
      link: {
        button: '+ link google',
        modal: {
          title: 'link google account',
          message: 'this will allow you to sign in with either your password or google account. you\'ll be redirected to google to authorize the connection.',
          continue: 'continue to google',
          cancel: 'cancel'
        },
        success: {
          title: 'google account linked!',
          message: 'you can now sign in with either your password or google account.',
          button: 'okay'
        },
        errors: {
          title: 'linking failed',
          failed: 'failed to link google account.',
          alreadyLinked: 'this google account is already linked to another user.',
          sessionExpired: 'linking session expired. please try again.',
          button: 'okay'
        }
      },
      unlink: {
        button: 'unlink google',
        sendingCode: 'sending code...',
        modal: {
          title: 'unlink google account',
          instructions: 'enter the 6-digit code sent to your email to confirm unlinking.',
          codePlaceholder: '000000',
          submit: 'unlink',
          submitting: 'unlinking...',
          cancel: 'cancel'
        },
        success: {
          title: 'google account unlinked!',
          message: 'you can now only sign in with your password.',
          button: 'okay',
          codeSent: 'verification code sent to your email'
        },
        errors: {
          failed: 'failed to unlink google account'
        }
      }
    }
  },

  // subscription management
  subscription: {
    manage: {
      title: 'manage subscription',
      loading: 'loading...',
      currentPlan: 'current plan',
      plan: 'plan:',
      plans: {
        quarterly: 'supporter + unlimited',
        oneTime: 'supporter',
        free: 'free'
      },
      quarterlyDescription: 'manage your subscription, update payment method, or cancel anytime through stripe.',
      oneTimeDescription: 'thanks for your support! upgrade to quarterly for unlimited storage and recurring support.',
      freeDescription: 'support justtype development and get more storage.',
      manageButton: 'manage subscription',
      upgradeButton: 'upgrade to quarterly',
      supportButton: 'support justtype',
      backButton: 'back to account',
      manageDescription: 'opens stripe customer portal',
      errors: {
        loadFailed: 'failed to load subscription info',
        portalFailed: 'failed to open subscription management'
      }
    },
    alreadySubscribed: {
      title: 'you\'re already subscribed!',
      message: 'you already have an active subscription. manage it from your account page.',
      manageButton: 'manage subscription',
      closeButton: 'close'
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
        health: 'Health',
        announcements: 'Announcements',
        feedback: 'Feedback'
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
    },
    report: 'report',
    copy: 'copy',
    copied: 'copied!'
  },

  // 404 not found
  notFound: {
    messages: [
      (path) => `i think ${path} doesn't exist`,
      (path) => `typo much? or is ${path} an imaginary place?`,
      (path) => `it'd be funny if ${path} existed, right?`,
      (path) => `what do you mean ${path}? does that even exist?`,
      (path) => `four o four. i don't exist. -${path}`,
      (path) => `${path}? whats that?? is that edible???`
    ],
    button: 'back to writing'
  },

  slateNotFound: {
    messages: [
      "nope. that's not a real slate. nice try though.",
      "that share link doesn't exist. typo much?",
      "never heard of that slate. you sure you got it right?",
      "are you sure someone gave you the right link?",
      "slate? what slate? i don't see any slate. and even if there was one, which there isn't, it definitely wouldn't be here. who told you there was a slate?",
      "crickets...",
      "nope. nada. zilch. no slate by that name.",
      "just you, me, and... no slate. awkward.",
      "*crickets*",
      "there you are! we also lost this slate. please let us know if you find it."
    ],
    button: 'back to writing'
  },

  // feedback
  feedback: {
    title: 'feedback',
    subtitle: (username) => `hey ${username}, what's on your mind?`,
    placeholder: 'anything at all — bugs, ideas, or just say hi...',
    emailLabel: 'reply to (optional)',
    emailPlaceholder: 'your email',
    submit: 'send',
    sending: 'sending...',
    cancel: 'back',
    error: 'something went wrong, try again',
    thankYou: {
      title: 'thank you so much!',
      message: 'your feedback means the world. seriously. it helps shape what justtype becomes.',
      back: '← back to writing'
    },
    loggedOut: {
      message: "we'd love to hear from you! send us an email at:",
      email: 'hi@justtype.io',
      orLogin: 'or log in to submit feedback directly'
    }
  },

  // notifications
  notifications: {
    title: 'updates',
    empty: 'no updates yet',
    markAllRead: 'mark all as read'
  },

  // nudges
  nudges: {
    loginHeader: 'save your work →',
    support: 'enjoy justtype? support development →'
  },

  // modals
  modals: {
    unsavedChanges: {
      title: 'unsaved changes',
      message: 'you have unsaved changes. create a new slate anyway?',
      discard: 'discard & create new',
      cancel: 'cancel'
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
    },
    unlinkGoogle: {
      subject: 'unlink google account',
      body: (verificationCode) => `you requested to unlink your google account from justtype.

your verification code is: ${verificationCode}

this code will expire in 10 minutes.

if you didn't request this, please ignore this email.

- justtype`
    },
    subscriptionStarted: {
      subject: 'thank you for supporting justtype! ❤️',
      body: (username) => `hey ${username},

thank you so much for subscribing to justtype! your support means the world to us.

you now have unlimited storage and can write to your heart's content.

if you ever need help or have questions, just reply to this email.

happy writing!

- justtype`
    },
    subscriptionCancelled: {
      subject: 'sad to see you go',
      body: (username) => `hey ${username},

we're sorry to see you go, but we understand!

thank you for your previous support. it really helped keep justtype running.

your account will remain active with 25MB of free storage. you're always welcome back!

if you had any issues or feedback, we'd love to hear from you. just reply to this email.

take care!

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
  },

  // cli page
  cli: {
    tagline: 'justtype for your terminal',
    description: 'works offline. login to sync.',
    install: 'curl -fsSL https://justtype.io/cli/install.sh | bash',
    copied: 'copied!',
    copy: 'copy',
    copyAction: 'click to copy',
    platforms: 'linux and macos',
    github: 'github'
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
