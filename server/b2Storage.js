const B2 = require('backblaze-b2');
const crypto = require('crypto');
const b2Monitor = require('./b2Monitor');
const { handleB2Error } = require('./b2ErrorHandler');

class B2Storage {
  constructor() {
    this.b2 = new B2({
      applicationKeyId: process.env.B2_APPLICATION_KEY_ID,
      applicationKey: process.env.B2_APPLICATION_KEY,
    });
    this.bucketId = process.env.B2_BUCKET_ID;
    this.authorized = false;
    this.authExpiry = null; // Track when auth token expires
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

  async authorize() {
    // Check if we need to re-authorize (not authorized or token expiring soon)
    const now = Date.now();
    const needsAuth = !this.authorized || !this.authExpiry || now > this.authExpiry - (60 * 60 * 1000); // Re-auth 1h before expiry

    if (!needsAuth) return;

    try {
      await this.b2.authorize();
      this.authorized = true;
      this.authExpiry = now + (23 * 60 * 60 * 1000); // B2 tokens last 24h, set to 23h to be safe
      console.log('✓ Backblaze B2 authorized (expires in 23 hours)');
    } catch (error) {
      console.error('✗ B2 authorization failed:', error.message);
      this.authorized = false;
      this.authExpiry = null;
      throw error;
    }
  }

  async uploadSlate(slateId, content, encryptionKey = null) {
    await this.authorize();

    const fileName = `slates/${slateId}.json`;
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
      const uploadUrl = await this.b2.getUploadUrl({
        bucketId: this.bucketId,
      });

      const response = await this.b2.uploadFile({
        uploadUrl: uploadUrl.data.uploadUrl,
        uploadAuthToken: uploadUrl.data.authorizationToken,
        fileName: fileName,
        data: dataToUpload,
        mime: mimeType,
      });

      // Log Class C transaction (upload)
      b2Monitor.logClassC('uploadSlate', {
        slateId,
        encrypted: !!encryptionKey,
        sizeBytes: dataToUpload.length
      });

      return response.data.fileId;
    } catch (error) {
      b2Monitor.logError('uploadSlate', error);
      const b2Error = handleB2Error(error, 'uploadSlate');
      throw b2Error;
    }
  }

  async getSlate(fileId, encryptionKey = null) {
    await this.authorize();

    try {
      const response = await this.b2.downloadFileById({
        fileId: fileId,
        responseType: 'arraybuffer',
      });

      const downloadedData = Buffer.from(response.data);

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
    } catch (error) {
      b2Monitor.logError('getSlate', error);
      const b2Error = handleB2Error(error, 'getSlate');
      throw b2Error;
    }
  }

  async deleteSlate(fileId, fileName = null) {
    await this.authorize();

    try {
      // If fileName not provided, get it from B2 first
      if (!fileName) {
        const fileInfo = await this.b2.getFileInfo({ fileId });
        fileName = fileInfo.data.fileName;
      }

      await this.b2.deleteFileVersion({
        fileId: fileId,
        fileName: fileName,
      });

      // Log Class C transaction (delete)
      b2Monitor.logClassC('deleteSlate', { fileId, fileName });

      return true;
    } catch (error) {
      b2Monitor.logError('deleteSlate', error);
      const b2Error = handleB2Error(error, 'deleteSlate');
      throw b2Error;
    }
  }
}

module.exports = new B2Storage();
