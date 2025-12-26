/**
 * Setup script for system documentation
 *
 * This script creates a system user and uploads documentation files as published slates.
 * The documentation pages (/terms, /privacy, /limits, /project) are dogfooded using
 * justtype's own publishing feature.
 *
 * Usage: node setup-system-docs.js
 *
 * What it does:
 * - Creates a system user "systemalfaoz" (displays as "alfaoz" to readers)
 * - Uploads terms.txt, privacy.txt, limits.txt, and project.txt as published slates
 * - Assigns clean share_ids: /s/terms, /s/privacy, /s/limits, /s/project
 * - Marks slates as protected from deletion (but still editable)
 *
 * Note: This is optional for self-hosting. You can also serve docs as plain .txt files.
 */

require('dotenv').config();
const db = require('./server/database');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const fs = require('fs');
const b2Storage = require('./server/b2Storage');

async function setup() {
  console.log('Setting up system documentation...\n');

  // Check if system user already exists
  let systemUser = db.prepare('SELECT * FROM users WHERE username = ?').get('systemalfaoz');

  if (!systemUser) {
    // Create system user
    console.log('Creating system user "systemalfaoz"...');
    const hashedPassword = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
    const encryptionSalt = crypto.randomBytes(32).toString('hex');

    const result = db.prepare(`
      INSERT INTO users (username, password, email, email_verified, auth_provider, encryption_salt, is_system_user)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('systemalfaoz', hashedPassword, 'noreply@justtype.io', 1, 'local', encryptionSalt, 1);

    systemUser = { id: result.lastInsertRowid };
    console.log(`✓ Created system user with ID ${systemUser.id}\n`);
  } else {
    console.log(`✓ System user already exists with ID ${systemUser.id}\n`);
  }

  // Define the documentation slates
  const docs = [
    { shareId: 'terms', title: 'terms & conditions', file: 'terms.txt' },
    { shareId: 'privacy', title: 'privacy policy', file: 'privacy.txt' },
    { shareId: 'limits', title: 'storage limits', file: 'limits.txt' },
    { shareId: 'project', title: 'the justtype project', file: 'project.txt' }
  ];

  for (const doc of docs) {
    console.log(`Setting up "${doc.title}" (share_id: ${doc.shareId})...`);

    // Check if slate already exists
    const existingSlate = db.prepare('SELECT * FROM slates WHERE share_id = ?').get(doc.shareId);

    if (existingSlate) {
      console.log(`  → Slate already exists, skipping`);
      continue;
    }

    // Read content from file
    const content = fs.readFileSync(doc.file, 'utf-8');
    const wordCount = content.split(/\s+/).filter(w => w.length > 0).length;
    const charCount = content.length;
    const sizeBytes = Buffer.byteLength(content, 'utf-8');

    // Upload to B2 (unencrypted for public viewing)
    const b2FileId = `system-${doc.shareId}-${Date.now()}`;
    const publicFileId = await b2Storage.uploadSlate(b2FileId, content, null); // null = no encryption

    // Create slate in database
    db.prepare(`
      INSERT INTO slates (
        user_id, title, b2_file_id, b2_public_file_id, share_id,
        is_published, is_system_slate, word_count, char_count, size_bytes,
        encryption_version, published_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(
      systemUser.id,
      doc.title,
      publicFileId, // Use same file for both private and public since it's unencrypted
      publicFileId,
      doc.shareId,
      1, // is_published
      1, // is_system_slate
      wordCount,
      charCount,
      sizeBytes,
      0 // encryption_version = 0 (unencrypted)
    );

    console.log(`  ✓ Created and published at /s/${doc.shareId}`);
  }

  console.log('\n✓ System documentation setup complete!');
  console.log('\nYou can now access:');
  console.log('  - /s/terms (terms & conditions)');
  console.log('  - /s/privacy (privacy policy)');
  console.log('  - /s/limits (storage limits)');
  console.log('  - /s/project (the justtype project)');
}

setup().catch(err => {
  console.error('Setup failed:', err);
  process.exit(1);
});
