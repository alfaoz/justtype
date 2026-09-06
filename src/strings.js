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
    editorMode: {
      label: (mode) => `editor: ${mode === 'wysiwyg' ? 'rich' : 'plain'}`,
      menuTitle: 'editor',
      value: (mode) => (mode === 'wysiwyg' ? 'rich' : 'plain'),
    },
    connectivity: {
      offline: 'offline',
      notSaved: 'not saved',
      savedLocally: 'saved on this device',
      notAvailableOffline: 'not available offline',
      syncing: 'syncing',
      merged: 'merged with edits made elsewhere',
      conflicts: (n) => `${n} ${n === 1 ? 'conflict' : 'conflicts'} to resolve`,
      offlineHint: 'no connection. keep writing; saving picks up when you are back online',
      update: 'new version · reload',
      updateHint: 'a newer justtype is live. reload to get it'
    },
    conflict: {
      ours: 'this device',
      theirs: 'elsewhere',
      keepOurs: 'keep mine',
      keepTheirs: 'keep theirs',
      keepBoth: 'keep both'
    },
    publicState: {
      current: 'public',
      outdated: 'private draft · sync',
      outdatedHint: 'your public copy is stale. click to update it'
    },
    collabState: {
      label: 'collab',
      hint: 'this slate is collaborative. click to manage people.',
      sharedHint: 'shared with you. click to see who else is here.',
      publishBlocked: 'coming soon',
      publishBlockedHint: 'publishing a collab slate is not available yet.'
    },
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
    buttons: {
      about: 'about',
      feedback: 'feedback',
      publish: 'publish',
      published: 'published',
      save: 'save',
      export: 'export',
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
      republished: 'republished',
      draftRestored: 'draft restored',
      forgottenPublic: 'unpublished, link disabled'
    },
    publishMenu: {
      forget: 'unpublish completely',
      forgetConfirm: 'sure?',
      forgetHint: 'kills the public link for good and forgets this slate was ever public'
    },
    publishButton: {
      publish: 'publish',
      published: 'published',
      republish: 'republish'
    },
    about: {
      title: 'about justtype',
      description: 'minimalist writing app with cloud storage and sharing.',
      encryption: 'your slates are locally encrypted with aes-256-gcm, before it gets to our servers.',
      encryptionLabel: 'end to end encrypted',
      byline: 'made by',
      links: {
        terms: 'terms of service',
        privacy: 'privacy policy',
        project: 'the justtype project',
        github: 'github',
        feedback: 'send us feedback'
      },
      support: {
        title: 'support justtype',
        body: "justtype is free to use, but it isn't free to run. chip in to keep it running and to raise your storage",
        limits: 'limits',
        donate: 'donate once',
        donateHint: 'any amount',
        subscribe: 'subscribe',
        subscribeHint: '7 eur / 3 months'
      },
      version: (v) => `version ${v}`,
      close: 'close'
    },
    // mobile sheet
    mobile: {
      open: 'open menu',
      close: 'close menu',
      words: (n) => `${n} ${n === 1 ? 'word' : 'words'}`,
      counterOn: 'counter on',
      counterOff: 'counter off',
      exportSlate: 'export slate',
      sections: {
        sharing: 'sharing'
      }
    }
  },

  // slate manager
  slates: {
    title: 'my slates',
    newSlate: '+ new slate',
    searchPlaceholder: 'search slates...',
    sortLabel: 'sort:',
    sortOptions: {
      recent: 'recent',
      oldest: 'oldest',
      az: 'a-z',
      za: 'z-a',
      words: 'words',
    },
    filterByApp: 'from app:',
    filterAllApps: 'all',
    viewToggle: {
      list: 'list view',
      grid: 'grid view',
    },
    lockedTitle: 'locked slate',
    offline: {
      // The device mark after each title: a check for a copy on this device
      // (dim when the app made it, green when you asked for it), a cloud
      // for a slate that is not here yet
      auto: 'on this device',
      kept: 'kept on this device',
      missing: 'not on this device yet. click to copy it',
      missingOffline: 'not on this device',
      copying: 'copying to this device',
      pending: 'saved on this device, not in your account yet',
      pendingEdits: 'edits saved on this device, not in your account yet',
      syncing: 'syncing to your account',
      synced: 'synced',
      keep: 'keep on this device',
      unkeep: 'remove from this device'
    },
    untitled: 'untitled slate',
    unlockRequired: 'unlock your slates first.',
    noMatches: (query) => `no slates match "${query}"`,
    status: {
      public: 'public',
      private: 'private',
      wasPublic: 'draft (was public)',
      fromApp: 'from {app}',
      fromAppTitle: 'this slate was created by {app} and imported into your account. it is now yours and stays even if you remove the app.',
      syncing: 'syncing…',
      syncingTitle: 'an app created this note for you; it is being decrypted and added to your account. it will be ready in a moment.',
    },
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
      makePublic: 'make public',
      makePrivate: 'make private',
      tags: 'tags',
      more: 'more',
      delete: 'delete'
    },
    pin: {
      pin: 'pin',
      unpin: 'unpin',
    },
    tags: {
      filterLabel: (tag) => `tag: ${tag}`,
      addPlaceholder: 'add tag...',
      addButton: 'add',
      saving: 'saving...',
      save: 'save',
      cancel: 'cancel',
      title: 'tags',
      emptyHint: 'no tags yet',
      unlockRequired: 'unlock your slates to edit tags.',
      invalidTag: 'tags must be alphanumeric with no spaces.',
      tooLong: (max) => `tag too long (max ${max} chars).`,
      tooMany: (max) => `too many tags (max ${max}).`,
    },
    deleteModal: {
      title: 'delete slate?',
      message: (title) => `Are you sure you want to delete "${title}"? This cannot be undone!`,
      confirm: 'delete',
      cancel: 'cancel'
    }
  },

  // e2ee collaborative slates
  collab: {
    menuButton: 'collab',
    // Shown when collab is opened on a brand new slate with nothing in it: the
    // slate has to be saved first, and an empty one cannot be.
    needsContent: 'write something first',
    modal: {
      title: 'collab',
      explainer: 'collaboratively work on the same slate. invite people by their username or share a link, while staying end-to-end encrypted.',
      enableButton: 'turn on sharing',
      enabling: 'turning on...',
      disableButton: 'turn off sharing',
      disableConfirm: 'sure?',
      disabling: 'turning off...',
      disableHint: 'turning sharing off removes everyone and re-keys the slate.',
      inputPlaceholder: 'username to invite...',
      inviteButton: 'invite',
      inviting: 'inviting...',
      membersTitle: 'people',
      you: 'you',
      roleOwner: 'owner',
      statusPending: 'invited',
      remove: 'remove',
      removeConfirm: 'sure?',
      removedRotated: 'removed. the slate key was rotated.',
      colorHint: 'this is their colour on shared carets.',
      rotationWarning: 'this re-keys the slate, which also clears version history.',
      revokedRotated: 'link revoked. the slate key was rotated.',
      link: {
        title: 'invite link',
        create: 'create invite link',
        copy: 'copy',
        copied: 'copied',
        active: 'a link is active.',
        copyNew: 'get new link',
        revoke: 'revoke',
        revokeConfirm: 'sure?',
        hint: 'anyone with the link can join. revoking it rotates the slate key, locking the old link out.'
      },
      needsSave: 'save this slate before sharing it',
      close: 'close'
    },
    history: {
      button: 'history',
      title: 'version history',
      loading: 'loading checkpoints...',
      empty: 'no checkpoints yet. they build up as you write together.',
      pick: 'pick a checkpoint to preview it.',
      loadingPreview: 'opening...',
      emptyDoc: '(empty)',
      by: (name) => `by ${name}`,
      restore: 'restore this version',
      restoreConfirm: 'sure?',
      currentRow: 'current',
      currentRowMeta: 'live',
      legendSinceLast: 'what has changed since the most recent checkpoint.',
      noChangesSinceLast: 'nothing has changed since the most recent checkpoint.',
      comparePrev: 'vs previous',
      compareCurrent: 'vs current',
      textTab: 'full text',
      noChangesPrev: 'this version is identical to the one before it.',
      noChangesCurrent: 'nothing has changed since this version.',
      diffTooBig: 'this version is too long to compare line by line. showing the full text instead.',
      legendPrev: 'what changed in this version, against the checkpoint before it.',
      legendCurrent: 'what changed between this version and the slate right now.',
      noPrevious: 'this is the earliest version kept, so there is nothing before it to compare against.',
      current: 'current',
      pinned: 'pinned',
      nameVersion: 'name this version',
      namePlaceholder: 'name this version...',
      nameSave: 'save',
      nameClear: 'remove name',
      naming: 'saving...',
      openAsNew: 'open as a new slate',
      openAsNewHint: 'opens this version as a fresh draft. this collab slate stays exactly as it is.'
    },
    nearby: {
      tab: 'nearby',
      chip: (n) => `nearby · ${n}`,
      unavailable: 'nearby connections appear once this slate is collaborative.',
      explainer: 'connect to a device next to you with no server in between. both devices need this slate and the same wi-fi; internet is not needed.',
      showCode: 'show a code',
      readCode: 'read a code',
      preparing: 'preparing a code...',
      showHint: 'the other device reads this code, then shows a reply code.',
      readReply: 'read their reply',
      replyHint: 'show this reply to the first device.',
      pointCamera: 'point the camera at the other screen, or paste the code below.',
      noCamera: 'no camera here. paste the code below.',
      pastePlaceholder: 'paste a code...',
      useCode: 'use this code',
      badCode: 'that is not the code expected here',
      connecting: 'connecting...',
      connectedHeading: 'connected devices',
      wordsHint: 'the same four words show on the other screen. if they differ, disconnect.',
      disconnect: 'disconnect',
      cancel: 'cancel',
      qrLabel: 'connection code',
      copy: 'copy code',
      copied: 'copied',
      network: {
        title: 'the devices cannot reach each other. put both on the same wi-fi:',
        mac: 'mac: system settings → general → sharing → internet sharing, share to wi-fi.',
        android: 'android: hotspot on, mobile data can stay off.',
        linux: 'linux: wi-fi menu → turn on hotspot.',
        then: 'then read the codes again.',
        retry: 'try again'
      }
    },
    panel: {
      title: 'collab',
      tabPeople: 'people',
      tabHistory: 'history',
      close: 'close panel',
      historyUnavailable: 'version history appears once this slate is collaborative.'
    },
    join: {
      title: 'join a shared slate',
      checking: 'checking the link...',
      by: (owner) => `shared by ${owner}`,
      untitled: 'untitled slate',
      explainer: 'you were invited to write on this slate. it stays end-to-end encrypted; the key came with your link and never touches the server.',
      alreadyMember: 'you already have access to this slate.',
      join: 'join',
      joining: 'joining...',
      open: 'open',
      decline: 'not now',
      invalid: 'this link is no longer valid. ask for a fresh one.',
      missingKey: 'this link is incomplete (its key part is missing). ask for a fresh one.',
      loginFirst: 'log in to join this slate.',
      login: 'log in',
      back: 'back'
    },
    invites: {
      title: 'invites',
      from: (owner) => `from ${owner}`,
      accept: 'accept',
      decline: 'decline',
      working: '...'
    },
    shared: {
      title: 'shared with you',
      by: (owner) => `by: ${owner}`,
      leave: 'leave',
      leaveConfirm: 'sure?'
    },
    filter: {
      label: 'show:',
      all: 'all',
      collab: 'collab'
    },
    badge: 'collab',
    presence: {
      here: (peers) => peers.length === 1 ? `● ${peers[0].username}` : `● ${peers.length} here`
    },
    viewer: {
      sharedBy: (owner) => `shared by ${owner}`,
      back: '← back',
      loading: 'loading...',
      live: 'live',
      accessRemoved: 'your access was removed',
      view: (mode) => `view: ${mode === 'wysiwyg' ? 'rich' : 'plain'}`
    },
    errors: {
      locked: 'unlock your slates first'
    }
  },

  // auth modal
  auth: {
    oauthContinue: {
      toApp: (app) => `to continue to ${app}`,
      generic: 'sign in to continue'
    },
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
      resendCountdown: (seconds) => `resend code (${seconds}s)`,
      skip: 'skip for now' // this should be deprecated. -alfa
    },
    forgotPassword: {
      title: 'forgot password',
      email: 'email address',
      description: 'we\'ll send you a 6-digit reset code.',
      submit: 'send reset code',
      back: 'back to login',
      cancel: 'cancel',
    },
    resetPassword: {
      title: 'reset password',
      code: 'verification code',
      codePlaceholder: 'check your email for the code',
      newPassword: 'new password',
      newPasswordPlaceholder: 'at least 6 characters',
      errors: {
        invalidOrUsedCode: 'invalid or used reset code. send a new one and try again.',
        codeExpired: 'reset code expired. send a new one and try again.',
        recoveryRequired: 'recovery key is required',
        newPasswordRequired: 'new password is required',
        invalidRecovery: 'invalid recovery key. please check and try again.',
        recoveryDataFailed: 'failed to load recovery data. please try again.',
        resetFailed: 'failed to reset password',
      },
      otpStep: {
        title: 'enter verification code',
        description: 'check your email for the 6-digit code. use the most recent one.',
        submit: 'continue',
        sendNewCode: 'send a new reset code',
      },
      recoveryEntry: {
        title: 'enter your recovery key',
        placeholder: 'enter your 12-word recovery key...',
        submit: 'submit recovery codes',
        noKey: 'i don\'t have recovery codes',
      },
      withRecovery: {
        title: 'set new password',
        description: 'your slates will be preserved.',
        submit: 'reset password',
      },
      destructive: {
        title: 'reset password',
        warning: 'without your recovery key, all your encrypted slates will be permanently deleted.',
        checkbox: 'i know all my slates will be gone',
        submit: 'reset password and delete all slates',
        back: 'back',
      },
      success: 'password reset successfully!',
      slatesPreserved: 'your slates are preserved.',
      slatesDeleted: (count) => `${count} slate${count !== 1 ? 's' : ''} deleted.`,
    },
    turnstile: {
      unavailable: 'verification unavailable. please refresh and try again.',
      tryAgain: 'verification in progress. please try again in a moment. if this persists, disable ad blockers / strict tracking and refresh.',
    },
    recoveryKey: {
      title: 'your recovery key',
      description: 'this is your recovery key. it is the only way to recover your slates if you forget your password. save it somewhere safe.',
      warning: 'this will not be shown again.',
      download: 'download recovery key',
      copied: 'copied to clipboard',
      copy: 'copy to clipboard',
      acknowledge: 'i pinky promise i saved this somewhere safe',
      regenerate: {
        title: 'regenerate recovery key',
        description: 'this will generate a new recovery key and invalidate the old one.',
        submit: 'regenerate',
        passwordRequired: 'enter your password to regenerate your recovery key',
      },
    },
  },

  // 6-digit PIN for Google users
  pin: {
    googleReauth: {
      title: 'finish setting up encryption',
      message: 'your slates are not yet end-to-end encrypted. sign in with google once more to finish setup. you\'ll pick a pin right after.',
      button: 'sign in with google',
      later: 'later'
    },
    setup: {
      title: 'set a 6-digit pin',
      description: 'this pin protects your encrypted slates. you\'ll need it to access your slates on new devices or after clearing your browser data.',
      confirmLabel: 'enter it again',
      submit: 'set pin',
      saving: 'saving...',
      back: 'back',
    },
    unlock: {
      title: 'enter your pin',
      description: 'enter your 6-digit pin to unlock your slates.',
      submit: 'unlock',
      unlocking: 'unlocking...',
      forgotPin: 'forgot pin?',
    },
    recovery: {
      title: 'recover with recovery key',
      description: 'enter your 12-word recovery key to unlock your slates and set a new pin.',
      placeholder: 'enter your 12-word recovery key...',
      submit: 'recover',
      recovering: 'recovering...',
      newPinTitle: 'set a new pin',
      newPinDescription: 'choose a new 6-digit pin to protect your slates.',
      noKey: 'i don\'t have my recovery key',
      noKeyWarning: 'without your recovery key, your encrypted slates cannot be recovered. you can reset your account from the login page.',
      errors: {
        required: 'please enter your recovery key.',
        invalid: 'invalid recovery key. please check and try again.',
        failed: 'recovery failed. please try again.',
      },
    },
    errors: {
      required: 'enter all 6 digits',
      mismatch: 'pins don\'t match, try again',
      failed: 'incorrect pin',
    },
  },

  // account settings
  account: {
    title: 'account settings',
    devPortal: 'developer portal',
    sections: {
      account: 'account',
      security: 'security',
      connections: 'connections',
      danger: 'danger zone'
    },
    info: {
      title: 'account info',
      username: 'username:',
      email: 'email:',
      verified: 'verified',
      notVerified: 'not verified', // should be deprecared as well -alfa
      change: 'change'
    },
    usernameChange: {
      title: 'change username',
      placeholder: 'new username',
      submit: 'change username',
      submitting: 'changing...',
      success: 'username changed!',
      cooldown: (date) => `you can change your username again on ${date}`,
      errors: {
        taken: 'username already taken',
        invalid: 'username can only contain lowercase letters, numbers, dots, hyphens, and underscores',
        tooShort: 'username must be between 3 and 20 characters',
        cooldown: 'you can only change your username once every 90 days',
        failed: 'failed to change username'
      }
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
      success: 'password changed successfully',
      recoveryKeyRegenerated: 'your recovery key has been regenerated. your previous recovery key no longer works.'
    },
    connectedApps: {
      title: 'connected apps',
      loading: 'loading...',
      empty: 'no third-party apps have access to your account.',
      description: 'apps you authorized to sign in with justtype. private slates stay encrypted unless you explicitly share specific ones below, and you can stop sharing anytime.',
      canAccess: 'can access',
      revoke: 'revoke',
      revoking: 'revoking...',
      shareSlates: 'manage slate access',
      sharedCount: (n) => `${n} slate${n === 1 ? '' : 's'} shared`,
      sharesAll: 'full access: all private slates',
      deviceCount: (n) => `${n} connected installation${n === 1 ? '' : 's'}`,
      noDeviceYet: 'no installation connected yet. sharing applies once the app connects one.'
    },
    shareSlates: {
      title: 'private slate access',
      subtitle: (app) => `control which private slates ${app} can read and write. everything is re-encrypted in your browser and locked to this app's key. your password and master key never leave your device.`,
      loading: 'loading your slates...',
      locked: 'unlock your account (enter your password/pin) before sharing, so your slates can be decrypted in this browser.',
      loadError: 'could not load sharing info.',
      none: 'you have no private slates to share. published slates are already readable via the public scope.',
      untitled: 'untitled',
      share: 'share',
      shared: 'shared',
      working: '...',
      toggleError: 'could not update sharing. try again.',
      note: 'revocable anytime',
      workingNote: 'sharing… please wait',
      done: 'done',
      allTitle: 'allow all private slates',
      allDesc: 'this app can read and write every private slate, including ones you create later. edits it makes sync back to you. you can turn this off anytime.',
      allOn: 'on',
      allOff: 'off',
      sharingAll: (done, total) => `sharing… ${done}/${total}`,
      unsharingAll: 'turning off…',
      advanced: 'or share specific slates only',
      advancedHint: 'pick individual slates instead of granting full access.',
      noDevices: (app) => `${app} hasn't connected an installation yet. you can turn on access now. your slates will sync to it automatically the moment it connects.`
    },
    authorizeShare: {
      sharing: (app) => `sharing your private slates with ${app}`,
      finishing: (app) => `finishing up with ${app}`,
      preparing: 'preparing your slates…',
      progress: (done, total) => `encrypting and sharing… ${done}/${total}`,
      finishingNote: 'almost there, sending you back to the app.',
      lockedNote: (app) => `${app} will get access to your slates the next time you open justtype unlocked. sending you back now.`,
      dontClose: 'this only takes a moment. please don\'t close this tab.',
      errorTitle: 'something went wrong',
      missing: 'this authorization link is incomplete. please start again from the app.',
      finalizeError: 'could not finish authorizing. please start again from the app.'
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
      logoutConfirm: {
        title: 'sign out?',
        message: 'are you sure you want to sign out?',
        pinWarning: "you'll need to enter your pin next time to unlock your slates.",
        confirm: 'sign out',
        cancel: 'cancel'
      },
      errors: {
        logoutAllFailed: 'failed to logout from all sessions',
        logoutSessionFailed: 'failed to logout session'
      }
    },
    export: {
      button: 'export all slates',
      confirm: 'click again to confirm',
      exporting: 'exporting...',
      progress: (current, total) => `exporting ${current}/${total}...`,
      preparing: 'preparing download...',
      done: (count) => `export ready (${count} ${count === 1 ? 'slate' : 'slates'}). your download should start automatically.`,
      noSlates: 'no slates to export',
      cooldown: (time) => `export is limited to once per day. try again in ${time}.`,
      errors: {
        unlockRequired: 'please unlock your slates first, then try again.',
        failed: 'failed to export slates. please try again.'
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
      setPassword: {
        button: '+ set password',
        banner: 'add a password so you don\'t lose access to your slates if you lose your google account.',
        dismiss: 'dismiss',
        modal: {
          pinTitle: 'verify your pin',
          pinMessage: 'enter your 6-digit pin to continue.',
          pinVerify: 'verify',
          pinVerifying: 'verifying...',
          title: 'set password',
          message: 'create a password to sign in without google. you\'ll still be able to use google sign-in.',
          passwordPlaceholder: 'enter password',
          confirmPlaceholder: 'confirm password',
          submit: 'set password',
          submitting: 'setting password...',
          cancel: 'cancel'
        },
        success: {
          subtitle: 'password set! you can now sign in with either your password or google account. your previous recovery key has been replaced by this one.',
        },
        errors: {
          tooShort: 'password must be at least 6 characters.',
          mismatch: 'passwords do not match.',
          failed: 'failed to set password.',
          noKey: 'slate key not found. please log out and log back in first.',
          pinRequired: 'please enter your 6-digit pin.',
          wrongPin: 'incorrect pin. please try again.'
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
    copied: 'copied!',
    viewMode: (mode) => `view: ${mode}`
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
    placeholder: 'anything at all. bugs, ideas, or just say hi...',
    hint: 'goes straight to alfaoz. no ticket queue, no bot.',
    words: (n) => `${n} ${n === 1 ? 'word' : 'words'}`,
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
    pinFailed: 'Failed to update pin status',
    tagsSaveFailed: 'Failed to save tags',
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

  // build verification
  verify: {
    title: 'verify build integrity',
    description: 'every page load is verified before it runs. independent checks live off justtype\'s servers.',
    loaderVerified: (v, n) => `this page load was verified: the browser checked the signature on the v${v} manifest against the pinned release key, then pinned all ${n} files with subresource integrity before running anything.`,
    loaderBeta: (v, n) => `beta build v${v}: all ${n} files pinned against the server manifest. releases on justtype.io are additionally signature-verified.`,
    loaderDev: 'dev build: the verified loader only runs on built releases.',
    whyExternal: 'a page served by justtype.io cannot prove justtype.io is honest, so the independent checks do not live here. they run on github pages, built by github actions from the public repository, on infrastructure justtype\'s servers cannot touch: every served file is re-hashed and compared against an independent build of the source, and a scheduled monitor repeats this every 15 minutes and raises a public alert on any mismatch.',
    keyNote: 'releases are signed on the developer\'s machine. the server never holds the key, so a compromised server cannot ship modified code that this browser would accept.',
    openVerifier: 'open the independent verifier',
    verifierUrl: 'https://alfaoz.github.io/justtype/',
    releasesLog: 'releases log',
    releasesLogUrl: 'https://alfaoz.github.io/justtype/releases.json',
    githubSource: 'view source on github',
    badge: {
      signed: 'verified, signed release',
      beta: 'beta build, manifest pinned',
      version: 'version',
      files: 'files',
      filesPinned: (n) => `${n} pinned`,
      dev: 'dev build, loader inactive',
    },
    authFooter: (v) => `v${v}`,
    authFooterVerify: 'verify',
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
  },

  status: {
    title: 'system status',
    description: 'real-time status of justtype services.',
    allOperational: 'all systems operational',
    degraded: 'degraded performance',
    outage: 'service disruption',
    activeIncidents: 'active incidents',
    pastIncidents: 'past incidents',
    noIncidents: 'no incidents reported',
    severity: { minor: 'minor', major: 'major', critical: 'critical' },
    statuses: { investigating: 'investigating', identified: 'identified', monitoring: 'monitoring', resolved: 'resolved' },
    lastUpdated: 'last updated',
    footer: {
      home: 'just type',
      github: 'github'
    }
  },

  dev: {
    title: 'justtype developer',
    subtitle: 'build with the justtype api',
    copy: 'copy',
    copied: 'copied!',
    loading: 'loading...',
    gate: {
      message: 'sign in with your justtype account to register apps and get your keys.',
      login: 'log in with justtype'
    },
    tabs: { docs: 'docs', apps: 'your apps', wizard: 'wizard' },
    scopes: {
      identity: 'confirm who they are (username)',
      email: 'their verified email address',
      public: 'read their published slates (title + text)',
      meta: 'list slates, counts, dates (private titles stay encrypted)',
      private: 'read private slates the user explicitly shares with your app (revocable per-slate)',
      write: 'create and edit published slates on the user\'s behalf',
      create: 'drop new private (encrypted) slates into the user\'s account. they appear next time the user opens justtype',
      delete: 'delete slates on the user\'s behalf',
      publish: 'publish and unpublish slates on the user\'s behalf'
    },
    docs: {
      onThisPage: 'on this page',
      specCallout: 'prefer plain text, or pointing an ai/tool at the docs? the full reference + crypto contract is served as markdown at',
      specUrl: '/dev/spec.md',
      what: {
        title: 'introduction',
        body: 'justtype provides a standard oauth 2.0 authorization-code flow with PKCE, the same pattern as "sign in with google". register an app, send users to justtype to approve, and get a scoped token to confirm their identity and read their content. this page is the full reference; the wizard generates ready-to-paste code.'
      },
      quickstart: {
        title: 'quickstart',
        body: 'a working "sign in with justtype" takes five steps. below is the server-side (node) shape. the wizard fills in your real client_id, redirect, and scopes for node, browser, python, or curl.'
      },
      encryption: {
        title: 'encryption',
        body: 'justtype is end-to-end encrypted. your app can verify identity, read published slates, and list metadata. private writing stays encrypted (the server never sees plaintext or keys) unless the user explicitly delegates specific slates to your app (see private slates). even then, justtype never hands out a password or master key; it only stores blobs it cannot read.'
      },
      delegation: {
        title: 'private slates',
        body: 'with the slates:read:private scope, a user can grant your app access to their private slates: all of them (current + future) with one switch, or specific ones. it works by per-installation key delegation: each install of your app registers its own public key, and in the user\'s browser each shared slate is re-encrypted under a fresh content key wrapped to that install\'s key. justtype only stores the wrapped blobs. it still cannot read them, and one install\'s key can never decrypt another\'s. you decrypt with the install\'s private key.',
        steps: [
          'request the slates:read:private scope in your oauth flow as usual; the user approves.',
          'register THIS install\'s public key. easiest: pass device_public_key on /oauth/authorize so it registers during consent (reads work instantly, and "allow full access" wraps the library before redirect). or POST /api/oauth/devices { public_key } after the token exchange. the private key never leaves the device; private reads return 409 needs_device until one is registered.',
          'the user opens their justtype account → connected apps → manage slate access, and flips on "allow all private slates" (or picks specific ones); their client wraps the library to your install\'s key on its next sync.',
          'GET /api/oauth/slates/:n returns { wrapped_key, enc_content, enc_title } for slates wrapped to this install (delegated: true); ones shared but not yet wrapped to you show pending_device: true.',
          'unwrap the content key with this install\'s private key, then aes-256-gcm decrypt the content and title.'
        ],
        note: 'access is revocable anytime: the user (or revoking your app) deletes the blobs and future reads stop. while a slate stays shared, the user\'s own edits re-sync to you automatically.',
        writeTitle: 'writing back (two-way)',
        write: 'with a shared slate you can also write. re-encrypt under the SAME content key you unwrapped (do not generate a new one), then PATCH /api/oauth/slates/:n/delegated with the new enc_content (and optional enc_title). the next time the user opens that slate in justtype, your edit is decrypted with their master key and merged into their canonical copy. tip: GET the slate again right before writing so you have the current key (the user\'s own edits rotate it).',
        dropTitle: 'creating new private slates (the drop box)',
        drop: 'with the slates:create scope your app can add brand-new encrypted slates to a user without ever holding their master key. it is the mirror image of delegation: each user publishes their own public key, and you wrap a fresh content key to THAT (not to your app key). the user\'s client decrypts the drop on next unlock and adopts it as a normal private slate. neither justtype nor your server sees the plaintext.',
        dropPoints: [
          'request slates:create; fetch the user\'s public key (GET /api/oauth/users/me/public-key). if it is null they have no keypair yet. retry after they next open justtype.',
          'encrypt content + title under a fresh 32-byte content key (same blob format as everything else), wrap that key to the user\'s public key, and POST /api/oauth/slates/drop.',
          'timing: appears in ~1s if justtype is open (live sse), otherwise the next time the user opens justtype. there are no notifications, drops surface silently in their slate list. only their device can decrypt it, so it is never instant when no tab is open, so tell users "shows up next time you open justtype".',
          'track delivery with GET /api/oauth/dropbox: it returns keypair_ready plus pending/delivered counts for your app, so you can show "2 notes waiting" or "all synced" instead of guessing.',
          'the note is tagged "from <your app>" in the user\'s list (with a filter-by-app control). once adopted it is re-encrypted to their master key and is theirs permanently. it stays even if they remove your app, and an un-adopted drop survives revocation too.'
        ]
      },
      scopes: {
        title: 'scopes',
        recommendedTitle: 'recommended: a full justtype integration',
        recommendedBody: 'building a real justtype client, one that handles a user\'s writing the way justtype does? request this bundle. it is end-to-end encrypted by default (read private + create), with full lifecycle control (delete, publish). the user approves it on one consent screen, which also offers a one-tap "allow full access to all my private slates" toggle.',
        recommendedBundle: 'identity slates:read:meta slates:read:private slates:create slates:delete slates:publish',
        recommendedNote: 'add slates:write only if you also need to create/edit plaintext published slates directly. an e2e-first client doesn\'t need it.'
      },
      flow: {
        title: 'the flow',
        steps: [
          'register an app here → get a client_id',
          'make a PKCE verifier + S256 challenge',
          'redirect the user to /oauth/authorize with the challenge',
          'they approve on a justtype consent screen → you get a one-time ?code=',
          'POST the code + verifier to /oauth/token → access token (use as Bearer)'
        ]
      },
      endpoints: {
        title: 'endpoints',
        list: [
          ['GET',   '/oauth/authorize',               'start the flow (browser redirect)'],
          ['POST',  '/oauth/token',                   'exchange code, or refresh (rotates both tokens)'],
          ['POST',  '/oauth/revoke',                  'revoke an access or refresh token'],
          ['GET',   '/api/oauth/userinfo',            'scope: identity → { id, username, email?, public_key? }'],
          ['GET',   '/api/oauth/users/me/public-key', 'scope: slates:create → the user\'s public key to wrap a drop to'],
          ['POST',  '/api/oauth/slates/drop',         'scope: slates:create → drop a new private (encrypted) slate for the user'],
          ['POST',  '/api/oauth/slates/create-delegated', 'scope: slates:create + slates:read:private → create a NEW private slate already editable by your app'],
          ['GET',   '/api/oauth/dropbox',             'scope: slates:create → drop-box sync status (keypair readiness, pending/delivered counts)'],
          ['GET',   '/api/oauth/drops',               'scope: slates:create → your drops + status (?status=pending|adopted|discarded)'],
          ['GET',   '/api/oauth/drops/:id',           'scope: slates:create → one drop\'s status + resulting slate_number'],
          ['GET',   '/api/oauth/slates',              'scope: slates:read:meta → slate list + counts'],
          ['GET',   '/api/oauth/sync',                'scope: slates:read:meta → incremental sync (?since= cursor) with delete tombstones'],
          ['GET',   '/api/oauth/slates/published',    'scope: slates:read:public → full published text'],
          ['GET',   '/api/oauth/slates/:n',           'scope: slates:read:private → published→plaintext, delegated→decryptable, else ciphertext'],
          ['POST',  '/api/oauth/slates/batch',        'scope: slates:read:private → read many slates at once ({ slate_numbers })'],
          ['GET',   '/api/oauth/shared',              'scope: slates:read:private → slates delegated to your app (+ wrapped_key, enc_title)'],
          ['POST',  '/api/oauth/slates',              'scope: slates:write → create a slate (published by default)'],
          ['PUT',   '/api/oauth/slates/:n',           'scope: slates:write → update title/content of a plaintext slate'],
          ['PATCH', '/api/oauth/slates/:n/delegated', 'scope: slates:read:private → update a delegated private slate (re-encrypted)'],
          ['PATCH', '/api/oauth/slates/:n/publish',   'scope: slates:publish → publish or unpublish a slate'],
          ['DELETE','/api/oauth/slates/:n',           'scope: slates:delete → delete any slate'],
          ['GET',   '/api/oauth/scopes',              'the scope catalogue (no auth)']
        ]
      },
      responses: {
        title: 'response shapes',
        body: 'exact JSON each endpoint returns, with real field names. all timestamps are ISO8601 (…Z); all ids are integers; every error is JSON { error, error_description }.',
        items: [
          ['POST /oauth/token', '{ access_token, token_type: "Bearer", expires_in, refresh_token, scope }'],
          ['GET /api/oauth/userinfo', '{ id, username, email?, email_verified?,\n  public_key? }   // public_key only with slates:create'],
          ['POST /api/oauth/slates/drop', 'req:  { wrapped_key, enc_content, enc_title? }\nok:   { success: true, drop_id, status: "pending_adoption" }   // drop_id is an integer\n409:  { error: "keypair_unavailable" }   // retry later'],
          ['POST /api/oauth/slates/create-delegated', 'req:  { wrapped_key_user, wrapped_key_app, enc_content, enc_title?,\n        word_count?, char_count? }   // one content key, wrapped to BOTH keys\nok:   { success: true, slate_number, drop_id, status: "pending_adoption" }\n      // editable NOW via GET/PATCH /api/oauth/slates/:n; user re-keys on next open'],
          ['GET /api/oauth/dropbox', '{ keypair_ready, public_key?, key_scheme,\n  pending, delivered, last_drop_at, last_delivered_at,\n  synced }   // last_* are ISO8601 or null'],
          ['GET /api/oauth/drops[/:id]', '{ drop_id, status: "pending"|"adopted"|"discarded",\n  slate_number|null, created_at, adopted_at, discarded_at }\n  // slate_number is set once the user adopts; list form returns an array'],
          ['GET /api/oauth/slates', '[ { slate_number, is_published, share_id, title|null,\n    title_encrypted, word_count, char_count,\n    created_at, updated_at, published_at } ]'],
          ['GET /api/oauth/sync?since=<ISO>', '{ changed: [ <meta rows, as /slates> ],\n  deleted: [ { slate_number, deleted_at } ],\n  cursor, has_more }   // omit since for a full baseline; page while has_more'],
          ['GET /api/oauth/slates/:n  (published)', '{ slate_number, delegated: false, published: true,\n  title, content }   // plaintext, published slates are public'],
          ['GET /api/oauth/slates/:n  (delegated)', '{ slate_number, delegated: true,\n  key_scheme: "rsa-oaep-sha256", content_scheme: "aes-256-gcm",\n  wrapped_key, enc_content, enc_title, shared_at }'],
          ['GET /api/oauth/slates/:n  (private, not shared)', '{ slate_number, delegated: false, encrypted: true,\n  encrypted_content, note }'],
          ['POST /api/oauth/slates/batch', 'req:  { slate_numbers: [..] }   // max 100\nok:   { slates: [ <same shape as GET /slates/:n> ], missing: [..] }'],
          ['GET /api/oauth/shared', '[ { slate_number, shared_at, key_scheme, content_scheme,\n    wrapped_key, enc_title, word_count, char_count,\n    created_at, updated_at } ]   // titles without N fetches'],
          ['PATCH /api/oauth/slates/:n/delegated', '{ success: true }'],
          ['POST /oauth/revoke', '{ success: true }   // body { token }, JSON or form; always 200']
        ]
      },
      gotchas: {
        title: 'gotchas: read these',
        points: [
          'the delegated write (PATCH /api/oauth/slates/:n/delegated) is authorized by slates:read:private, NOT slates:write. slates:write is only for plaintext/published slates. requesting slates:write and PATCHing delegated returns 403.',
          'slates:write only creates/edits plaintext (server-readable) slates, even with publish:false. to create a NEW end-to-end-encrypted slate use slates:create + POST /api/oauth/slates/drop (the drop box). there is no way to author E2E content through slates:write.',
          'a drop returns 409 keypair_unavailable until the user has opened justtype at least once after this feature shipped (that is when their keypair is generated). handle it by retrying later, not as a hard failure.',
          'the blob IV is 16 bytes, not the usual 12. layout is IV(16) + authTag(16) + ciphertext, base64. a hardcoded 12-byte IV produces blobs justtype cannot read.',
          'RSA unwrap MUST set oaepHash: "sha256". node defaults OAEP to sha-1, which fails with a garbage key and an opaque error.',
          'content decrypts to JSON { content, uploadedAt }; title decrypts to a raw string. uploadedAt is informational: set it to an ISO timestamp when you write; it is not authoritative.',
          'a stale content key is expected, not a bug: the user\'s own edits rotate the per-slate key, so a cached key fails with a GCM auth error ("unable to authenticate data"). always GET the slate again right before writing.',
          'there is no shared app key. each INSTALL generates its own RSA keypair and registers the public half via POST /api/oauth/devices after authorizing (the private key never leaves the device). private reads/writes return 409 needs_device until you do. never embed a private key in a distributed build.',
          'slates:read:private is the full-read scope: it also covers published slates (which are public anyway), so GET /api/oauth/slates/:n returns plaintext for a published slate and you do not need slates:read:public as well. it does NOT include the slate list (slates:read:meta), so request that separately if you need to enumerate.'
        ]
      },
      errors: {
        title: 'errors',
        points: [
          '400 invalid_request / invalid_grant: bad or expired code, PKCE mismatch, or missing parameters.',
          '401 invalid_client: wrong client_id/secret. 401 invalid_token: missing, expired, or revoked bearer token.',
          '403 insufficient_scope: your token lacks the scope the endpoint needs (error_description names it).',
          '403 on a delegated slate: the user has not shared that slate with your app yet.',
          '413: content over 5 MB, or a grant blob over 8 MB per field.',
          '429 rate_limited: too many requests. honour the Retry-After header (seconds) and back off. the body is JSON, like every other error.',
          'every error is JSON { error, error_description }, never HTML, even for 404s, malformed bodies, rate limits, or upstream 5xx. safe to JSON.parse unconditionally.',
          'GCM "unable to authenticate data" on decrypt: almost always a stale rotated key (re-GET), or a wrong oaepHash / IV length. not a server error.'
        ]
      },
      tokens: {
        title: 'tokens',
        points: [
          'access token: scoped JWT, 1 hour. only works on /api/oauth/*, never as a justtype login.',
          'refresh token: opaque, 90 days, single-use (rotates on every refresh).',
          'authorization code: single-use, expires in 60 seconds.',
          'always verify state. always use S256 PKCE. https only. users can revoke you from their account.'
        ]
      },
      wizardHint: 'tip: the wizard tab fills all of this in with your real client_id and gives you copy-paste code.'
    },
    apps: {
      empty: 'no apps yet. register one to get a client_id.',
      createButton: '+ register an app',
      openWizard: 'open the wizard',
      nameLabel: 'app name',
      namePlaceholder: 'my cool app',
      websiteLabel: 'website',
      websitePlaceholder: 'https://yourapp.com',
      optional: 'optional',
      redirectsFieldLabel: 'redirect uris',
      redirectsHint: 'one per line',
      redirectsPlaceholder: 'https://yourapp.com/callback',
      scopesLabel: 'scopes',
      redirectsLabel: 'redirects',
      create: 'create app',
      creating: 'creating...',
      cancel: 'cancel',
      delete: 'delete',
      deleting: 'deleting...',
      copyHint: 'click to copy client id',
      secretTitle: 'save your client secret',
      secretBody: 'this is shown once and cannot be retrieved later. store it somewhere safe.',
      secretDismiss: 'done, i saved it',
      ownedHeading: 'your apps',
      sharedHeading: 'shared with you',
      edit: 'edit',
      editTitle: 'edit app',
      save: 'save changes',
      saving: 'saving...',
      manageAccess: 'manage access',
      clientIdLabel: 'client id',
      ownerBadge: 'owner',
      editorBadge: 'editor',
      viewerBadge: 'viewer',
      sharedBy: (u) => `shared by @${u}`,
      viewOnlyNote: 'you have view-only access. only the owner or an editor can change settings.',
      deleteModal: {
        title: 'delete app?',
        message: (name) => `"${name}" will be permanently removed. every token, shared slate grant, and collaborator for this app stops working immediately. this cannot be undone.`,
        confirm: 'delete app',
        deleting: 'deleting...',
        cancel: 'cancel'
      },
      access: {
        title: 'manage access',
        subtitle: (name) => `who can manage and use ${name}.`,
        membersHeading: 'team',
        you: 'you',
        ownerRole: 'owner',
        roleEditor: 'editor',
        roleViewer: 'viewer',
        roleEditorDesc: 'can edit settings & view credentials',
        roleViewerDesc: 'can view credentials & use the wizard',
        remove: 'remove',
        removing: '...',
        leave: 'leave',
        empty: 'no collaborators yet. share an invite link to bring teammates on board.',
        ownerOnly: 'only the owner can manage the team.',
        close: 'close',
        loadFailed: 'could not load collaborators.',
        // invite links
        inviteHeading: 'invite link',
        inviteBody: 'anyone with a justtype account can open this link and join as a collaborator.',
        inviteRoleLabel: 'they join as',
        createLink: 'create invite link',
        creatingLink: 'creating...',
        copyLink: 'copy link',
        copiedLink: 'copied!',
        revokeLink: 'revoke',
        revoking: '...',
        activeLinks: 'active links',
        linkRole: (role) => `joins as ${role}`,
        noLinks: 'no invite links yet.'
      }
    },
    join: {
      title: 'join app',
      heading: (app) => `join ${app}`,
      body: (owner, role) => `@${owner} invited you to collaborate on this app as ${role}. you'll be able to manage and use it from your developer portal.`,
      roleNote: { editor: 'as an editor you can view credentials and change the app\'s settings.', viewer: 'as a viewer you can view credentials and use the wizard.' },
      accept: 'join app',
      accepting: 'joining...',
      decline: 'not now',
      alreadyMember: 'you\'re already a collaborator on this app.',
      isOwner: 'this is your own app, you already have full access.',
      invalid: 'this invite link is invalid or has expired.',
      gate: 'log in to your justtype account to accept this invitation.',
      success: (app) => `you've joined ${app}.`
    },
    errors: {
      nameRequired: 'app name is required.',
      redirectRequired: 'at least one redirect uri is required.',
      scopeRequired: 'select at least one scope.',
      createFailed: 'could not create app. redirect uris must be https, http://localhost, or a native scheme (com.example.app://callback).'
    },
    wizard: {
      back: '← back',
      intro: 'answer two quick questions and get copy-paste code wired to your real app.',
      stepLabels: ['app', 'stack', 'code'],
      step1: {
        title: 'step 1: pick an app',
        body: 'choose which of your apps this integration is for.',
        noApps: 'you have no apps yet.',
        goCreate: 'register one first →'
      },
      step2: {
        title: 'step 2: pick your stack',
        body: 'we tailor the snippet to your language and runtime.'
      },
      step3: {
        title: 'step 3: your code',
        appLabel: 'app',
        body: 'this is the full login flow, filled in with your client. drop it into your app and you have "sign in with justtype" working.',
        note: 'public clients use PKCE and need no secret. keep tokens server-side where you can; for SPAs, hold them in memory.'
      }
    }
  },
  // One-time announcement card for users arriving on v4 for the first time.
  whatsNewModal: {
    version: 'v4',
    title: 'markdown and collab are here',
    body: 'justtype just picked up the two things people asked for most.',
    points: [
      'write markdown and watch it format itself as you type',
      'turn any slate collaborative and write together, live',
      'still end to end encrypted, still just typing'
    ],
    tour: 'take the tour',
    dismiss: 'hell yeah!'
  },

  whatsNew: {
    pageTitle: "what's new",
    versionTag: 'v4',
    heroEyebrow: 'v4 is here.',
    heroTitle: 'write together. write it better.',
    heroSub: 'markdown formatting whenever you want it, and real time collaboration on any slate. still end to end encrypted, still just typing.',
    demo: {
      lineA: 'ideas flow better',
      lineB: "when they're together",
      userA: 'alfa',
      userB: 'beta'
    },
    demos: {
      history: {
        rows: ['14:02 · by alfa', '13:41 · by beta', '13:12 · by alfa'],
        previews: ['draft three, final', 'draft two, tighter', 'draft one, rough']
      },
      unpublish: { url: 'justtype.io/s/9f2ka1', after: 'fully private again' },
      markdown: { srcHeading: '## notes for friday', srcLine: '**bold**, *italic*, `code`', outHeading: 'notes for friday' },
      // The slate list: copies land on their own; `written` is the row that
      // gets edited while offline and syncs back
      offline: { slates: ['morning pages', 'letter to june', 'reading notes', 'packing list'], written: 1 }
    },
    features: [
      {
        id: 'markdown',
        title: 'rich formatting with markdown',
        body: 'we all know it, we all love it. write markdown and watch it format itself as you type, or keep every slate plain. it is a per slate setting, so nothing changes until you ask for it.'
      },
      {
        id: 'collab',
        title: 'collab slates',
        body: 'turn any slate collaborative and write in the same document at the same time, while remaining fully end-to-end encrypted.'
      },
      {
        id: 'history',
        title: 'version history',
        body: 'step back through earlier checkpoints of a collab slate, preview them, restore the one you want.'
      },
      {
        id: 'unpublish',
        title: 'unpublish, completely',
        body: "take a published slate all the way back. long overdue, but it's here!"
      },
      {
        id: 'brand',
        title: 'a new justtype',
        body: 'a new default identity, a new default font, a polished design, a new justtype.',
        notePhrase: 'a new default font',
        note: 'ibm plex mono'
      },
      {
        id: 'offline',
        title: 'offline slates',
        body: 'your slates are now kept on your device as well, not just on the server. lose your connection and keep writing; edits are saved locally and synced when you are back. automatic, and still end-to-end encrypted.'
      }
    ],
    backLink: 'back to writing'
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
