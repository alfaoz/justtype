// B2 Error Handler
// Provides user-friendly error messages for common B2 failures

class B2Error extends Error {
  constructor(message, code, userMessage) {
    super(message);
    this.name = 'B2Error';
    this.code = code;
    this.userMessage = userMessage;
  }
}

function handleB2Error(error, operation) {
  // B2 returns its machine-readable reason in the response body, e.g.
  // { code: 'cap_exceeded', message: '...', status: 403 }. axios never copies
  // that into error.message, so anything matching on error.message alone will
  // silently miss every one of these.
  const b2Code = error.response?.data?.code || '';
  const b2Message = error.response?.data?.message || error.message || '';

  // Check for rate limiting (429)
  if (error.response?.status === 429) {
    const resetTime = error.response?.headers?.['retry-after'] || 60;
    return new B2Error(
      `B2 rate limit exceeded during ${operation}`,
      'B2_RATE_LIMIT',
      `Our storage service is temporarily busy. Please try again in ${resetTime} seconds.`
    );
  }

  // Check for quota exceeded (specific B2 error)
  if (b2Code === 'cap_exceeded' || b2Code === 'storage_cap_exceeded' || b2Code === 'transaction_cap_exceeded'
      || b2Message.includes('storage_cap_exceeded') || b2Message.includes('transaction_cap_exceeded')) {
    return new B2Error(
      `B2 quota exceeded during ${operation}`,
      'B2_QUOTA_EXCEEDED',
      'We\'re experiencing high demand. Please try again later or contact support if this persists.'
    );
  }

  // A 403 whose body is access_denied is the storage provider refusing the
  // request on its own side (e.g. a cluster rejecting writes during an
  // incident), not our credentials going bad. Telling the user to "contact
  // support" for that is misleading — nothing they or we can do but retry.
  if (error.response?.status === 403 && b2Code === 'access_denied') {
    return new B2Error(
      `B2 refused ${operation}: ${b2Message}`,
      'B2_PROVIDER_ERROR',
      'Our storage provider is having trouble right now, so this could not be saved. Your text is still here in the tab. Please try again in a few minutes.'
    );
  }

  // Check for authentication errors (401/403)
  if (error.response?.status === 401 || error.response?.status === 403) {
    return new B2Error(
      `B2 authentication failed during ${operation}${b2Code ? ` (${b2Code})` : ''}`,
      'B2_AUTH_ERROR',
      'Storage authentication error. Please contact support.'
    );
  }

  // Check for network errors
  if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
    return new B2Error(
      `B2 network error during ${operation}: ${error.code}`,
      'B2_NETWORK_ERROR',
      'Unable to connect to storage service. Please check your connection and try again.'
    );
  }

  // Check for file not found (404)
  if (error.response?.status === 404) {
    return new B2Error(
      `B2 file not found during ${operation}`,
      'B2_NOT_FOUND',
      'The requested content could not be found. It may have been deleted.'
    );
  }

  // Check for service unavailable (503)
  if (error.response?.status === 503) {
    return new B2Error(
      `B2 service unavailable during ${operation}${b2Message ? `: ${b2Message}` : ''}`,
      'B2_SERVICE_UNAVAILABLE',
      'Storage service is temporarily unavailable. Please try again in a few moments.'
    );
  }

  // Generic error
  return new B2Error(
    `B2 error during ${operation}: ${b2Message || error.message}${b2Code ? ` (${b2Code})` : ''}`,
    'B2_UNKNOWN_ERROR',
    'An unexpected storage error occurred. Please try again or contact support if this persists.'
  );
}

module.exports = {
  B2Error,
  handleB2Error
};
