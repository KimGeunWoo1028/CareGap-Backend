import type { PushErrorClass } from './types.js';

const PERMANENT_CODES = new Set([
  'messaging/invalid-registration-token',
  'messaging/registration-token-not-registered',
  'messaging/invalid-argument',
  'messaging/invalid-recipient',
  'messaging/invalid-payload',
  'messaging/invalid-data-payload-key',
  'messaging/payload-size-limit-exceeded',
  'messaging/invalid-package-name',
  'messaging/mismatched-credential',
  'INVALID_REGISTRATION_TOKEN',
  'REGISTRATION_TOKEN_NOT_REGISTERED',
  'INSTALLATION_ID_NOT_REGISTERED',
  'INVALID_ARGUMENT',
  'PAYLOAD_SIZE_LIMIT_EXCEEDED',
]);

const TRANSIENT_CODES = new Set([
  'messaging/server-unavailable',
  'messaging/internal-error',
  'messaging/message-rate-exceeded',
  'messaging/device-message-rate-exceeded',
  'SERVER_UNAVAILABLE',
  'INTERNAL_ERROR',
  'MESSAGE_RATE_EXCEEDED',
  'DEVICE_MESSAGE_RATE_EXCEEDED',
  'UNAVAILABLE',
  'INTERNAL',
  'RESOURCE_EXHAUSTED',
  'QUOTA_EXCEEDED',
]);

const AUTH_CODES = new Set([
  'messaging/authentication-error',
  'messaging/third-party-auth-error',
  'messaging/invalid-apns-credentials',
  'THIRD_PARTY_AUTH_ERROR',
  'UNAUTHENTICATED',
  'FCM_CONFIG_MISSING',
]);

export function classifyFcmErrorCode(code: string): {
  error_class: PushErrorClass;
  retryable: boolean;
  deactivate_device: boolean;
} {
  const normalized = code.trim();
  if (AUTH_CODES.has(normalized) || normalized.includes('authentication') || normalized.includes('UNAUTHENTICATED')) {
    return { error_class: 'auth_config', retryable: false, deactivate_device: false };
  }
  if (
    normalized.includes('registration-token-not-registered')
    || normalized.includes('REGISTRATION_TOKEN_NOT_REGISTERED')
    || normalized.includes('UNREGISTERED')
    || normalized.includes('NotRegistered')
  ) {
    return { error_class: 'unregistered', retryable: false, deactivate_device: true };
  }
  if (
    normalized.includes('invalid-registration-token')
    || normalized.includes('INVALID_REGISTRATION_TOKEN')
    || normalized.includes('InvalidRegistration')
  ) {
    return { error_class: 'invalid_token', retryable: false, deactivate_device: true };
  }
  if (
    normalized.includes('payload')
    || normalized.includes('PAYLOAD')
    || normalized.includes('MessageTooBig')
  ) {
    return { error_class: 'payload', retryable: false, deactivate_device: false };
  }
  if (
    TRANSIENT_CODES.has(normalized)
    || normalized.includes('unavailable')
    || normalized.includes('rate-exceeded')
    || normalized.includes('RESOURCE_EXHAUSTED')
  ) {
    return {
      error_class: normalized.includes('rate') || normalized.includes('QUOTA') || normalized.includes('RESOURCE')
        ? 'rate_limited'
        : 'transient',
      retryable: true,
      deactivate_device: false,
    };
  }
  if (PERMANENT_CODES.has(normalized)) {
    return { error_class: 'unknown', retryable: false, deactivate_device: false };
  }
  return { error_class: 'unknown', retryable: true, deactivate_device: false };
}
