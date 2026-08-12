'use strict';

/**
 * Service layer exports for authentication and future profile/progress services.
 */

module.exports = {
  passwords: require('./passwords'),
  tokens: require('./tokens'),
  sessions: require('./sessions'),
  users: require('./users'),
  profiles: require('./profiles'),
  progress: require('./progress'),
  progressValidation: require('./progressValidation'),
  googleOAuth: require('./googleOAuth')
};
