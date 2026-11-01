import { handleResendHumanNotificationWebhook } from '../server/resendHumanNotificationWebhook.js';

export async function POST(request: Request): Promise<Response> {
  return handleResendHumanNotificationWebhook(request);
}
