/**
 * Slack notifications
 */
const axios = require('axios');

async function sendSlackMessage(text, blocks = null) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;

  if (!webhookUrl) {
    console.log('[slack] No webhook URL configured, skipping notification');
    return;
  }

  const payload = { text };
  if (blocks) payload.blocks = blocks;

  try {
    await axios.post(webhookUrl, payload);
    console.log('[slack] Notification sent');
  } catch (err) {
    console.error('[slack] Failed to send notification:', err.message);
  }
}

async function notifyNewRepo({ repoName, repoUrl, orgName, creatorLogin, sheetUrl }) {
  const blocks = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: '🚀 New Repository Created'
      }
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*Repo:*\n<${repoUrl}|${orgName}/${repoName}>`
        },
        {
          type: 'mrkdwn',
          text: `*Created by:*\n${creatorLogin || 'Unknown'}`
        }
      ]
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `Branch protection enabled on \`main\` • Private • <${sheetUrl}|View Project Registry>`
      }
    }
  ];

  await sendSlackMessage(`New repo created: ${orgName}/${repoName}`, blocks);
}

async function notifyPRActivity({ action, repoName, prTitle, prUrl, prNumber, author, orgName }) {
  const emoji = action === 'closed' ? '✅' : '🔔';
  const actionLabel = action === 'closed' ? 'PR Merged' : 'PR Opened';

  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${emoji} *${actionLabel}* in <https://github.com/${orgName}/${repoName}|${orgName}/${repoName}>\n<${prUrl}|#${prNumber}: ${prTitle}> by *${author}*`
      }
    }
  ];

  await sendSlackMessage(`${actionLabel}: ${repoName} #${prNumber}`, blocks);
}

module.exports = { sendSlackMessage, notifyNewRepo, notifyPRActivity };
