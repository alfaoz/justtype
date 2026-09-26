const B2 = require('backblaze-b2');
const crypto = require('crypto');
const b2Monitor = require('./b2Monitor');
const { handleB2Error } = require('./b2ErrorHandler');

// A call that hangs holds a save open until the operating system gives up on
// the socket, which can take minutes. Nothing B2 does for us takes this long.
const B2_TIMEOUT_MS = 30000;
// Upload URLs stay valid for a day and each takes one upload at a time, so a
// few are kept and reused: fetching one first cost every save a round trip,
// and each new URL meant a fresh TLS handshake with a different pod.
const UPLOAD_URL_POOL_MAX = 4;
// File names the delete call needs, remembered from our own uploads so a
// delete does not first ask B2 for the name
const FILE_NAME_MEMORY = 5000;
// A file B2 said is gone is not asked for again for a while: a client that
// keeps opening such a slate got a B2 round trip and an error every time
const NOT_FOUND_MEMORY_MS = 10 * 60 * 1000;

class B2Storage {
  constructor() {
    this.b2 = new B2({
      applicationKeyId: process.env.B2_APPLICATION_KEY_ID,
      applicationKey: process.env.B2_APPLICATION_KEY,
      axios: { timeout: B2_TIMEOUT_MS },
    });
    this.bucketId = process.env.B2_BUCKET_ID;
    // Optional file name prefix so multiple instances (e.g. beta) can share a bucket without mixing files
    this.prefix = process.env.B2_PREFIX || '';
    this.authorized = false;
    this.authExpiry = null; // Track when auth token expires
    this.authorizing = null;
    this.uploadUrls = [];
    this.fileNames = new Map();
    this.notFound = new Map();
  }

  rememberFileName(fileId, fileName) {
    if (!fileId || !fileName) return;
    this.fileNames.delete(fileId);
    this.fileNames.set(fileId, fileName);
    if (this.fileNames.size > FILE_NAME_MEMORY) this.fileNames.delete(this.fileNames.keys().next().value);
  }

  knownFileName(fileId) {
    return this.fileNames.get(fileId) || null;
  }

  // Throws the same not-found error B2 gave, without asking B2 again, for a
  // file it reported missing in the last few minutes
  checkNotFound(fileId, operation) {
    const at = this.notFound.get(fileId);
    if (!at) return;
    if (Date.now() - at > NOT_FOUND_MEMORY_MS) { this.notFound.delete(fileId); return; }
    throw handleB2Error({ response: { status: 404, data: { code: 'not_found', message: 'file not found' } }, message: 'file not found' }, operation);
  }

  noteNotFound(fileId, error) {
    if (error?.response?.status !== 404) return;
    this.notFound.set(fileId, Date.now());
    if (this.notFound.size > 1000) this.notFound.delete(this.notFound.keys().next().value);
  }

  // One upload URL for one upload: reused from the pool when there is one
  async takeUploadUrl() {
    const pooled = this.uploadUrls.pop();
    if (pooled) return pooled;
    const res = await this.b2.getUploadUrl({ bucketId: this.bucketId });
    return { uploadUrl: res.data.uploadUrl, authorizationToken: res.data.authorizationToken };
  }

  // Back into the pool after a clean upload. A URL that failed is dropped:
  // B2 asks for a new one after any error on it.
  returnUploadUrl(slot) {
    if (this.uploadUrls.length < UPLOAD_URL_POOL_MAX) this.uploadUrls.push(slot);
  }

  // Uploads one buffer, remembering the file name for the later delete
  async putFile(fileName, data, mime) {
    const slot = await this.takeUploadUrl();
    // On an error the slot is simply not returned to the pool
    const response = await this.b2.uploadFile({
      uploadUrl: slot.uploadUrl,
      uploadAuthToken: slot.authorizationToken,
      fileName,
      data,
      mime,
    });
    this.returnUploadUrl(slot);
    this.rememberFileName(response.data.fileId, fileName);
    return response;
  }

  // Encrypt content using AES-256-GCM (authenticated encryption)
  encrypt(content, encryptionKey) {
    try {
      // Generate a random IV (initialization vector) for each encryption
      const iv = crypto.randomBytes(16);

      // Create cipher with AES-256-GCM
      const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);

      // Encrypt the content
      const encrypted = Buffer.concat([
        cipher.update(content, 'utf8'),
        cipher.final()
      ]);

      // Get the authentication tag
      const authTag = cipher.getAuthTag();

      // Combine: IV (16 bytes) + Auth Tag (16 bytes) + Encrypted Data
      const combined = Buffer.concat([iv, authTag, encrypted]);

      return combined;
    } catch (error) {
      console.error('Encryption error:', error);
      throw new Error('Failed to encrypt content');
    }
  }

  // Decrypt content using AES-256-GCM
  decrypt(encryptedData, encryptionKey) {
    try {
      // Extract components: IV (16 bytes) + Auth Tag (16 bytes) + Encrypted Data
      const iv = encryptedData.slice(0, 16);
      const authTag = encryptedData.slice(16, 32);
      const encrypted = encryptedData.slice(32);

      // Create decipher
      const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, iv);
      decipher.setAuthTag(authTag);

      // Decrypt the content
      const decrypted = Buffer.concat([
        decipher.update(encrypted),
        decipher.final()
      ]);

      return decrypted.toString('utf8');
    } catch (error) {
      console.error('Decryption error:', error);
      throw new Error('Failed to decrypt content');
    }
  }

  /**
   * Does this error mean our cached auth token is no longer good?
   *
   * 401 always does. 403 usually does too (a rotated or revoked application
   * key answers with access_denied), and that case is what stranded the beta
   * instance: the retry paths below only looked for 401, so a 403 left the
   * dead token cached and every save failed until the process was restarted.
   * The exception is a cap: B2 also uses 403 to say a storage/transaction cap
   * was hit, and re-authorizing then would just double the load for nothing.
   */
  isStaleAuthError(error) {
    const status = error?.response?.status;
    if (status === 401) return true;
    if (status !== 403) return false;
    const code = error?.response?.data?.code || error?.message || '';
    return !/cap_exceeded/i.test(code);
  }

  // Drop the cached token so the next authorize() actually talks to B2.
  invalidateAuth() {
    this.authorized = false;
    this.authExpiry = null;
  }

  async authorize() {
    // Check if we need to re-authorize (not authorized or token expiring soon)
    const now = Date.now();
    const needsAuth = !this.authorized || !this.authExpiry || now > this.authExpiry - (60 * 60 * 1000); // Re-auth 1h before expiry

    if (!needsAuth) return;

    // Requests that arrive while the token is being renewed wait for that
    // one renewal instead of each starting their own
    if (this.authorizing) return this.authorizing;
    this.authorizing = (async () => {
      try {
        await this.b2.authorize();
        this.authorized = true;
        this.authExpiry = Date.now() + (23 * 60 * 60 * 1000); // B2 tokens last 24h, set to 23h to be safe
        console.log('✓ Backblaze B2 authorized (expires in 23 hours)');
      } catch (error) {
        console.error('✗ B2 authorization failed:', error.message);
        this.authorized = false;
        this.authExpiry = null;
        throw error;
      } finally {
        this.authorizing = null;
      }
    })();
    return this.authorizing;
  }

  async uploadSlate(slateId, content, encryptionKey = null) {
    await this.authorize();

    const fileName = `${this.prefix}slates/${slateId}.json`;
    const slateData = JSON.stringify({
      content,
      uploadedAt: new Date().toISOString(),
    });

    let dataToUpload;
    let mimeType;

    if (encryptionKey) {
      // Encrypt the data before uploading
      dataToUpload = this.encrypt(slateData, encryptionKey);
      mimeType = 'application/octet-stream'; // Binary encrypted data
    } else {
      // Upload unencrypted (legacy slates)
      dataToUpload = Buffer.from(slateData);
      mimeType = 'application/json';
    }

    try {
      const response = await this.uploadWithRetry(fileName, dataToUpload, mimeType);

      // Log Class C transaction (upload)
      b2Monitor.logClassC('uploadSlate', {
        slateId,
        encrypted: !!encryptionKey,
        sizeBytes: dataToUpload.length
      });

      return response.data.fileId;
    } catch (error) {
      b2Monitor.logError('uploadSlate', error);
      throw handleB2Error(error, 'uploadSlate');
    }
  }

  // Worth one more try on a fresh upload URL: a rejected token, a timeout or
  // a dropped connection, or B2 saying it is busy. B2's own guidance for an
  // upload that fails this way is to get a new URL and send it again.
  isRetryableUpload(error) {
    if (this.isStaleAuthError(error)) return true;
    const status = error?.response?.status;
    if (!status) return true;
    return status === 408 || status === 429 || status >= 500;
  }

  async uploadWithRetry(fileName, data, mime) {
    try {
      return await this.putFile(fileName, data, mime);
    } catch (error) {
      if (!this.isRetryableUpload(error)) throw error;
      if (this.isStaleAuthError(error)) {
        console.log('B2 auth rejected, forcing re-authorization...');
        this.invalidateAuth();
        this.uploadUrls = [];
        await this.authorize();
      }
      return this.putFile(fileName, data, mime);
    }
  }

  // Downloads one file by id, once more after a rejected token. A file B2
  // reported missing a moment ago is refused without asking again.
  async download(fileId, operation) {
    await this.authorize();
    this.checkNotFound(fileId, operation);
    const get = () => this.b2.downloadFileById({ fileId, responseType: 'arraybuffer' });
    try {
      let response;
      try {
        response = await get();
      } catch (error) {
        if (!this.isStaleAuthError(error)) throw error;
        console.log('B2 auth rejected, forcing re-authorization...');
        this.invalidateAuth();
        await this.authorize();
        response = await get();
      }
      return Buffer.from(response.data);
    } catch (error) {
      this.noteNotFound(fileId, error);
      b2Monitor.logError(operation, error);
      throw handleB2Error(error, operation);
    }
  }

  async getSlate(fileId, encryptionKey = null) {
    const downloadedData = await this.download(fileId, 'getSlate');

    // Log Class B transaction (download)
    b2Monitor.logClassB('getSlate', {
      fileId,
      encrypted: !!encryptionKey,
      bytes: downloadedData.length
    });

    let slateData;
    if (encryptionKey) {
      // Decrypt the data
      const decryptedJson = this.decrypt(downloadedData, encryptionKey);
      slateData = JSON.parse(decryptedJson);
    } else {
      // Parse unencrypted data (legacy slates)
      slateData = JSON.parse(downloadedData.toString());
    }

    return slateData.content;
  }

  // Download raw file bytes without decryption (for E2E users)
  async downloadRawFile(fileId) {
    const data = await this.download(fileId, 'downloadRawFile');
    b2Monitor.logClassB('downloadRawFile', { fileId, bytes: data.length });
    return data;
  }

  // Upload pre-encrypted blob to B2 (for E2E users)
  async uploadRawSlate(slateId, encryptedBuffer) {
    await this.authorize();
    const fileName = `${this.prefix}slates/${slateId}.enc`;

    try {
      const response = await this.uploadWithRetry(fileName, encryptedBuffer, 'application/octet-stream');
      b2Monitor.logClassC('uploadRawSlate', { slateId, bytes: encryptedBuffer.length });
      return response.data.fileId;
    } catch (error) {
      b2Monitor.logError('uploadRawSlate', error);
      throw handleB2Error(error, 'uploadRawSlate');
    }
  }

  // Deletes one file version. The name comes from the caller, from our own
  // upload, or (only when neither knows it) from asking B2.
  async deleteSlate(fileId, fileName = null) {
    await this.authorize();
    const remove = async () => {
      let name = fileName || this.knownFileName(fileId);
      if (!name) {
        const fileInfo = await this.b2.getFileInfo({ fileId });
        name = fileInfo.data.fileName;
      }
      await this.b2.deleteFileVersion({ fileId, fileName: name });
      this.fileNames.delete(fileId);
      b2Monitor.logClassC('deleteSlate', { fileId, fileName: name });
      return true;
    };

    try {
      try {
        return await remove();
      } catch (error) {
        if (!this.isStaleAuthError(error)) throw error;
        console.log('B2 auth rejected, forcing re-authorization...');
        this.invalidateAuth();
        await this.authorize();
        return await remove();
      }
    } catch (error) {
      b2Monitor.logError('deleteSlate', error);
      throw handleB2Error(error, 'deleteSlate');
    }
  }
}

module.exports = new B2Storage();
