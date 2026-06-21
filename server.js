require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable JSON parsing
app.use(express.json());

// Serve static assets from public folder
app.use(express.static(path.join(__dirname, 'public')));

// Configure Multer for file uploads (dynamic memory storage for Vercel Blob, disk storage for local fallback)
const storage = process.env.BLOB_READ_WRITE_TOKEN
  ? multer.memoryStorage()
  : multer.diskStorage({
      destination: async (req, file, cb) => {
        const slug = req.params.slug.replace(/[^a-zA-Z0-9-_]/g, '_').toLowerCase();
        const padUploadsDir = path.join(db.UPLOADS_DIR, slug);
        try {
          await fs.promises.mkdir(padUploadsDir, { recursive: true });
          cb(null, padUploadsDir);
        } catch (err) {
          cb(err);
        }
      },
      filename: (req, file, cb) => {
        const uniqueId = crypto.randomUUID();
        const ext = path.extname(file.originalname);
        cb(null, `${uniqueId}${ext}`);
      }
    });

const upload = multer({
  storage,
  limits: {
    fileSize: 100 * 1024 * 1024 // Limit files to 100MB
  }
});

// Middleware to verify pad password
async function verifyPadAccess(req, res, next) {
  const slug = req.params.slug;
  const password = req.headers['x-pad-password'] || req.query.p || '';
  
  try {
    const hasAccess = await db.verifyPadPassword(slug, password);
    if (!hasAccess) {
      const pad = await db.getPad(slug);
      if (pad && pad.passwordHash) {
        return res.status(401).json({ error: 'Password required', isLocked: true });
      }
    }
    next();
  } catch (error) {
    console.error('Error verifying pad access:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}

// 1. Get pad contents
app.get('/api/pad/:slug', verifyPadAccess, async (req, res) => {
  const { slug } = req.params;
  try {
    const pad = await db.getPad(slug);
    if (!pad) {
      // Pad does not exist yet
      return res.json({
        slug: slug.toLowerCase(),
        text: '',
        hasPassword: false,
        files: [],
        updatedAt: new Date().toISOString()
      });
    }

    res.json({
      slug: pad.slug,
      text: pad.text,
      hasPassword: !!pad.passwordHash,
      files: pad.files,
      updatedAt: pad.updatedAt
    });
  } catch (error) {
    console.error('Error fetching pad:', error);
    res.status(500).json({ error: 'Failed to fetch pad content' });
  }
});

// 2. Save pad text and update password
app.post('/api/pad/:slug', verifyPadAccess, async (req, res) => {
  const { slug } = req.params;
  const { text, password, updatePassword } = req.body;

  try {
    const pad = await db.savePad(slug, { text, password, updatePassword });
    res.json({
      success: true,
      hasPassword: !!pad.passwordHash,
      files: pad.files,
      updatedAt: pad.updatedAt
    });
  } catch (error) {
    console.error('Error saving pad:', error);
    res.status(500).json({ error: 'Failed to save pad content' });
  }
});

// 3. Upload file to pad
app.post('/api/pad/:slug/upload', verifyPadAccess, upload.array('files'), async (req, res) => {
  const { slug } = req.params;
  
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded' });
  }

  try {
    let updatedPad;
    for (const file of req.files) {
      updatedPad = await db.addFileToPad(slug, file);
    }
    
    res.json({
      success: true,
      files: updatedPad.files,
      updatedAt: updatedPad.updatedAt
    });
  } catch (error) {
    console.error('Error handling upload:', error);
    res.status(500).json({ error: 'Failed to save uploaded files' });
  }
});

// 4. Delete file from pad
app.delete('/api/pad/:slug/files/:fileId', verifyPadAccess, async (req, res) => {
  const { slug, fileId } = req.params;

  try {
    const updatedPad = await db.removeFileFromPad(slug, fileId);
    res.json({
      success: true,
      files: updatedPad.files,
      updatedAt: updatedPad.updatedAt
    });
  } catch (error) {
    console.error('Error deleting file:', error);
    res.status(500).json({ error: error.message || 'Failed to delete file' });
  }
});

// 5. Download/Preview file from pad
app.get('/api/pad/:slug/files/:fileId', verifyPadAccess, async (req, res) => {
  const { slug, fileId } = req.params;

  try {
    const pad = await db.getPad(slug);
    if (!pad) {
      return res.status(404).send('Pad not found');
    }

    const fileInfo = pad.files.find(f => f.id === fileId);
    if (!fileInfo) {
      return res.status(404).send('File not found in pad');
    }

    // Direct redirect to Vercel Blob URL if using cloud storage
    if (process.env.BLOB_READ_WRITE_TOKEN && fileInfo.url) {
      return res.redirect(fileInfo.url);
    }

    const filePath = path.join(db.UPLOADS_DIR, slug.toLowerCase(), fileInfo.filename);

    // Check if physical file exists
    if (!fs.existsSync(filePath)) {
      return res.status(404).send('Physical file missing from server');
    }

    // Set preview headers for common viewable media, download for others
    const inlineMimeTypes = [
      'image/png', 'image/jpeg', 'image/gif', 'image/svg+xml', 'image/webp',
      'application/pdf', 'text/plain', 'text/html', 'text/css', 'application/json',
      'video/mp4', 'video/webm', 'audio/mpeg', 'audio/ogg', 'audio/wav'
    ];

    if (inlineMimeTypes.includes(fileInfo.mimeType)) {
      res.setHeader('Content-Type', fileInfo.mimeType);
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(fileInfo.originalName)}"`);
      res.sendFile(filePath);
    } else {
      res.download(filePath, fileInfo.originalName);
    }
  } catch (error) {
    console.error('Error streaming file:', error);
    res.status(500).send('Internal Server Error');
  }
});

// Wildcard route: serve index.html for all non-api and non-static routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`===============================================`);
    console.log(` CodedPad server running at http://localhost:${PORT}`);
    console.log(`===============================================`);
  });
}

module.exports = app;
