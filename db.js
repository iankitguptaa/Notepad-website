const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { kv } = require('@vercel/kv');
const { put, del } = require('@vercel/blob');

const DATA_DIR = path.join(__dirname, 'data');
const PADS_DIR = path.join(DATA_DIR, 'pads');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

// Ensure database directories exist (for local fallback)
async function initDb() {
  await fs.mkdir(PADS_DIR, { recursive: true });
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
}

// Generate a random salt
function generateSalt() {
  return crypto.randomBytes(16).toString('hex');
}

// Hash password with a salt
function hashPassword(password, salt) {
  return crypto.createHash('sha256').update(password + salt).digest('hex');
}

// Get the file path for a pad's JSON metadata (for local fallback)
function getPadFilePath(slug) {
  const safeSlug = slug.replace(/[^a-zA-Z0-9-_]/g, '_').toLowerCase();
  return path.join(PADS_DIR, `${safeSlug}.json`);
}

// Helper to determine if we should use Vercel KV
function isKVEnabled() {
  return !!process.env.KV_REST_API_URL;
}

// ================= DATABASE CRUD OPERATIONS =================

// Get pad by slug
async function getPad(slug) {
  const safeSlug = slug.toLowerCase();
  
  if (isKVEnabled()) {
    try {
      const pad = await kv.get(`pad:${safeSlug}`);
      return pad; // @vercel/kv automatically parses JSON string to object
    } catch (error) {
      console.error('Vercel KV Error (getPad):', error);
      throw error;
    }
  }

  await initDb();
  const filePath = getPadFilePath(slug);
  try {
    const data = await fs.readFile(filePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

// Create or update a pad
async function savePad(slug, { text, password, updatePassword = false }) {
  const safeSlug = slug.toLowerCase();
  
  if (isKVEnabled()) {
    try {
      let pad = await getPad(slug);
      
      if (!pad) {
        // New pad
        const salt = generateSalt();
        pad = {
          slug: safeSlug,
          text: text || '',
          salt: salt,
          passwordHash: password ? hashPassword(password, salt) : null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          files: []
        };
      } else {
        // Update existing pad
        if (text !== undefined) {
          pad.text = text;
        }
        if (updatePassword) {
          if (password) {
            pad.salt = generateSalt();
            pad.passwordHash = hashPassword(password, pad.salt);
          } else {
            pad.passwordHash = null;
          }
        }
        pad.updatedAt = new Date().toISOString();
      }
      
      await kv.set(`pad:${safeSlug}`, pad);
      return pad;
    } catch (error) {
      console.error('Vercel KV Error (savePad):', error);
      throw error;
    }
  }

  await initDb();
  const filePath = getPadFilePath(slug);
  
  let pad = await getPad(slug);
  
  if (!pad) {
    // New pad
    const salt = generateSalt();
    pad = {
      slug: safeSlug,
      text: text || '',
      salt: salt,
      passwordHash: password ? hashPassword(password, salt) : null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      files: []
    };
  } else {
    // Update existing pad
    if (text !== undefined) {
      pad.text = text;
    }
    if (updatePassword) {
      if (password) {
        pad.salt = generateSalt();
        pad.passwordHash = hashPassword(password, pad.salt);
      } else {
        pad.passwordHash = null;
      }
    }
    pad.updatedAt = new Date().toISOString();
  }

  await fs.writeFile(filePath, JSON.stringify(pad, null, 2), 'utf8');
  return pad;
}

// Verify pad password
async function verifyPadPassword(slug, password) {
  const pad = await getPad(slug);
  if (!pad) return true; // No pad, no password
  if (!pad.passwordHash) return true; // Pad exists but has no password
  if (!password) return false; // Pad has password, but none provided

  const calculatedHash = hashPassword(password, pad.salt);
  return calculatedHash === pad.passwordHash;
}

// Add a file record to a pad
async function addFileToPad(slug, fileInfo) {
  const safeSlug = slug.toLowerCase();
  let filename = fileInfo.filename;
  let url = '';

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const uniqueId = crypto.randomUUID();
    const ext = path.extname(fileInfo.originalname);
    const blobFilename = `${safeSlug}/${uniqueId}${ext}`;
    
    const blob = await put(blobFilename, fileInfo.buffer, {
      access: 'public',
      token: process.env.BLOB_READ_WRITE_TOKEN
    });
    filename = blob.url;
    url = blob.url;
  }

  const newFileRecord = {
    id: crypto.randomUUID(),
    originalName: fileInfo.originalname,
    filename: filename || '',
    mimeType: fileInfo.mimetype || fileInfo.mimeType || 'application/octet-stream',
    size: fileInfo.size,
    url: url,
    uploadedAt: new Date().toISOString()
  };

  if (isKVEnabled()) {
    try {
      const pad = await getPad(slug);
      if (!pad) throw new Error('Pad not found');

      pad.files.push(newFileRecord);
      pad.updatedAt = new Date().toISOString();
      
      await kv.set(`pad:${safeSlug}`, pad);
      return pad;
    } catch (error) {
      console.error('Vercel KV Error (addFileToPad):', error);
      throw error;
    }
  } else {
    const pad = await getPad(slug);
    if (!pad) throw new Error('Pad not found');

    pad.files.push(newFileRecord);
    pad.updatedAt = new Date().toISOString();

    const filePath = getPadFilePath(slug);
    await fs.writeFile(filePath, JSON.stringify(pad, null, 2), 'utf8');
    return pad;
  }
}

// Remove a file record and physical file
async function removeFileFromPad(slug, fileId) {
  const safeSlug = slug.toLowerCase();
  let pad = await getPad(slug);

  if (!pad) throw new Error('Pad not found');

  const fileIndex = pad.files.findIndex(f => f.id === fileId);
  if (fileIndex === -1) throw new Error('File not found in pad metadata');

  const fileInfo = pad.files[fileIndex];

  // 1. Delete physical file (either Blob or Disk)
  if (process.env.BLOB_READ_WRITE_TOKEN && fileInfo.url) {
    try {
      await del(fileInfo.url, {
        token: process.env.BLOB_READ_WRITE_TOKEN
      });
    } catch (error) {
      console.error(`Failed to delete blob file: ${fileInfo.url}`, error);
    }
  } else if (!process.env.BLOB_READ_WRITE_TOKEN) {
    // Delete the local physical file
    const physicalFilePath = path.join(UPLOADS_DIR, safeSlug, fileInfo.filename);
    try {
      await fs.unlink(physicalFilePath);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error(`Failed to delete physical file: ${physicalFilePath}`, error);
      }
    }
  }

  // 2. Remove file record from metadata
  pad.files.splice(fileIndex, 1);
  pad.updatedAt = new Date().toISOString();

  // 3. Save updated pad metadata
  if (isKVEnabled()) {
    try {
      await kv.set(`pad:${safeSlug}`, pad);
      return pad;
    } catch (error) {
      console.error('Vercel KV Error (removeFileFromPad):', error);
      throw error;
    }
  } else {
    const filePath = getPadFilePath(slug);
    await fs.writeFile(filePath, JSON.stringify(pad, null, 2), 'utf8');
    return pad;
  }
}

// Clean up entire pad
async function deletePad(slug) {
  const safeSlug = slug.toLowerCase();
  const pad = await getPad(slug);
  if (!pad) return;

  // Delete all Vercel Blob files if present
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    for (const file of pad.files) {
      if (file.url) {
        try {
          await del(file.url, {
            token: process.env.BLOB_READ_WRITE_TOKEN
          });
        } catch (e) {
          console.error(`Failed to delete blob during pad deletion: ${file.url}`, e);
        }
      }
    }
  }

  if (isKVEnabled()) {
    try {
      await kv.del(`pad:${safeSlug}`);
    } catch (error) {
      console.error('Vercel KV Error (deletePad):', error);
      throw error;
    }
  } else {
    // Delete all physical files locally
    const padUploadsDir = path.join(UPLOADS_DIR, safeSlug);
    try {
      const files = await fs.readdir(padUploadsDir);
      for (const file of files) {
        await fs.unlink(path.join(padUploadsDir, file));
      }
      await fs.rmdir(padUploadsDir);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error(`Failed to clean uploads directory for ${slug}`, error);
      }
    }

    // Delete metadata file
    const filePath = getPadFilePath(slug);
    try {
      await fs.unlink(filePath);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }
}

module.exports = {
  getPad,
  savePad,
  verifyPadPassword,
  addFileToPad,
  removeFileFromPad,
  deletePad,
  UPLOADS_DIR
};
