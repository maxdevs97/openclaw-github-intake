/**
 * GitHub webhook event handlers
 */
const crypto = require('crypto');
const { githubRequest } = require('./github-auth');
const { registerProject, updateLastActivity } = require('./sheets');
const { notifyNewRepo, notifyPRActivity } = require('./slack');

/**
 * Verify GitHub webhook signature
 */
function verifySignature(req) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET || process.env.WEBHOOK_SECRET;
  if (!secret) return true; // Skip verification if no secret configured

  const signature = req.headers['x-hub-signature-256'];
  if (!signature) return false;

  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(req.rawBody || '');
  const digest = `sha256=${hmac.digest('hex')}`;

  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest));
}

/**
 * Handle repository.created event
 */
async function handleRepoCreated(payload) {
  const repo = payload.repository;
  const orgName = payload.organization?.login || repo.owner?.login;

  console.log(`[webhook] New repo created: ${orgName}/${repo.name}`);

  // 1. Ensure repo is private
  if (!repo.private) {
    try {
      await githubRequest('PATCH', `/repos/${orgName}/${repo.name}`, { private: true });
      console.log(`[webhook] Made repo private: ${repo.name}`);
    } catch (err) {
      console.error(`[webhook] Failed to make repo private: ${err.message}`);
    }
  }

  // 2. Enable branch protection on main (with retry - branch may not exist yet)
  let branchProtectionApplied = false;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await githubRequest('PUT', `/repos/${orgName}/${repo.name}/branches/main/protection`, {
        required_status_checks: null,
        enforce_admins: false,
        required_pull_request_reviews: {
          required_approving_review_count: 1,
          dismiss_stale_reviews: false,
          require_code_owner_reviews: false
        },
        restrictions: null,
        allow_force_pushes: false,
        allow_deletions: false
      });
      console.log(`[webhook] Branch protection enabled on main: ${repo.name}`);
      branchProtectionApplied = true;
      break;
    } catch (err) {
      if (attempt < 3) {
        console.log(`[webhook] Branch protection attempt ${attempt} failed, retrying in 5s...`);
        await new Promise(r => setTimeout(r, 5000));
      } else {
        console.error(`[webhook] Failed to set branch protection after 3 attempts: ${err.message}`);
      }
    }
  }

  // 3. Register in Google Sheet
  let sheetUrl = process.env.PROJECT_REGISTRY_SHEET_ID
    ? `https://docs.google.com/spreadsheets/d/${process.env.PROJECT_REGISTRY_SHEET_ID}`
    : 'https://docs.google.com/spreadsheets';

  try {
    sheetUrl = await registerProject({
      repoName: repo.name,
      url: repo.html_url,
      createdDate: repo.created_at
    });
  } catch (err) {
    console.error(`[webhook] Failed to register in Google Sheet: ${err.message}`);
  }

  // 4. Send Slack notification
  await notifyNewRepo({
    repoName: repo.name,
    repoUrl: repo.html_url,
    orgName,
    creatorLogin: payload.sender?.login,
    sheetUrl
  });
}

/**
 * Handle pull_request events
 */
async function handlePullRequest(payload) {
  const { action, pull_request: pr, repository: repo } = payload;
  const orgName = payload.organization?.login || repo.owner?.login;

  // Only handle opened and closed (merged)
  if (!['opened', 'closed'].includes(action)) return;
  if (action === 'closed' && !pr.merged) return; // Ignore closed-without-merge

  console.log(`[webhook] PR ${action}: ${repo.name}#${pr.number}`);

  // Update Google Sheet
  try {
    await updateLastActivity(repo.name);
  } catch (err) {
    console.error(`[webhook] Failed to update sheet: ${err.message}`);
  }

  // Send Slack notification
  await notifyPRActivity({
    action,
    repoName: repo.name,
    prTitle: pr.title,
    prUrl: pr.html_url,
    prNumber: pr.number,
    author: pr.user?.login,
    orgName
  });
}

/**
 * Handle push events
 */
async function handlePush(payload) {
  const repo = payload.repository;
  const orgName = payload.organization?.login || repo.owner?.login;
  const branch = payload.ref?.replace('refs/heads/', '');

  console.log(`[webhook] Push to ${orgName}/${repo.name}:${branch} by ${payload.pusher?.name}`);

  // Update last activity in the sheet
  try {
    await updateLastActivity(repo.name);
  } catch (err) {
    console.error(`[webhook] Failed to update sheet on push: ${err.message}`);
  }
}

module.exports = { verifySignature, handleRepoCreated, handlePullRequest, handlePush };
