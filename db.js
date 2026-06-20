const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');
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

// ================= MONGODB CONFIG & SCHEMA =================
const PadSchema = new mongoose.Schema({
  slug: { type: String, required: true, unique: true, index: true },
  text: { type: String, default: '' },
  salt: { type: String, required: true },
  passwordHash: { type: String, default: null },
  createdAt: { type: String, default: () => new Date().toISOString() },
  updatedAt: { type: String, default: () => new Date().toISOString() },
  files: [{
    id: { type: String, required: true },
    originalName: { type: String, required: true },
    filename: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    uploadedAt: { type: String, default: () => new Date().toISOString() },
    url: { type: String, default: '' }
  }]
});

const Pad = mongoose.models.Pad || mongoose.model('Pad', PadSchema);

let connectionPromise = null;
async function ensureMongoConnection() {
  if (!process.env.MONGODB_URI) return false;
  if (mongoose.connection.readyState === 1) return true;
  if (!connectionPromise) {
    connectionPromise = mongoose.connect(process.env.MONGODB_URI);
  }
  try {
    await connectionPromise;
    return true;
  } catch (error) {
    console.error('MongoDB Connection Error:', error);
    connectionPromise = null;
    throw error;
  }
}

// ================= DATABASE CRUD OPERATIONS =================

// Get pad by slug
async function getPad(slug) {
  if (process.env.MONGODB_URI) {
    await ensureMongoConnection();
    const pad = await Pad.findOne({ slug: slug.toLowerCase() });
    if (!pad) return null;
    return pad.toObject();
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
  if (process.env.MONGODB_URI) {
    await ensureMongoConnection();
    let pad = await Pad.findOne({ slug: slug.toLowerCase() });
    
    if (!pad) {
      // New pad
      const salt = generateSalt();
      pad = new Pad({
        slug: slug.toLowerCase(),
        text: text || '',
        salt: salt,
        passwordHash: password ? hashPassword(password, salt) : null,
        files: []
      });
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
    
    await pad.save();
    return pad.toObject();
  }

  await initDb();
  const filePath = getPadFilePath(slug);
  
  let pad = await getPad(slug);
  
  if (!pad) {
    // New pad
    const salt = generateSalt();
    pad = {
      slug: slug.toLowerCase(),
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
  let filename = fileInfo.filename;
  let url = '';

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const uniqueId = crypto.randomUUID();
    const ext = path.extname(fileInfo.originalname);
    const blobFilename = `${slug.toLowerCase()}/${uniqueId}${ext}`;
    
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

  if (process.env.MONGODB_URI) {
    await ensureMongoConnection();
    const pad = await Pad.findOne({ slug: slug.toLowerCase() });
    if (!pad) throw new Error('Pad not found');

    pad.files.push(newFileRecord);
    pad.updatedAt = new Date().toISOString();
    await pad.save();
    return pad.toObject();
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
  let pad;
  if (process.env.MONGODB_URI) {
    await ensureMongoConnection();
    pad = await Pad.findOne({ slug: slug.toLowerCase() });
  } else {
    pad = await getPad(slug);
  }

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
    const physicalFilePath = path.join(UPLOADS_DIR, slug.toLowerCase(), fileInfo.filename);
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
  if (process.env.MONGODB_URI) {
    await pad.save();
    return pad.toObject();
  } else {
    const filePath = getPadFilePath(slug);
    await fs.writeFile(filePath, JSON.stringify(pad, null, 2), 'utf8');
    return pad;
  }
}

// Clean up entire pad (optional)
async function deletePad(slug) {
  if (process.env.MONGODB_URI) {
    await ensureMongoConnection();
    const pad = await Pad.findOne({ slug: slug.toLowerCase() });
    if (!pad) return;

    // Delete all Vercel Blob files
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

    await Pad.deleteOne({ slug: slug.toLowerCase() });
  } else {
    const pad = await getPad(slug);
    if (!pad) return;

    // Delete all physical files
    const padUploadsDir = path.join(UPLOADS_DIR, slug.toLowerCase());
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
