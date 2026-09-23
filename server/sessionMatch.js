// A session is found by the hash of its token. A session renews its token
// (authenticateToken in index.js); the token it replaced keeps answering for
// a short while, so requests already on their way with it are not logged out.
// Two parameters: the token hash, twice.
const SESSION_MATCH = "(token_hash = ? OR (prev_token_hash = ? AND rotated_at > datetime('now', '-2 minutes')))";

module.exports = { SESSION_MATCH };
