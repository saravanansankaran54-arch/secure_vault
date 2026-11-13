import './style.css';
import { supabase } from './supabase.js';

let cryptoKey = null;
let vaultItems = [];
let currentSalt = null;

const authScreen = document.getElementById('auth-screen');
const vaultScreen = document.getElementById('vault-screen');
const authTitle = document.getElementById('auth-title');
const authSubtitle = document.getElementById('auth-subtitle');
const authBtn = document.getElementById('auth-btn');
const authForm = document.getElementById('auth-form');
const masterInput = document.getElementById('master-password');
const authError = document.getElementById('auth-error');

const entryForm = document.getElementById('entry-form');
const vaultList = document.getElementById('vault-list');
const searchInput = document.getElementById('search-input');
const filterCategory = document.getElementById('filter-category');

async function checkExistingVault() {
  try {
    const { data, error } = await supabase.from('vault_sync').select('*').limit(1);
    if (error) throw error;
    
    if (data && data.length > 0) {
      authTitle.textContent = 'Unlock Your Vault';
      authSubtitle.textContent = 'Enter your master password to decrypt your cloud vault.';
      authBtn.textContent = 'Unlock Vault';
    } else {
      authTitle.textContent = 'Create Your Cloud Vault';
      authSubtitle.textContent = 'Set a master password. Syncs across all your devices securely.';
      authBtn.textContent = 'Create Vault';
    }
  } catch (err) {
    console.error('Vault check failed:', err.message);
  }
}
checkExistingVault();

async function deriveKey(password, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return window.crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptData(data, key) {
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(JSON.stringify(data));
  const ciphertext = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded
  );

  return JSON.stringify({
    iv: Array.from(iv),
    data: Array.from(new Uint8Array(ciphertext)),
  });
}

async function decryptData(encryptedJson, key) {
  const parsed = JSON.parse(encryptedJson);
  const iv = new Uint8Array(parsed.iv);
  const data = new Uint8Array(parsed.data);

  const decrypted = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    data
  );

  return JSON.parse(new TextDecoder().decode(decrypted));
}

authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  authError.classList.add('hidden');
  const password = masterInput.value;

  try {
    const { data: rows, error } = await supabase.from('vault_sync').select('*').limit(1);
    if (error) throw error;

    if (rows && rows.length > 0) {
      currentSalt = new Uint8Array(JSON.parse(rows[0].salt));
      cryptoKey = await deriveKey(password, currentSalt);

      try {
        vaultItems = await decryptData(rows[0].encrypted_data, cryptoKey);
      } catch (decryptErr) {
        authError.textContent = 'Incorrect master password.';
        authError.classList.remove('hidden');
        return;
      }
    } else {
      currentSalt = window.crypto.getRandomValues(new Uint8Array(16));
      cryptoKey = await deriveKey(password, currentSalt);
      vaultItems = [];
      await saveVaultToCloud();
    }

    masterInput.value = '';
    authScreen.classList.add('hidden');
    vaultScreen.classList.remove('hidden');
    renderVault();
  } catch (err) {
    console.error('Vault error:', err.message);
    authError.textContent = 'Connection error. Check Supabase table or internet.';
    authError.classList.remove('hidden');
  }
});

document.getElementById('lock-btn').addEventListener('click', () => {
  cryptoKey = null;
  vaultItems = [];
  vaultList.innerHTML = '';
  vaultScreen.classList.add('hidden');
  authScreen.classList.remove('hidden');
  checkExistingVault();
});

async function saveVaultToCloud() {
  const encrypted = await encryptData(vaultItems, cryptoKey);
  const payload = {
    id: 'main_vault',
    encrypted_data: encrypted,
    salt: JSON.stringify(Array.from(currentSalt)),
    updated_at: new Date().toISOString()
  };

  const { error } = await supabase.from('vault_sync').upsert(payload);
  if (error) console.error('Cloud save failed:', error);
}

entryForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const title = document.getElementById('entry-title').value.trim();
  const category = document.getElementById('entry-category').value;
  const username = document.getElementById('entry-username').value.trim();
  const secretInput = document.getElementById('entry-secret');
  const fileInput = document.getElementById('entry-file');

  let secretValue = secretInput.value;
  let fileUrl = null;
  let fileName = null;

  if (fileInput.files.length > 0) {
    const file = fileInput.files[0];
    fileName = `${Date.now()}_${file.name}`;
    
    const fileBuffer = await file.arrayBuffer();
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encryptedFile = await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, fileBuffer);
    
    const combinedBlob = new Blob([iv, encryptedFile]);

    const { error: uploadError } = await supabase.storage
      .from('vault-files')
      .upload(fileName, combinedBlob);

    if (uploadError) {
      alert('File upload failed: ' + uploadError.message);
      return;
    }

    const { data: publicUrlData } = supabase.storage.from('vault-files').getPublicUrl(fileName);
    fileUrl = publicUrlData.publicUrl;
    secretValue = '[Encrypted Media File Attached]';
  }

  const newEntry = {
    id: crypto.randomUUID(),
    title,
    category,
    username,
    secret: secretValue,
    fileUrl,
    fileName,
    createdAt: new Date().toLocaleDateString('en-IN'),
  };

  vaultItems.unshift(newEntry);
  await saveVaultToCloud();
  entryForm.reset();
  renderVault();
});

document.getElementById('generate-btn').addEventListener('click', () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
  const array = new Uint32Array(16);
  window.crypto.getRandomValues(array);
  const password = Array.from(array, (x) => chars[x % chars.length]).join('');
  document.getElementById('entry-secret').value = password;
});

function renderVault() {
  const query = searchInput ? searchInput.value.toLowerCase() : '';
  const category = filterCategory ? filterCategory.value : 'All';

  const filtered = vaultItems.filter((item) => {
    const matchesSearch =
      item.title.toLowerCase().includes(query) ||
      (item.username && item.username.toLowerCase().includes(query));
    const matchesCat = category === 'All' || item.category === category;
    return matchesSearch && matchesCat;
  });

  if (filtered.length === 0) {
    vaultList.innerHTML = `<p style="text-align:center; color: var(--muted); padding: 2rem;">No vault entries found.</p>`;
    return;
  }

  vaultList.innerHTML = filtered
    .map(
      (item) => `
      <div class="vault-item" data-id="${item.id}" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.1); padding: 1rem; border-radius: 8px; margin-bottom: 1rem; display: flex; justify-content: space-between; align-items: center;">
        <div>
          <strong style="color: #fff; font-size: 1.1rem;">${escapeHTML(item.title)}</strong>
          <span class="item-meta" style="color: #888; font-size: 0.85rem;"> • ${item.category} • Added ${item.createdAt}</span>
          ${item.username ? `<div class="item-meta" style="color: #aaa; font-size: 0.9rem; margin-top: 4px;">User: ${escapeHTML(item.username)}</div>` : ''}
          ${item.fileUrl ? `<div class="item-meta" style="color: #4ade80; font-size: 0.9rem; margin-top: 4px;">📎 Media File Attached</div>` : `<div class="item-secret" id="secret-${item.id}" style="color: #ccc; font-family: monospace; margin-top: 4px;">••••••••••••</div>`}
        </div>
        <div class="item-actions" style="display: flex; gap: 0.5rem;">
          ${item.fileUrl ? `<button class="btn-primary view-media-btn" data-url="${item.fileUrl}" data-name="${item.fileName}" style="background: #3b82f6; color: white; border: none; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer;">View/Download</button>` : `<button class="btn-outline toggle-btn" data-id="${item.id}" style="background: transparent; color: #fff; border: 1px solid #555; padding: 0.5rem 0.75rem; border-radius: 4px; cursor: pointer;">Show</button><button class="btn-outline copy-btn" data-secret="${escapeHTML(item.secret)}" style="background: transparent; color: #fff; border: 1px solid #555; padding: 0.5rem 0.75rem; border-radius: 4px; cursor: pointer;">Copy</button>`}
          <button class="btn-danger delete-btn" data-id="${item.id}" data-filename="${item.fileName || ''}" style="background: #ef4444; color: white; border: none; padding: 0.5rem 0.75rem; border-radius: 4px; cursor: pointer;">Delete</button>
        </div>
      </div>
    `
    )
    .join('');
}

vaultList.addEventListener('click', async (e) => {
  const target = e.target;

  if (target.classList.contains('toggle-btn')) {
    const id = target.dataset.id;
    const item = vaultItems.find((i) => i.id === id);
    const secretEl = document.getElementById(`secret-${id}`);
    if (target.textContent === 'Show') {
      secretEl.textContent = item.secret;
      target.textContent = 'Hide';
    } else {
      secretEl.textContent = '••••••••••••';
      target.textContent = 'Show';
    }
  }

  if (target.classList.contains('copy-btn')) {
    await navigator.clipboard.writeText(target.dataset.secret);
    const original = target.textContent;
    target.textContent = 'Copied!';
    setTimeout(() => (target.textContent = original), 1500);
  }

  if (target.classList.contains('view-media-btn')) {
    const fileUrl = target.dataset.url;
    const fileName = target.dataset.name || 'file';
    try {
      target.textContent = 'Decrypting...';
      const res = await fetch(fileUrl);
      const blob = await res.blob();
      const buffer = await blob.arrayBuffer();

      const iv = buffer.slice(0, 12);
      const encryptedData = buffer.slice(12);

      const decrypted = await window.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: new Uint8Array(iv) },
        cryptoKey,
        encryptedData
      );

      let mimeType = 'application/octet-stream';
      const ext = fileName.split('.').pop().toLowerCase();
      if (['jpg', 'jpeg'].includes(ext)) mimeType = 'image/jpeg';
      else if (ext === 'png') mimeType = 'image/png';
      else if (ext === 'webp') mimeType = 'image/webp';
      else if (ext === 'pdf') mimeType = 'application/pdf';

      const decryptedBlob = new Blob([decrypted], { type: mimeType });
      const objectUrl = URL.createObjectURL(decryptedBlob);
      window.open(objectUrl, '_blank');
      target.textContent = 'View/Download';
    } catch (err) {
      console.error(err);
      alert('Decryption failed. Wrong master password or corrupted file.');
      target.textContent = 'View/Download';
    }
  }

  if (target.classList.contains('delete-btn')) {
    const id = target.dataset.id;
    const fileName = target.dataset.filename;

    if (fileName) {
      await supabase.storage.from('vault-files').remove([fileName]);
    }

    vaultItems = vaultItems.filter((i) => i.id !== id);
    await saveVaultToCloud();
    renderVault();
  }
});

if (searchInput) searchInput.addEventListener('input', renderVault);
if (filterCategory) filterCategory.addEventListener('change', renderVault);
function escapeHTML(str) {
    if (!str) return '';

    return String(str).replace(/[&<>"']/g, (m) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[m]));
}