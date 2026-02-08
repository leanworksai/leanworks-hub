/**
 * Webhook signing (HMAC-SHA256) for outbound requests to agent webhooks.
 * Developer provides a secret at onboarding; we sign the body so the agent can verify the request.
 */

import crypto from 'crypto';

const SIGNATURE_HEADER = 'x-leanworks-signature';
const SIGNATURE_PREFIX = 'sha256=';

let secretFetcher: ((agentId: string) => Promise<string | null>) | null = null;

/**
 * Set the function used to resolve an agent's webhook signing secret (e.g. from Secret Manager).
 * Called once at server startup.
 */
export function setWebhookSigningSecretFetcher(
  fn: (agentId: string) => Promise<string | null>
): void {
  secretFetcher = fn;
}

/**
 * Get the webhook signing secret for an agent, if configured.
 */
export async function getWebhookSigningSecret(agentId: string): Promise<string | null> {
  if (!secretFetcher) return null;
  return secretFetcher(agentId);
}

/**
 * Compute HMAC-SHA256 signature of the request body (industry standard for webhook verification).
 * Returns the hex string (prefixed with "sha256=" for the header).
 */
export function signPayload(secret: string, body: string): string {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(body, 'utf8');
  return SIGNATURE_PREFIX + hmac.digest('hex');
}

/**
 * Build headers for an outbound webhook request, including signature if secret is available.
 */
export async function buildSignedWebhookHeaders(
  agentId: string,
  body: string,
  extraHeaders: Record<string, string> = {}
): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...extraHeaders,
  };

  const secret = await getWebhookSigningSecret(agentId);
  if (secret) {
    headers[SIGNATURE_HEADER] = signPayload(secret, body);
  }

  return headers;
}

export { SIGNATURE_HEADER, SIGNATURE_PREFIX };
