const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');
const PADS_DIR = path.join(DATA_DIR, 'pads');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

// Ensure database directories exist
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

// Get the file path for a pad's JSON metadata
function getPadFilePath(slug) {
  // Sanitize the slug to prevent directory traversal
  const safeSlug = slug.replace(/[^a-zA-Z0-9-_]/g, '_').toLowerCase();
  return path.join(PADS_DIR, `${safeSlug}.json`);
}

// Get pad by slug
async function getPad(slug) {
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
  const pad = await getPad(slug);
  if (!pad) throw new Error('Pad not found');

  pad.files.push({
    id: crypto.randomUUID(),
    originalName: fileInfo.originalname,
    filename: fileInfo.filename, // Store unique physical filename
    mimeType: fileInfo.mimetype,
    size: fileInfo.size,
    uploadedAt: new Date().toISOString()
  });
  pad.updatedAt = new Date().toISOString();

  const filePath = getPadFilePath(slug);
  await fs.writeFile(filePath, JSON.stringify(pad, null, 2), 'utf8');
  return pad;
}

// Remove a file record and physical file
async function removeFileFromPad(slug, fileId) {
  const pad = await getPad(slug);
  if (!pad) throw new Error('Pad not found');

  const fileIndex = pad.files.findIndex(f => f.id === fileId);
  if (fileIndex === -1) throw new Error('File not found in pad metadata');

  const fileInfo = pad.files[fileIndex];
  
  // Delete the physical file
  const physicalFilePath = path.join(UPLOADS_DIR, slug.toLowerCase(), fileInfo.filename);
  try {
    await fs.unlink(physicalFilePath);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error(`Failed to delete physical file: ${physicalFilePath}`, error);
    }
  }

  // Remove from list
  pad.files.splice(fileIndex, 1);
  pad.updatedAt = new Date().toISOString();

  // Save updated pad metadata
  const filePath = getPadFilePath(slug);
  await fs.writeFile(filePath, JSON.stringify(pad, null, 2), 'utf8');
  return pad;
}

// Clean up entire pad (optional)
async function deletePad(slug) {
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

module.exports = {
  getPad,
  savePad,
  verifyPadPassword,
  addFileToPad,
  removeFileFromPad,
  deletePad,
  UPLOADS_DIR
};
