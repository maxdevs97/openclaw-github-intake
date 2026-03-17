/**
 * GitHub App Intake Service
 * Receives webhooks from The-Sher-Agency GitHub org
 * + Web form for manual project registration
 */
require('dotenv').config();

const express = require('express');
const path = require('path');
const { verifySignature, handleRepoCreated, handlePullRequest, handlePush } = require('./webhook-handler');
const { githubRequest } = require('./github-auth');
const { registerProject } = require('./sheets');
const { notifyNewRepo, getSlackChannels } = require('./slack');

const app = express();
const PORT = process.env.PORT || 8080;

// ── Channel cache ─────────────────────────────────────────────────────────────
let channelCache = null;
let channelCacheTime = 0;
const CHANNEL_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// ── Middleware ────────────────────────────────────────────────────────────────

// Capture raw body for HMAC signature verification + parse JSON
// Using express.json with verify callback to capture raw body without stream encoding conflicts
app.use(express.json({
  verify: (req, res, buf) => {
    if (req.path === '/webhook') {
      req.rawBody = buf.toString('utf8');
    }
  }
}));
app.use(express.static(path.join(__dirname, 'public')));

// ── Web form (GET /) ──────────────────────────────────────────────────────────
// Served automatically by static middleware from src/public/index.html

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// ── API: repos ────────────────────────────────────────────────────────────────
app.get('/api/repos', async (req, res) => {
  try {
    const org = 'The-Sher-Agency';
    let repos = [];
    let page = 1;

    while (true) {
      const response = await githubRequest('GET', `/orgs/${org}/repos?per_page=100&page=${page}&sort=updated`);
      const batch = response.data;
      if (!batch.length) break;
      repos = repos.concat(batch.map(r => ({
        name: r.name,
        url: r.html_url,
        private: r.private
      })));
      if (batch.length < 100) break;
      page++;
    }

    // Sort alphabetically
    repos.sort((a, b) => a.name.localeCompare(b.name));
    res.json(repos);
  } catch (err) {
    console.error('[api/repos] Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch repos', detail: err.message });
  }
});

// ── API: channels ─────────────────────────────────────────────────────────────
app.get('/api/channels', async (req, res) => {
  const now = Date.now();

  // Serve from cache if fresh
  if (channelCache && (now - channelCacheTime) < CHANNEL_CACHE_TTL) {
    return res.json(channelCache);
  }

  try {
    const channels = await getSlackChannels();
    channelCache = channels;
    channelCacheTime = now;
    res.json(channels);
  } catch (err) {
    console.error('[api/channels] Error:', err.message);
    // Return stale cache if available
    if (channelCache) {
      console.log('[api/channels] Returning stale cache due to error');
      return res.json(channelCache);
    }
    res.status(500).json({ error: 'Failed to fetch Slack channels', detail: err.message });
  }
});

// ── POST /register ────────────────────────────────────────────────────────────
app.post('/register', async (req, res) => {
  const { repo, clientName, channelId, channelName } = req.body;

  if (!repo || !clientName || !channelId) {
    return res.status(400).json({ error: 'Missing required fields: repo, clientName, channelId' });
  }

  const org = 'The-Sher-Agency';
  const results = { success: false, steps: {} };

  try {
    // 1. Make repo private
    try {
      await githubRequest('PATCH', `/repos/${org}/${repo}`, { private: true });
      results.steps.private = 'ok';
      console.log(`[register] Made repo private: ${repo}`);
    } catch (err) {
      // Non-fatal — repo may already be private
      results.steps.private = `warn: ${err.message}`;
      console.warn(`[register] Could not make repo private (may already be): ${err.message}`);
    }

    // 2. Enable branch protection on main (with retry)
    let branchProtectionApplied = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await githubRequest('PUT', `/repos/${org}/${repo}/branches/main/protection`, {
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
        results.steps.branchProtection = 'ok';
        branchProtectionApplied = true;
        console.log(`[register] Branch protection enabled: ${repo}`);
        break;
      } catch (err) {
        if (attempt < 3) {
          console.log(`[register] Branch protection attempt ${attempt} failed, retrying in 3s…`);
          await new Promise(r => setTimeout(r, 3000));
        } else {
          results.steps.branchProtection = `warn: ${err.message}`;
          console.warn(`[register] Branch protection failed after 3 attempts: ${err.message}`);
        }
      }
    }

    // 3. Get repo details for URL
    let repoUrl = `https://github.com/${org}/${repo}`;
    try {
      const repoInfo = await githubRequest('GET', `/repos/${org}/${repo}`);
      repoUrl = repoInfo.data.html_url;
    } catch (_) {}

    // 4. Register in Google Sheets
    let sheetUrl = null;
    try {
      sheetUrl = await registerProject({
        repoName: repo,
        url: repoUrl,
        clientName,
        slackChannelId: channelId,
        createdDate: new Date().toISOString()
      });
      results.steps.sheets = 'ok';
      console.log(`[register] Registered in Sheets: ${repo}`);
    } catch (err) {
      results.steps.sheets = `warn: ${err.message}`;
      console.warn(`[register] Sheets registration failed: ${err.message}`);
    }

    // 5. Send Slack notification to selected channel
    try {
      await notifyNewRepo({
        repoName: repo,
        repoUrl,
        orgName: org,
        clientName,
        sheetUrl,
        branchProtection: branchProtectionApplied,
        targetChannelId: channelId
      });
      results.steps.slack = 'ok';
    } catch (err) {
      results.steps.slack = `warn: ${err.message}`;
      console.warn(`[register] Slack notification failed: ${err.message}`);
    }

    results.success = true;
    results.sheetUrl = sheetUrl;
    res.json(results);

  } catch (err) {
    console.error('[register] Fatal error:', err.message);
    res.status(500).json({ error: err.message, steps: results.steps });
  }
});

// ── GitHub webhook endpoint ───────────────────────────────────────────────────
app.post('/webhook', async (req, res) => {
  // Verify signature
  if (!verifySignature(req)) {
    console.warn('[webhook] Invalid signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const event = req.headers['x-github-event'];
  const deliveryId = req.headers['x-github-delivery'];
  const payload = req.body;

  console.log(`[webhook] Received: ${event} (delivery: ${deliveryId})`);

  // Respond quickly to avoid GitHub timeout
  res.status(200).json({ status: 'processing', event, deliveryId });

  // Process async
  try {
    if (event === 'repository' && payload.action === 'created') {
      await handleRepoCreated(payload);
    } else if (event === 'pull_request') {
      await handlePullRequest(payload);
    } else if (event === 'push') {
      await handlePush(payload);
    } else {
      console.log(`[webhook] Unhandled event: ${event}/${payload.action}`);
    }
  } catch (err) {
    console.error(`[webhook] Error processing ${event}:`, err);
  }
});

// ── Start server ──────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[server] GitHub Intake Service running on port ${PORT}`);
  console.log(`[server] Web form: http://localhost:${PORT}/`);
  console.log(`[server] Webhook endpoint: POST /webhook`);
  console.log(`[server] App ID: ${process.env.GITHUB_APP_ID}`);
  console.log(`[server] Installation ID: ${process.env.GITHUB_INSTALLATION_ID}`);
  console.log(`[server] Webhook secret configured: ${!!(process.env.GITHUB_WEBHOOK_SECRET || process.env.WEBHOOK_SECRET)}`);
  console.log(`[server] Slack configured: ${!!(process.env.SLACK_BOT_TOKEN || process.env.SLACK_WEBHOOK_URL)}`);
  console.log(`[server] Google Sheets configured: ${!!(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_SERVICE_ACCOUNT_B64 || process.env.GOOGLE_SERVICE_ACCOUNT_PATH)}`);
  console.log(`[server] Sheet ID: ${process.env.GOOGLE_SHEET_ID || 'will create on first use'}`);
});
