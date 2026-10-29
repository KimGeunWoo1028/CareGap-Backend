import type { DeliveryAttemptResult, DevicePlatform } from './types.js';
import type { BuiltPushPayload } from './payload.js';

export type PushTarget = {
  device_registration_id: string;
  platform: DevicePlatform;
  /** FCM registration token. Treat as secret-ish; never log full value. */
  registration_token: string;
};

export type PushSendRequest = {
  targets: PushTarget[];
  payload: BuiltPushPayload;
};

export type PushTargetResult = {
  device_registration_id: string;
  result: DeliveryAttemptResult;
};

export type PushSendResponse = {
  results: PushTargetResult[];
};

export interface PushProvider {
  readonly name: 'fcm' | 'mock';
  send(request: PushSendRequest): Promise<PushSendResponse>;
}

export function maskToken(token: string): string {
  if (token.length <= 8) return '****';
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}
