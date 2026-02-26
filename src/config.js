const fs = require('fs');
const path = require('path');

let envLoaded = false;

function loadDotEnv() {
  if (envLoaded) return;
  envLoaded = true;

  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const raw = line.trim();
    if (!raw || raw.startsWith('#')) continue;

    const idx = raw.indexOf('=');
    if (idx <= 0) continue;

    const key = raw.slice(0, idx).trim();
    const value = raw.slice(idx + 1).trim().replace(/^"|"$/g, '');
    if (!(key in process.env)) process.env[key] = value;
  }
}

function getApiBase() {
  loadDotEnv();
  return process.env.API_BASE || 'https://down.mptext.top/api/public/v1';
}

function getFetchSize() {
  loadDotEnv();
  return Number(process.env.FETCH_SIZE || 50);
}

function getAuthKey() {
  loadDotEnv();
  return process.env.X_AUTH_KEY || process.env.X_AUTH_TOKEN || process.env['X-Auth-Key'] || '';
}

function getHeaders() {
  const authKey = getAuthKey();
  if (!authKey) {
    throw new Error('Missing auth key in env (X_AUTH_KEY or X-Auth-Key)');
  }
  return { 'X-Auth-Key': authKey };
}

module.exports = {
  loadDotEnv,
  getApiBase,
  getFetchSize,
  getHeaders
};
