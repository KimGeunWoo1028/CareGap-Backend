import { z } from 'zod';

export const FirebaseMessagingConfig = z.object({
  /** When true, FCM provider must have credentials; never silently fall back to Mock. */
  FCM_ENABLED: z.enum(['true', 'false']).default('false'),
  FIREBASE_PROJECT_ID: z.string().min(1).optional(),
  /**
   * Absolute path to a service-account JSON file.
   * Prefer GOOGLE_APPLICATION_CREDENTIALS / ADC in real deployments.
   */
  FIREBASE_SERVICE_ACCOUNT_PATH: z.string().min(1).optional(),
  /** Optional inline JSON — never commit real values. Useful only for local sealed secrets. */
  FIREBASE_SERVICE_ACCOUNT_JSON: z.string().min(2).optional(),
}).strict();

export type FirebaseMessagingConfig = z.infer<typeof FirebaseMessagingConfig>;

export type ResolvedFirebaseConfig =
  | { enabled: false }
  | {
    enabled: true;
    projectId: string;
    credentialSource: 'application_default' | 'service_account_path' | 'service_account_json';
    serviceAccountPath?: string;
    serviceAccountJson?: string;
  };

/**
 * Fail-closed: FCM_ENABLED=true without project/credentials is an explicit error.
 * Never auto-switch to Mock to pretend real delivery succeeded.
 */
export function resolveFirebaseConfig(env: NodeJS.ProcessEnv): ResolvedFirebaseConfig {
  const parsed = FirebaseMessagingConfig.parse({
    FCM_ENABLED: env.FCM_ENABLED ?? 'false',
    FIREBASE_PROJECT_ID: env.FIREBASE_PROJECT_ID,
    FIREBASE_SERVICE_ACCOUNT_PATH: env.FIREBASE_SERVICE_ACCOUNT_PATH,
    FIREBASE_SERVICE_ACCOUNT_JSON: env.FIREBASE_SERVICE_ACCOUNT_JSON,
  });

  if (parsed.FCM_ENABLED !== 'true') return { enabled: false };

  const projectId = parsed.FIREBASE_PROJECT_ID ?? env.GOOGLE_CLOUD_PROJECT ?? env.GCLOUD_PROJECT;
  if (!projectId) {
    throw new Error('FCM_CONFIG_MISSING: FIREBASE_PROJECT_ID (or GOOGLE_CLOUD_PROJECT) required when FCM_ENABLED=true');
  }

  if (parsed.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return {
      enabled: true,
      projectId,
      credentialSource: 'service_account_json',
      serviceAccountJson: parsed.FIREBASE_SERVICE_ACCOUNT_JSON,
    };
  }
  if (parsed.FIREBASE_SERVICE_ACCOUNT_PATH || env.GOOGLE_APPLICATION_CREDENTIALS) {
    return {
      enabled: true,
      projectId,
      credentialSource: 'service_account_path',
      serviceAccountPath: parsed.FIREBASE_SERVICE_ACCOUNT_PATH ?? env.GOOGLE_APPLICATION_CREDENTIALS,
    };
  }
  // ADC may still work via metadata server / gcloud — allow with explicit project id.
  return {
    enabled: true,
    projectId,
    credentialSource: 'application_default',
  };
}
