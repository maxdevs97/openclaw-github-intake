/**
 * GitHub App Authentication
 * App ID + PEM → JWT → Installation Access Token
 */
const jwt = require('jsonwebtoken');
const axios = require('axios');

let cachedToken = null;
let tokenExpiry = null;

/**
 * Get the private key from environment (supports multiple env var names and formats)
 */
function getPrivateKey() {
  // Support multiple env var names
  let key = process.env.GITHUB_PRIVATE_KEY || process.env.GITHUB_APP_PRIVATE_KEY;

  if (!key && process.env.GITHUB_APP_PRIVATE_KEY_PATH) {
    const fs = require('fs');
    key = fs.readFileSync(process.env.GITHUB_APP_PRIVATE_KEY_PATH, 'utf8');
  }

  if (!key) {
    throw new Error('No GitHub private key found. Set GITHUB_PRIVATE_KEY, GITHUB_APP_PRIVATE_KEY, or GITHUB_APP_PRIVATE_KEY_PATH');
  }

  // Handle escaped newlines from env vars
  return key.replace(/\\n/g, '\n');
}

/**
 * Generate a GitHub App JWT (valid for 10 minutes)
 */
function generateAppJWT() {
  const appId = process.env.GITHUB_APP_ID;
  const privateKey = getPrivateKey();

  if (!appId) {
    throw new Error('GITHUB_APP_ID must be set');
  }

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iat: now - 60, // issued slightly in the past to handle clock skew
    exp: now + (10 * 60), // expires in 10 minutes
    iss: appId
  };

  return jwt.sign(payload, privateKey, { algorithm: 'RS256' });
}

/**
 * Get an installation access token (cached, refreshed before expiry)
 */
async function getInstallationToken() {
  const now = Date.now();

  // Return cached token if still valid (with 5min buffer)
  if (cachedToken && tokenExpiry && (tokenExpiry - now) > 5 * 60 * 1000) {
    return cachedToken;
  }

  const installationId = process.env.GITHUB_INSTALLATION_ID;
  if (!installationId) {
    throw new Error('GITHUB_INSTALLATION_ID must be set');
  }

  const appJWT = generateAppJWT();

  const response = await axios.post(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {},
    {
      headers: {
        Authorization: `Bearer ${appJWT}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    }
  );

  cachedToken = response.data.token;
  tokenExpiry = new Date(response.data.expires_at).getTime();

  console.log('[github-auth] Refreshed installation access token');
  return cachedToken;
}

/**
 * Make an authenticated GitHub API request
 */
async function githubRequest(method, path, data = null) {
  const token = await getInstallationToken();

  const config = {
    method,
    url: `https://api.github.com${path}`,
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    }
  };

  if (data) config.data = data;

  return axios(config);
}

module.exports = { getInstallationToken, githubRequest };
