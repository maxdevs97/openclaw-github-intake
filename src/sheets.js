/**
 * Google Sheets integration for Project Registry
 */
const { google } = require('googleapis');

let sheetsClient = null;
let driveClient = null;

const SHEET_NAME = 'Projects';
const COLUMNS = ['Repo Name', 'URL', 'Created Date', 'Status', 'Last Activity'];

function getCredentials() {
  // Support multiple env var formats
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
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
  // If we have an existing sheet ID, use it
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
    range: `${SHEET_NAME}!A1:E1`,
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
 * Ensure the Projects sheet/tab has headers
 */
async function ensureHeaders(spreadsheetId) {
  const sheets = await getSheetsClient();

  // Get existing sheets
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const sheetTitles = meta.data.sheets.map(s => s.properties.title);

  if (!sheetTitles.includes(SHEET_NAME)) {
    // Add the Projects sheet
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

  // Check if headers exist
  const headerCheck = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAME}!A1:E1`
  });

  if (!headerCheck.data.values || headerCheck.data.values[0]?.[0] !== 'Repo Name') {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${SHEET_NAME}!A1:E1`,
      valueInputOption: 'RAW',
      requestBody: { values: [COLUMNS] }
    });
    console.log('[sheets] Added headers to Projects sheet');
  }
}

/**
 * Add a new project row to the registry
 */
async function registerProject({ repoName, url, createdDate }) {
  const spreadsheetId = await getOrCreateRegistrySheet();
  await ensureHeaders(spreadsheetId);
  const sheets = await getSheetsClient();

  const now = new Date().toISOString();
  const row = [repoName, url, createdDate || now, 'Active', now];

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${SHEET_NAME}!A:E`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] }
  });

  const sheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;
  console.log(`[sheets] Registered project: ${repoName}`);
  return sheetUrl;
}

/**
 * Update Last Activity for a repo
 */
async function updateLastActivity(repoName) {
  const spreadsheetId = await getOrCreateRegistrySheet();
  const sheets = await getSheetsClient();

  // Find the row with this repo name
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAME}!A:E`
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
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${SHEET_NAME}!E${rowIndex + 1}`,
    valueInputOption: 'RAW',
    requestBody: { values: [[now]] }
  });

  console.log(`[sheets] Updated last activity for: ${repoName}`);
}

module.exports = { registerProject, updateLastActivity, getOrCreateRegistrySheet };
