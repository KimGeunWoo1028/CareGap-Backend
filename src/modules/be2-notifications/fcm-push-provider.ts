import { readFile } from 'node:fs/promises';
import {
  applicationDefault,
  cert,
  getApps,
  initializeApp,
  type App,
  type ServiceAccount,
} from 'firebase-admin/app';
import { getMessaging, type MulticastMessage } from 'firebase-admin/messaging';
import type { ResolvedFirebaseConfig } from './firebase-config.js';
import { classifyFcmErrorCode } from './push-errors.js';
import type { PushProvider, PushSendRequest, PushSendResponse, PushTargetResult } from './push-provider.js';

type MessagingLike = {
  sendEachForMulticast(message: MulticastMessage, dryRun?: boolean): Promise<{
    responses: Array<{ success: boolean; messageId?: string; error?: { code: string; message?: string } }>;
  }>;
};

/**
 * Real FCM provider using firebase-admin Messaging.sendEachForMulticast.
 * Does not run inside DB transactions. Partial success is recorded per device.
 */
export class FcmPushProvider implements PushProvider {
  readonly name = 'fcm' as const;
  private readonly app: App;
  private readonly messaging: MessagingLike;

  private constructor(app: App, messaging: MessagingLike) {
    this.app = app;
    this.messaging = messaging;
  }

  static async create(config: Extract<ResolvedFirebaseConfig, { enabled: true }>): Promise<FcmPushProvider> {
    const existing = getApps().find((app) => app.name === 'caregap-notifications');
    if (existing) {
      return new FcmPushProvider(existing, getMessaging(existing));
    }

    let credential;
    if (config.credentialSource === 'service_account_json' && config.serviceAccountJson) {
      const parsed = JSON.parse(config.serviceAccountJson) as ServiceAccount;
      credential = cert(parsed);
    } else if (config.credentialSource === 'service_account_path' && config.serviceAccountPath) {
      const raw = await readFile(config.serviceAccountPath, 'utf8');
      const parsed = JSON.parse(raw) as ServiceAccount;
      credential = cert(parsed);
    } else {
      credential = applicationDefault();
    }

    const app = initializeApp({
      credential,
      projectId: config.projectId,
    }, 'caregap-notifications');

    return new FcmPushProvider(app, getMessaging(app));
  }

  /** Test seam: inject a fake messaging client without contacting Firebase. */
  static forMessaging(messaging: MessagingLike): FcmPushProvider {
    const stubApp = { name: 'caregap-notifications-test' } as App;
    return new FcmPushProvider(stubApp, messaging);
  }

  async send(request: PushSendRequest): Promise<PushSendResponse> {
    if (request.targets.length === 0) return { results: [] };

    const data: Record<string, string> = {
      event_id: request.payload.data.event_id,
      notification_id: request.payload.data.notification_id,
      category: request.payload.data.category,
      destination_type: request.payload.data.destination_type,
    };
    if (request.payload.data.destination_resource_id) {
      data.destination_resource_id = request.payload.data.destination_resource_id;
    }

    const message: MulticastMessage = {
      tokens: request.targets.map((target) => target.registration_token),
      notification: {
        title: request.payload.title,
        body: request.payload.body,
      },
      data,
      android: {
        priority: 'high',
        notification: {
          title: request.payload.title,
          body: request.payload.body,
        },
      },
      apns: {
        payload: {
          aps: {
            alert: {
              title: request.payload.title,
              body: request.payload.body,
            },
            sound: 'default',
          },
        },
      },
    };

    const batch = await this.messaging.sendEachForMulticast(message);
    const results: PushTargetResult[] = request.targets.map((target, index) => {
      const response = batch.responses[index];
      if (!response) {
        return {
          device_registration_id: target.device_registration_id,
          result: {
            outcome: 'failure',
            error_class: 'unknown',
            error_code: 'MISSING_RESPONSE',
            retryable: true,
          },
        };
      }
      if (response.success) {
        return {
          device_registration_id: target.device_registration_id,
          result: {
            outcome: 'success',
            ...(response.messageId ? { provider_message_id: response.messageId } : {}),
          },
        };
      }
      const code = response.error?.code ?? 'UNKNOWN_ERROR';
      const classified = classifyFcmErrorCode(code);
      return {
        device_registration_id: target.device_registration_id,
        result: {
          outcome: 'failure',
          error_class: classified.error_class,
          error_code: code,
          retryable: classified.retryable,
          deactivate_device: classified.deactivate_device,
        },
      };
    });

    return { results };
  }
}

/**
 * Creates the configured provider. Throws if FCM is enabled but cannot be constructed.
 * Callers must pass MockPushProvider explicitly for tests — never auto-swap.
 */
export async function createConfiguredPushProvider(
  config: ResolvedFirebaseConfig,
): Promise<PushProvider> {
  if (!config.enabled) {
    throw new Error('FCM_DISABLED: create MockPushProvider explicitly for non-FCM environments');
  }
  return FcmPushProvider.create(config);
}
