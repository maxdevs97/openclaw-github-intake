/**
 * Google Sheets integration for Project Registry
 */
const { google } = require('googleapis');

let sheetsClient = null;
let registrySpreadsheetId = process.env.PROJECT_REGISTRY_SHEET_ID || null;

const SHEET_NAME = 'Project Registry';
const COLUMNS = ['Repo Name', 'URL', 'Created Date', 'Status', 'Last Activity'];

function getAuth() {
  let credentials;
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  } else if (process.env.GOOGLE_SERVICE_ACCOUNT_PATH) {
    const fs = require('fs');
    credentials = JSON.parse(fs.readFileSync(process.env.GOOGLE_SERVICE_ACCOUNT_PATH, 'utf8'));
  } else {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_SERVICE_ACCOUNT_PATH must be set');
  }
  return new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'],
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
 * Create the Project Registry spreadsheet if it doesn't exist
 */
async function ensureRegistrySheet() {
  if (registrySpreadsheetId) return registrySpreadsheetId;

  const sheets = await getSheetsClient();

  // Create a new spreadsheet
  const response = await sheets.spreadsheets.create({
    requestBody: {
      properties: {
        title: 'Project Registry'
      },
      sheets: [{
        properties: {
          title: SHEET_NAME,
          gridProperties: { rowCount: 1000, columnCount: 10 }
        }
      }]
    }
  });

  const spreadsheetId = response.data.spreadsheetId;
  const spreadsheetUrl = response.data.spreadsheetUrl;

  // Add headers
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${SHEET_NAME}!A1:E1`,
    valueInputOption: 'RAW',
    requestBody: {
      values: [COLUMNS]
    }
  });

  // Bold the header row
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{
        repeatCell: {
          range: {
            sheetId: 0,
            startRowIndex: 0,
            endRowIndex: 1
          },
          cell: {
            userEnteredFormat: {
              textFormat: { bold: true },
              backgroundColor: { red: 0.2, green: 0.2, blue: 0.6 }
            }
          },
          fields: 'userEnteredFormat(textFormat,backgroundColor)'
        }
      }]
    }
  });

  // Share with Max
  const auth = getAuth();
  const drive = google.drive({ version: 'v3', auth });
  await drive.permissions.create({
    fileId: spreadsheetId,
    requestBody: {
      role: 'writer',
      type: 'user',
      emailAddress: 'max@sheragency.com'
    }
  });

  console.log(`[sheets] Created Project Registry: ${spreadsheetUrl}`);

  // Store the ID for future use
  registrySpreadsheetId = spreadsheetId;
  process.env.PROJECT_REGISTRY_SHEET_ID = spreadsheetId;

  return spreadsheetId;
}

/**
 * Add a new project row to the registry
 */
async function registerProject({ repoName, url, createdDate }) {
  const spreadsheetId = await ensureRegistrySheet();
  const sheets = await getSheetsClient();

  const now = new Date().toISOString();
  const row = [repoName, url, createdDate || now, 'Active', now];

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${SHEET_NAME}!A:E`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [row]
    }
  });

  const sheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;
  console.log(`[sheets] Registered project: ${repoName}`);
  return sheetUrl;
}

/**
 * Update Last Activity for a repo
 */
async function updateLastActivity(repoName) {
  const spreadsheetId = await ensureRegistrySheet();
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
    console.log(`[sheets] Repo not found in registry: ${repoName}`);
    return;
  }

  const now = new Date().toISOString();
  // Update column E (Last Activity) — rowIndex is 0-based, sheets is 1-based
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${SHEET_NAME}!E${rowIndex + 1}`,
    valueInputOption: 'RAW',
    requestBody: {
      values: [[now]]
    }
  });

  console.log(`[sheets] Updated last activity for: ${repoName}`);
}

module.exports = { ensureRegistrySheet, registerProject, updateLastActivity };
