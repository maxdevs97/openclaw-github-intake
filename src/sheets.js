/**
 * Google Sheets integration for Project Registry
 */
const { google } = require('googleapis');

let sheetsClient = null;

const SHEET_NAME = 'Projects';
// Updated columns: added Client Name and Slack Channel
const COLUMNS = ['Repo Name', 'URL', 'Client Name', 'Slack Channel', 'Created Date', 'Status', 'Last Activity'];
const COL_COUNT = COLUMNS.length; // 7

function getCredentials() {
  // Support multiple env var formats
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    // DO App Platform may inject literal newlines in the PEM key which breaks JSON.parse
    // Replace actual newlines inside the JSON string with escaped \n
    let raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    try {
      return JSON.parse(raw);
    } catch (_) {
      // Try fixing literal newlines in the private_key value
      raw = raw.replace(/\n/g, '\\n').replace(/\\\\n/g, '\\n');
      return JSON.parse(raw);
    }
  }
  if (process.env.GOOGLE_SERVICE_ACCOUNT_B64) {
    return JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_B64, 'base64').toString('utf8'));
  }
  if (process.env.GOOGLE_SERVICE_ACCOUNT_PATH) {
    const fs = require('fs');
    return JSON.parse(fs.readFileSync(process.env.GOOGLE_SERVICE_ACCOUNT_PATH, 'utf8'));
  }
  throw new Error('No Google service account credentials found');
}

function getAuth() {
  const credentials = getCredentials();
  return new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive'
    ],
    subject: 'max@sheragency.com'
  });
}

async function getSheetsClient() {
  if (!sheetsClient) {
    const auth = getAuth();
    sheetsClient = google.sheets({ version: 'v4', auth });
  }
  return sheetsClient;
}

/**
 * Get existing sheet ID from env or create if doesn't exist
 */
async function getOrCreateRegistrySheet() {
  const existingId = process.env.GOOGLE_SHEET_ID || process.env.PROJECT_REGISTRY_SHEET_ID;
  if (existingId) return existingId;

  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  // Create a new spreadsheet
  const response = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title: 'Project Registry' },
      sheets: [{
        properties: {
          title: SHEET_NAME,
          gridProperties: { rowCount: 1000, columnCount: 10 }
        }
      }]
    }
  });

  const spreadsheetId = response.data.spreadsheetId;

  // Add headers
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${SHEET_NAME}!A1:G1`,
    valueInputOption: 'RAW',
    requestBody: { values: [COLUMNS] }
  });

  // Share with Max
  const drive = google.drive({ version: 'v3', auth });
  await drive.permissions.create({
    fileId: spreadsheetId,
    requestBody: {
      role: 'writer',
      type: 'user',
      emailAddress: 'max@sheragency.com'
    }
  });

  console.log(`[sheets] Created Project Registry: https://docs.google.com/spreadsheets/d/${spreadsheetId}`);
  return spreadsheetId;
}

/**
 * Ensure the Projects sheet/tab has the correct headers (migrates old format if needed)
 */
async function ensureHeaders(spreadsheetId) {
  const sheets = await getSheetsClient();

  // Get existing sheets
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const sheetTitles = meta.data.sheets.map(s => s.properties.title);

  if (!sheetTitles.includes(SHEET_NAME)) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{
          addSheet: {
            properties: { title: SHEET_NAME }
          }
        }]
      }
    });
  }

  // Check if headers exist and are up to date
  const headerCheck = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAME}!A1:G1`
  });

  const existingHeaders = headerCheck.data.values?.[0] || [];
  const needsUpdate = existingHeaders[0] !== 'Repo Name' || existingHeaders[2] !== 'Client Name';

  if (needsUpdate) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${SHEET_NAME}!A1:G1`,
      valueInputOption: 'RAW',
      requestBody: { values: [COLUMNS] }
    });
    console.log('[sheets] Updated headers in Projects sheet (new columns: Client Name, Slack Channel)');
  }
}

/**
 * Add a new project row to the registry
 * @param {object} opts
 * @param {string} opts.repoName
 * @param {string} opts.url
 * @param {string} [opts.clientName]
 * @param {string} [opts.slackChannelId]
 * @param {string} [opts.createdDate]
 */
async function registerProject({ repoName, url, clientName = '', slackChannelId = '', createdDate }) {
  const spreadsheetId = await getOrCreateRegistrySheet();
  await ensureHeaders(spreadsheetId);
  const sheets = await getSheetsClient();

  const now = new Date().toISOString();
  // Columns: Repo Name, URL, Client Name, Slack Channel, Created Date, Status, Last Activity
  const row = [repoName, url, clientName, slackChannelId, createdDate || now, 'Active', now];

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${SHEET_NAME}!A:G`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] }
  });

  const sheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;
  console.log(`[sheets] Registered project: ${repoName} (client: ${clientName || 'N/A'})`);
  return sheetUrl;
}

/**
 * Update Last Activity for a repo (column G = index 6)
 */
async function updateLastActivity(repoName) {
  const spreadsheetId = await getOrCreateRegistrySheet();
  const sheets = await getSheetsClient();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAME}!A:G`
  });

  const rows = response.data.values || [];
  let rowIndex = -1;

  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === repoName) {
      rowIndex = i;
      break;
    }
  }

  if (rowIndex === -1) {
    console.log(`[sheets] Repo not found in registry: ${repoName} — skipping update`);
    return;
  }

  const now = new Date().toISOString();
  // Last Activity is column G (7th col)
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${SHEET_NAME}!G${rowIndex + 1}`,
    valueInputOption: 'RAW',
    requestBody: { values: [[now]] }
  });

  console.log(`[sheets] Updated last activity for: ${repoName}`);
}

/**
 * Look up the Slack channel ID for a given repo (for PR/push notifications)
 */
async function getChannelForRepo(repoName) {
  try {
    const spreadsheetId = await getOrCreateRegistrySheet();
    const sheets = await getSheetsClient();

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${SHEET_NAME}!A:D`
    });

    const rows = response.data.values || [];
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0] === repoName && rows[i][3]) {
        return rows[i][3]; // Column D = Slack Channel ID
      }
    }
  } catch (err) {
    console.error(`[sheets] Failed to look up channel for ${repoName}:`, err.message);
  }
  return null;
}

module.exports = { registerProject, updateLastActivity, getOrCreateRegistrySheet, getChannelForRepo };
