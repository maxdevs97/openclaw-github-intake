/**
 * Slack Interactivity Middleware Router
 * 
 * Central handler for all Slack interactive button clicks, modal submissions,
 * and select menu actions from any app.
 * 
 * Convention: action_id format is "<namespace>:<action>"
 *   e.g. "github:merge_pr", "copy:approve", "qa:mark_fixed"
 * 
 * To add a new handler:
 *   router.register('myapp', async (action, payload) => { ... })
 * 
 * Or register a specific action:
 *   router.registerAction('myapp:do_thing', async (action, payload) => { ... })
 */

const handlers = {};       // namespace-level handlers
const actionHandlers = {}; // specific action_id handlers

/**
 * Register a handler for all actions in a namespace
 * e.g. register('github', handler) catches 'github:*'
 */
function register(namespace, handler) {
  handlers[namespace] = handler;
  console.log(`[slack-router] Registered handler for namespace: ${namespace}`);
}

/**
 * Register a handler for a specific action_id
 * e.g. registerAction('github:merge_pr', handler)
 */
function registerAction(actionId, handler) {
  actionHandlers[actionId] = handler;
  console.log(`[slack-router] Registered handler for action: ${actionId}`);
}

/**
 * Route an incoming Slack interaction payload to the correct handler
 */
async function route(payload) {
  const actions = payload.actions || [];

  for (const action of actions) {
    const actionId = action.action_id || '';
    const [namespace, ...rest] = actionId.split(':');

    console.log(`[slack-router] Routing action: ${actionId} (namespace: ${namespace})`);

    // Try exact action match first
    if (actionHandlers[actionId]) {
      try {
        await actionHandlers[actionId](action, payload);
      } catch (err) {
        console.error(`[slack-router] Handler error for ${actionId}:`, err.message);
        await sendErrorToUser(payload, actionId, err.message);
      }
      continue;
    }

    // Try namespace match
    if (namespace && handlers[namespace]) {
      try {
        await handlers[namespace](action, payload);
      } catch (err) {
        console.error(`[slack-router] Namespace handler error for ${namespace}:`, err.message);
        await sendErrorToUser(payload, actionId, err.message);
      }
      continue;
    }

    // Legacy: no namespace separator — try exact match on full action_id
    if (actionHandlers[actionId]) {
      try {
        await actionHandlers[actionId](action, payload);
      } catch (err) {
        console.error(`[slack-router] Legacy handler error for ${actionId}:`, err.message);
      }
      continue;
    }

    console.warn(`[slack-router] No handler found for action: ${actionId}`);
  }
}

/**
 * Send an error message back to the user in Slack
 */
async function sendErrorToUser(payload, actionId, errorMsg) {
  try {
    const { sendSlackMessage } = require('./slack');
    const channel = payload.channel?.id;
    if (channel) {
      await sendSlackMessage(`❌ Action \`${actionId}\` failed: ${errorMsg}`, null, channel);
    }
  } catch (e) {
    console.error('[slack-router] Could not send error message:', e.message);
  }
}

module.exports = { register, registerAction, route };
