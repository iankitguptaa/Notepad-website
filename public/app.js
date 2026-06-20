// ================= STATE CONFIGURATION =================
let activePad = '';
let padData = { text: '', hasPassword: false, files: [] };
let currentPassword = '';
let isReadOnly = false;
let saveTimeout = null;
let lastServerUpdatedAt = null;
let syncInterval = null;
let currentTheme = localStorage.getItem('theme') || 'dark';

// ================= SELECTORS =================
const screens = {
  landing: document.getElementById('landing-screen'),
  unlock: document.getElementById('password-prompt-screen'),
  workspace: document.getElementById('workspace-screen')
};

const textarea = document.getElementById('notepad-textarea');
const lineNumbers = document.getElementById('line-numbers');
const wordCountEl = document.getElementById('word-count');
const charCountEl = document.getElementById('char-count');
const activePadName = document.getElementById('active-pad-name');
const filesCountBadge = document.getElementById('files-count-badge');
const filesListCount = document.getElementById('files-list-count');
const attachedFilesList = document.getElementById('attached-files-list');
const noFilesMessage = document.getElementById('no-files-message');

const saveStatusDot = document.getElementById('save-status-dot');
const saveStatusText = document.getElementById('save-status-text');

// Modals
const passwordModal = document.getElementById('password-modal');
const previewModal = document.getElementById('preview-modal');
const previewTitle = document.getElementById('preview-title');
const previewContentArea = document.getElementById('preview-content-area');
const previewDownloadLink = document.getElementById('preview-download-link');

// ================= HELPER FUNCTIONS =================
// Toast notification helper
function showToast(message, iconName = 'info') {
  const toast = document.getElementById('toast-notification');
  const toastText = document.getElementById('toast-text');
  const toastIcon = document.getElementById('toast-icon');
  
  toastText.textContent = message;
  toastIcon.setAttribute('data-feather', iconName);
  feather.replace();
  
  toast.classList.add('active');
  setTimeout(() => {
    toast.classList.remove('active');
  }, 3000);
}

// Format byte size
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// Generate random animal name
function generateRandomPadSlug() {
  const adjectives = ['swift', 'silver', 'clever', 'silent', 'bold', 'cosmic', 'golden', 'hidden', 'bright', 'cyber'];
  const nouns = ['fox', 'rabbit', 'eagle', 'panther', 'falcon', 'otter', 'badger', 'coyote', 'hawk', 'koala'];
  const randomNumber = Math.floor(Math.random() * 90) + 10;
  
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  
  return `${adj}-${noun}-${randomNumber}`;
}

// Update status bar
function updateStatus(state, msg) {
  saveStatusDot.className = 'status-dot';
  if (state === 'saved') {
    saveStatusDot.classList.add('saved');
    saveStatusText.textContent = msg || 'All changes saved';
  } else if (state === 'saving') {
    saveStatusDot.classList.add('saving');
    saveStatusText.textContent = msg || 'Saving note...';
  } else if (state === 'error') {
    saveStatusDot.classList.add('error');
    saveStatusText.textContent = msg || 'Error saving changes';
  }
}

// Update counts
function updateTextStats() {
  const text = textarea.value;
  const chars = text.length;
  const words = text.trim() === '' ? 0 : text.trim().split(/\s+/).length;
  
  charCountEl.textContent = `${chars} character${chars !== 1 ? 's' : ''}`;
  wordCountEl.textContent = `${words} word${words !== 1 ? 's' : ''}`;
}

// Update Line Numbers
function updateLineNumbers() {
  const text = textarea.value;
  const lines = text.split('\n');
  const lineCount = lines.length;
  
  let lineNumbersHtml = '';
  for (let i = 1; i <= lineCount; i++) {
    lineNumbersHtml += `${i}<br>`;
  }
  lineNumbers.innerHTML = lineNumbersHtml;
  
  // Sync scroll immediately
  lineNumbers.scrollTop = textarea.scrollTop;
}

// Sync Editor Scroll
textarea.addEventListener('scroll', () => {
  lineNumbers.scrollTop = textarea.scrollTop;
});

// Sync input changes and update height/lines
textarea.addEventListener('input', () => {
  updateLineNumbers();
  updateTextStats();
  triggerAutosave();
});

// Trigger synchronization on blur if updates are available
textarea.addEventListener('blur', () => {
  if (saveStatusText.textContent === 'Update available on another device') {
    loadPadContent();
  }
});

// Handle tabs in textarea
textarea.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    e.preventDefault();
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    
    // Set textarea value to: text before caret + tab + text after caret
    textarea.value = textarea.value.substring(0, start) + '\t' + textarea.value.substring(end);
    
    // Put caret in correct place
    textarea.selectionStart = textarea.selectionEnd = start + 1;
    
    updateLineNumbers();
    triggerAutosave();
  }
});

// ================= LIGHT/DARK THEME TOGGLE SYSTEM =================
function applyTheme() {
  const body = document.body;
  const workspaceToggleBtn = document.getElementById('theme-toggle-btn');
  const landingToggleBtn = document.getElementById('landing-theme-toggle-btn');
  
  if (currentTheme === 'light') {
    body.classList.add('light-theme');
    if (workspaceToggleBtn) workspaceToggleBtn.innerHTML = '<i data-feather="moon"></i>';
    if (landingToggleBtn) landingToggleBtn.innerHTML = '<i data-feather="moon"></i>';
  } else {
    body.classList.remove('light-theme');
    if (workspaceToggleBtn) workspaceToggleBtn.innerHTML = '<i data-feather="sun"></i>';
    if (landingToggleBtn) landingToggleBtn.innerHTML = '<i data-feather="sun"></i>';
  }
  
  localStorage.setItem('theme', currentTheme);
  feather.replace();
}

function toggleTheme() {
  currentTheme = (currentTheme === 'dark') ? 'light' : 'dark';
  applyTheme();
  showToast(`${currentTheme.charAt(0).toUpperCase() + currentTheme.slice(1)} theme activated`, 'sun');
}

// ================= SHARING & URL NAVIGATION =================
// Parse URL path to find if they are accessing a pad
function initApp() {
  applyTheme(); // Set active theme
  const path = window.location.pathname;
  // If the path is empty, root, or index.html, we show the landing page
  if (path === '/' || path === '' || path.includes('/index.html')) {
    showScreen('landing');
    document.getElementById('pad-slug-input').focus();
    if (syncInterval) clearInterval(syncInterval);
  } else {
    // We are opening a pad slug
    activePad = path.substring(1); // remove initial slash
    activePadName.textContent = activePad;
    showScreen('workspace');
    loadPadContent().then(() => {
      // Start periodic sync checks every 5 seconds
      if (syncInterval) clearInterval(syncInterval);
      syncInterval = setInterval(checkForUpdates, 5000);
    });
  }
  
  feather.replace();
}

// Switch between screens
function showScreen(screenKey) {
  Object.keys(screens).forEach(key => {
    if (key === screenKey) {
      screens[key].classList.add('active');
    } else {
      screens[key].classList.remove('active');
    }
  });
}

// ================= API INTERACTIVE MODULES =================

// Load Pad Content
async function loadPadContent() {
  updateStatus('saving', 'Loading pad...');
  
  const headers = { 'Content-Type': 'application/json' };
  if (currentPassword) {
    headers['x-pad-password'] = currentPassword;
  }
  
  try {
    const response = await fetch(`/api/pad/${activePad}`, { headers });
    
    if (response.status === 401) {
      // Password required
      updateStatus('error', 'Authentication required');
      showScreen('unlock');
      document.getElementById('unlock-error').style.display = 'none';
      document.getElementById('unlock-password-input').focus();
      return;
    }
    
    if (!response.ok) {
      throw new Error('Failed to load pad content');
    }
    
    const data = await response.json();
    padData = data;
    lastServerUpdatedAt = data.updatedAt; // Store last server sync timestamp
    
    // Load text
    textarea.value = data.text;
    updateLineNumbers();
    updateTextStats();
    
    // Update files list
    renderFilesList(data.files);
    
    // Update password button icon
    updatePasswordBtnIcon(data.hasPassword);
    
    updateStatus('saved', 'Connected');
    showScreen('workspace');
  } catch (error) {
    console.error(error);
    updateStatus('error', 'Connection failed');
    showToast('Failed to connect to the pad server', 'alert-circle');
  }
}

// Save Pad Text (Autosave)
function triggerAutosave() {
  if (isReadOnly) return;
  updateStatus('saving', 'Autosaving...');
  
  if (saveTimeout) clearTimeout(saveTimeout);
  
  saveTimeout = setTimeout(async () => {
    const headers = {
      'Content-Type': 'application/json'
    };
    if (currentPassword) {
      headers['x-pad-password'] = currentPassword;
    }
    
    try {
      const response = await fetch(`/api/pad/${activePad}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ text: textarea.value })
      });
      
      if (!response.ok) {
        throw new Error('Failed to autosave');
      }
      
      const resData = await response.json();
      lastServerUpdatedAt = resData.updatedAt; // Prevent self-sync trigger
      updateStatus('saved', 'All changes saved');
    } catch (error) {
      console.error('Autosave failed:', error);
      updateStatus('error', 'Offline - saving locally');
    }
  }, 1000);
}

// Check for pad updates in the background (real-time sync)
async function checkForUpdates() {
  // Skip if no active pad, if password modal is open, or if we are actively typing/saving
  if (!activePad || !screens.workspace.classList.contains('active') || saveStatusText.textContent === 'Saving note...') {
    return;
  }

  const headers = { 'Content-Type': 'application/json' };
  if (currentPassword) {
    headers['x-pad-password'] = currentPassword;
  }

  try {
    const response = await fetch(`/api/pad/${activePad}`, { headers });
    
    if (response.status === 401) {
      // Password was added or changed on another device, redirect to prompt
      clearInterval(syncInterval);
      loadPadContent();
      return;
    }

    if (!response.ok) return;

    const data = await response.json();
    
    // Check if server version is newer
    if (data.updatedAt !== lastServerUpdatedAt) {
      const textChanged = (data.text !== textarea.value);
      const filesChanged = JSON.stringify(data.files) !== JSON.stringify(padData.files);

      if (filesChanged) {
        padData.files = data.files;
        renderFilesList(data.files);
        showToast('Attachments updated from another device', 'paperclip');
      }

      if (textChanged) {
        if (document.activeElement !== textarea) {
          // User is not typing/focused on textarea, so we update it directly
          textarea.value = data.text;
          updateLineNumbers();
          updateTextStats();
          lastServerUpdatedAt = data.updatedAt;
          showToast('Notepad text updated from another device', 'refresh-cw');
        } else {
          // User is editing. Show warning and update status
          updateStatus('error', 'Update available on another device');
        }
      } else {
        // Only files changed or text matches, sync timestamp
        lastServerUpdatedAt = data.updatedAt;
      }
    }
  } catch (error) {
    console.error('Failed checking background sync updates:', error);
  }
}

// Save Password settings
async function savePadPassword(password) {
  const headers = {
    'Content-Type': 'application/json'
  };
  if (currentPassword) {
    headers['x-pad-password'] = currentPassword;
  }
  
  try {
    const response = await fetch(`/api/pad/${activePad}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        password: password || null,
        updatePassword: true
      })
    });
    
    if (!response.ok) {
      throw new Error('Failed to update password');
    }
    
    const resData = await response.json();
    currentPassword = password; // update client cache
    padData.hasPassword = resData.hasPassword;
    
    updatePasswordBtnIcon(resData.hasPassword);
    closeModal(passwordModal);
    showToast(password ? 'Password lock enabled' : 'Password lock removed', 'shield');
  } catch (error) {
    console.error('Password save error:', error);
    showToast('Failed to change password settings', 'alert-circle');
  }
}

function updatePasswordBtnIcon(hasPassword) {
  const btn = document.getElementById('lock-pad-settings-btn');
  if (hasPassword) {
    btn.innerHTML = '<i data-feather="lock"></i>';
    btn.classList.add('active');
    btn.title = 'Pad Secured. Click to change password settings.';
  } else {
    btn.innerHTML = '<i data-feather="unlock"></i>';
    btn.classList.remove('active');
    btn.title = 'Unsecured Pad. Click to protect with password.';
  }
  feather.replace();
}

// ================= FILE UPLOAD SYSTEM =================

// Trigger file uploads
function uploadFiles(files) {
  if (files.length === 0) return;
  
  const uploadList = document.getElementById('upload-progress-list');
  
  Array.from(files).forEach(file => {
    const fileId = Math.random().toString(36).substring(2, 9);
    
    // Create Progress Card UI
    const card = document.createElement('div');
    card.className = 'upload-progress-card';
    card.id = `upload-progress-${fileId}`;
    card.innerHTML = `
      <div class="progress-file-info">
        <span class="progress-file-name" title="${file.name}">${file.name}</span>
        <span class="progress-percent" id="upload-percent-${fileId}">0%</span>
      </div>
      <div class="progress-bar-bg">
        <div class="progress-bar-fill" id="upload-bar-${fileId}"></div>
      </div>
    `;
    uploadList.appendChild(card);
    
    // Setup XHR for progress event
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append('files', file);
    
    xhr.open('POST', `/api/pad/${activePad}/upload`, true);
    
    if (currentPassword) {
      xhr.setRequestHeader('x-pad-password', currentPassword);
    }
    
    // Progress Listener
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        const percent = Math.round((e.loaded / e.total) * 100);
        document.getElementById(`upload-percent-${fileId}`).textContent = `${percent}%`;
        document.getElementById(`upload-bar-${fileId}`).style.width = `${percent}%`;
      }
    });
    
    // Completion Listener
    xhr.onreadystatechange = () => {
      if (xhr.readyState === XMLHttpRequest.DONE) {
        // Remove progress card
        card.remove();
        
        if (xhr.status === 200) {
          const res = JSON.parse(xhr.responseText);
          padData.files = res.files;
          renderFilesList(res.files);
          showToast(`Uploaded ${file.name} successfully`, 'check-circle');
        } else {
          console.error('Upload error response:', xhr.responseText);
          showToast(`Failed to upload ${file.name}`, 'alert-circle');
        }
      }
    };
    
    xhr.send(formData);
  });
}

// Render uploaded files list in sidebar
function renderFilesList(files) {
  attachedFilesList.innerHTML = '';
  
  filesCountBadge.textContent = files.length;
  filesListCount.textContent = files.length;
  
  if (files.length === 0) {
    noFilesMessage.style.display = 'block';
    return;
  }
  
  noFilesMessage.style.display = 'none';
  
  files.forEach(file => {
    const li = document.createElement('li');
    li.className = 'file-item';
    
    // Pick file type class and icon
    let icon = 'file';
    let typeClass = 'default';
    
    if (file.mimeType.startsWith('image/')) {
      icon = 'image';
      typeClass = 'image';
    } else if (file.mimeType === 'application/pdf') {
      icon = 'file-text';
      typeClass = 'pdf';
    } else if (file.mimeType.includes('zip') || file.mimeType.includes('tar') || file.mimeType.includes('rar')) {
      icon = 'archive';
      typeClass = 'archive';
    }
    
    const downloadUrl = `/api/pad/${activePad}/files/${file.id}?p=${encodeURIComponent(currentPassword)}`;
    
    li.innerHTML = `
      <div class="file-icon-wrapper ${typeClass}">
        <i data-feather="${icon}"></i>
      </div>
      <div class="file-details">
        <div class="file-name" title="${file.originalName}">${file.originalName}</div>
        <div class="file-size">${formatBytes(file.size)}</div>
      </div>
      <div class="file-actions">
        <button class="btn-action btn-preview" data-id="${file.id}" title="Preview File">
          <i data-feather="eye"></i>
        </button>
        <a href="${downloadUrl}" class="btn-action" title="Download File">
          <i data-feather="download"></i>
        </a>
        <button class="btn-action btn-delete" data-id="${file.id}" title="Delete Attachment">
          <i data-feather="trash-2"></i>
        </button>
      </div>
    `;
    
    // Add Click listeners for preview and delete
    li.querySelector('.btn-preview').addEventListener('click', () => previewFile(file));
    li.querySelector('.btn-delete').addEventListener('click', () => deleteFileAttachment(file.id));
    
    attachedFilesList.appendChild(li);
  });
  
  feather.replace();
}

// Delete Attachment
async function deleteFileAttachment(fileId) {
  if (!confirm('Are you sure you want to delete this file attachment?')) return;
  
  const headers = {
    'Content-Type': 'application/json'
  };
  if (currentPassword) {
    headers['x-pad-password'] = currentPassword;
  }
  
  try {
    const response = await fetch(`/api/pad/${activePad}/files/${fileId}`, {
      method: 'DELETE',
      headers
    });
    
    if (!response.ok) {
      throw new Error('Failed to delete file');
    }
    
    const resData = await response.json();
    padData.files = resData.files;
    renderFilesList(resData.files);
    showToast('File deleted successfully', 'trash');
  } catch (error) {
    console.error(error);
    showToast('Failed to delete attachment', 'alert-circle');
  }
}

// Preview File in Modal
async function previewFile(file) {
  const fileUrl = `/api/pad/${activePad}/files/${file.id}?p=${encodeURIComponent(currentPassword)}`;
  
  previewTitle.textContent = file.originalName;
  previewDownloadLink.href = fileUrl;
  previewContentArea.innerHTML = '<div class="loader">Loading preview...</div>';
  
  openModal(previewModal);
  
  // Choose preview method based on mime type
  if (file.mimeType.startsWith('image/')) {
    previewContentArea.innerHTML = `<img src="${fileUrl}" alt="${file.originalName}">`;
  } else if (file.mimeType.startsWith('video/')) {
    previewContentArea.innerHTML = `<video src="${fileUrl}" controls autoplay></video>`;
  } else if (file.mimeType.startsWith('audio/')) {
    previewContentArea.innerHTML = `<audio src="${fileUrl}" controls autoplay></audio>`;
  } else if (file.mimeType === 'application/pdf') {
    previewContentArea.innerHTML = `<iframe src="${fileUrl}"></iframe>`;
  } else if (file.mimeType.startsWith('text/') || file.mimeType === 'application/json') {
    try {
      const resp = await fetch(fileUrl);
      const text = await resp.text();
      const pre = document.createElement('pre');
      pre.className = 'preview-text';
      pre.textContent = text;
      previewContentArea.innerHTML = '';
      previewContentArea.appendChild(pre);
    } catch (e) {
      previewContentArea.innerHTML = `<div class="error-msg" style="display:block; text-align:center;">Cannot load text preview: ${e.message}</div>`;
    }
  } else {
    // Unsupported preview, show download prompt
    previewContentArea.innerHTML = `
      <div style="text-align: center; padding: 40px; color: var(--text-muted);">
        <i data-feather="file" style="width:64px; height:64px; margin-bottom:16px;"></i>
        <p style="font-size:16px; font-weight:600; color:var(--text-main); margin-bottom:8px;">No Preview Available</p>
        <p style="font-size:14px; margin-bottom:20px;">This file type cannot be previewed directly in the browser.</p>
        <a href="${fileUrl}" class="btn btn-primary" download><i data-feather="download"></i> Download to View</a>
      </div>
    `;
    feather.replace();
  }
}

// ================= MODAL WINDOW CONTROLS =================
function openModal(modal) {
  modal.classList.add('active');
}
function closeModal(modal) {
  modal.classList.remove('active');
  // If preview modal, stop playing video/audio on close
  if (modal === previewModal) {
    previewContentArea.innerHTML = '';
  }
}

// Close buttons for modals
document.getElementById('close-password-modal-btn').addEventListener('click', () => closeModal(passwordModal));
document.getElementById('cancel-password-modal-btn').addEventListener('click', () => closeModal(passwordModal));
document.getElementById('close-preview-modal-btn').addEventListener('click', () => closeModal(previewModal));

// Close modal when clicking on overlay background
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      closeModal(overlay);
    }
  });
});

// ================= INTERFACE LISTENERS =================

// Create custom/random pad from landing page
document.getElementById('create-pad-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const slug = document.getElementById('pad-slug-input').value.trim().toLowerCase();
  if (slug) {
    window.location.href = `/${slug}`;
  }
});

document.getElementById('random-pad-btn').addEventListener('click', () => {
  const randomSlug = generateRandomPadSlug();
  document.getElementById('pad-slug-input').value = randomSlug;
});

// Unlock protected pad
document.getElementById('unlock-pad-form').addEventListener('submit', (e) => {
  e.preventDefault();
  currentPassword = document.getElementById('unlock-password-input').value;
  loadPadContent().then(() => {
    if (screens.workspace.classList.contains('active')) {
      // Unlocked successfully, clear value
      document.getElementById('unlock-password-input').value = '';
    } else {
      // Locked again (auth fail)
      document.getElementById('unlock-error').style.display = 'block';
      document.getElementById('unlock-password-input').select();
    }
  });
});

document.getElementById('toggle-unlock-pass').addEventListener('click', () => {
  const input = document.getElementById('unlock-password-input');
  const type = input.type === 'password' ? 'text' : 'password';
  input.type = type;
  const icon = document.getElementById('toggle-unlock-pass').querySelector('i');
  icon.setAttribute('data-feather', type === 'password' ? 'eye' : 'eye-off');
  feather.replace();
});

document.getElementById('toggle-pad-pass').addEventListener('click', () => {
  const input = document.getElementById('pad-password');
  const type = input.type === 'password' ? 'text' : 'password';
  input.type = type;
  const icon = document.getElementById('toggle-pad-pass').querySelector('i');
  icon.setAttribute('data-feather', type === 'password' ? 'eye' : 'eye-off');
  feather.replace();
});

// Back home buttons
document.querySelectorAll('.btn-back-home').forEach(btn => {
  btn.addEventListener('click', () => {
    window.location.href = '/';
  });
});

// Share Pad Badge Click
document.getElementById('share-pad-btn').addEventListener('click', () => {
  navigator.clipboard.writeText(window.location.href).then(() => {
    showToast('Pad share link copied to clipboard!', 'clipboard');
  }).catch(err => {
    console.error('Could not copy text: ', err);
  });
});

// Password settings toggle modal
document.getElementById('lock-pad-settings-btn').addEventListener('click', () => {
  document.getElementById('pad-password').value = currentPassword;
  openModal(passwordModal);
  document.getElementById('pad-password').focus();
});

// Password form save settings
document.getElementById('save-password-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const password = document.getElementById('pad-password').value.trim();
  savePadPassword(password);
});

// New Pad buttons
document.getElementById('new-pad-header-btn').addEventListener('click', () => {
  window.location.href = `/${generateRandomPadSlug()}`;
});

// Toolbar: Copy Text
document.getElementById('copy-text-btn').addEventListener('click', () => {
  navigator.clipboard.writeText(textarea.value).then(() => {
    showToast('Notes copied to clipboard!', 'check-circle');
  });
});

// Toolbar: Download Text
document.getElementById('download-text-btn').addEventListener('click', () => {
  const blob = new Blob([textarea.value], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${activePad}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

// Toolbar: Read-only/Edit Mode Toggle
document.getElementById('toggle-readonly-btn').addEventListener('click', () => {
  isReadOnly = !isReadOnly;
  const btn = document.getElementById('toggle-readonly-btn');
  
  if (isReadOnly) {
    textarea.setAttribute('readonly', 'true');
    btn.innerHTML = '<i data-feather="eye"></i> Read-only';
    btn.classList.add('active');
    showToast('Read-only mode enabled', 'eye');
  } else {
    textarea.removeAttribute('readonly');
    btn.innerHTML = '<i data-feather="edit-2"></i> Edit Mode';
    btn.classList.remove('active');
    showToast('Edit mode enabled', 'edit-2');
  }
  feather.replace();
});

// Attachments Sidebar display toggle
const sidebar = document.getElementById('attachments-sidebar');
document.getElementById('toggle-sidebar-btn').addEventListener('click', () => {
  sidebar.classList.toggle('collapsed');
  const btn = document.getElementById('toggle-sidebar-btn');
  btn.classList.toggle('active');
});
document.getElementById('close-sidebar-btn').addEventListener('click', () => {
  sidebar.classList.add('collapsed');
  document.getElementById('toggle-sidebar-btn').classList.remove('active');
});

// Drag & Drop event bindings
const dropZone = document.getElementById('file-drop-zone');
const fileInput = document.getElementById('file-input-element');

// Browse trigger on drop zone click
dropZone.addEventListener('click', (e) => {
  if (e.target !== fileInput) {
    fileInput.click();
  }
});

fileInput.addEventListener('change', (e) => {
  uploadFiles(e.target.files);
  fileInput.value = ''; // Reset file input
});

['dragenter', 'dragover'].forEach(eventName => {
  dropZone.addEventListener(eventName, (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  }, false);
});

['dragleave', 'drop'].forEach(eventName => {
  dropZone.addEventListener(eventName, (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
  }, false);
});

dropZone.addEventListener('drop', (e) => {
  const dt = e.dataTransfer;
  const files = dt.files;
  uploadFiles(files);
}, false);

// Theme Toggle Button Listeners
document.getElementById('theme-toggle-btn').addEventListener('click', toggleTheme);
document.getElementById('landing-theme-toggle-btn').addEventListener('click', toggleTheme);

// ================= BOOTSTRAP INITIALIZATION =================
initApp();
