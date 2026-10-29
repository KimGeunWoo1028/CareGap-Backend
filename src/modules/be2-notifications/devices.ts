import { z } from 'zod';
import { Id } from '../../shared/contracts.js';
import { DevicePlatform } from './types.js';

export const DeviceRegistrationInput = z.object({
  platform: DevicePlatform,
  /** Stable app-install / device identifier from the client (not user_id). */
  installation_id: z.string().min(8).max(200),
  registration_token: z.string().min(20).max(4096),
}).strict();
export type DeviceRegistrationInput = z.infer<typeof DeviceRegistrationInput>;

export type DeviceRegistration = {
  device_registration_id: string;
  user_id: string;
  platform: DevicePlatform;
  installation_id: string;
  registration_token: string;
  active: boolean;
  created_at: string;
  updated_at: string;
  last_active_at: string;
};

export type PublicDeviceRegistration = Omit<DeviceRegistration, 'registration_token'> & {
  registration_token_fingerprint: string;
};

export function fingerprintToken(token: string): string {
  // Short non-reversible-ish display aid; not a security hash of record.
  let hash = 0;
  for (let i = 0; i < token.length; i += 1) hash = ((hash << 5) - hash + token.charCodeAt(i)) | 0;
  return `fp_${(hash >>> 0).toString(16)}`;
}

export function toPublicDevice(device: DeviceRegistration): PublicDeviceRegistration {
  return {
    device_registration_id: device.device_registration_id,
    user_id: device.user_id,
    platform: device.platform,
    installation_id: device.installation_id,
    active: device.active,
    created_at: device.created_at,
    updated_at: device.updated_at,
    last_active_at: device.last_active_at,
    registration_token_fingerprint: fingerprintToken(device.registration_token),
  };
}

export interface DeviceRegistrationRepository {
  upsert(actorUserId: string, input: DeviceRegistrationInput, nowIso: string, newId: () => string): Promise<DeviceRegistration>;
  listActiveByUser(userId: string): Promise<DeviceRegistration[]>;
  deactivate(actorUserId: string, deviceRegistrationId: string, nowIso: string): Promise<
    | { outcome: 'deactivated'; device: DeviceRegistration }
    | { outcome: 'rejected'; reason: 'not_found' | 'owner_mismatch' }
  >;
  deactivateByToken(registrationToken: string, nowIso: string): Promise<number>;
  deactivateAllForUser(actorUserId: string, nowIso: string): Promise<number>;
}

export class MemoryDeviceRegistrationRepository implements DeviceRegistrationRepository {
  private readonly devices: DeviceRegistration[] = [];

  async upsert(actorUserId: string, input: DeviceRegistrationInput, nowIso: string, newId: () => string) {
    const parsed = DeviceRegistrationInput.parse(input);
    const owner = Id.parse(actorUserId);
    const existing = this.devices.find((device) =>
      device.user_id.toLowerCase() === owner.toLowerCase()
      && device.installation_id === parsed.installation_id);
    if (existing) {
      existing.registration_token = parsed.registration_token;
      existing.platform = parsed.platform;
      existing.active = true;
      existing.updated_at = nowIso;
      existing.last_active_at = nowIso;
      return { ...existing };
    }
    // Token rotated onto another user/install: deactivate previous holders of same token.
    for (const device of this.devices) {
      if (device.registration_token === parsed.registration_token && device.active) {
        device.active = false;
        device.updated_at = nowIso;
      }
    }
    const created: DeviceRegistration = {
      device_registration_id: newId(),
      user_id: owner,
      platform: parsed.platform,
      installation_id: parsed.installation_id,
      registration_token: parsed.registration_token,
      active: true,
      created_at: nowIso,
      updated_at: nowIso,
      last_active_at: nowIso,
    };
    this.devices.push(created);
    return { ...created };
  }

  async listActiveByUser(userId: string) {
    return this.devices
      .filter((device) => device.active && device.user_id.toLowerCase() === userId.toLowerCase())
      .map((device) => ({ ...device }));
  }

  async deactivate(actorUserId: string, deviceRegistrationId: string, nowIso: string) {
    const device = this.devices.find((row) =>
      row.device_registration_id.toLowerCase() === deviceRegistrationId.toLowerCase());
    if (!device) return { outcome: 'rejected' as const, reason: 'not_found' as const };
    if (device.user_id.toLowerCase() !== actorUserId.toLowerCase()) {
      return { outcome: 'rejected' as const, reason: 'owner_mismatch' as const };
    }
    device.active = false;
    device.updated_at = nowIso;
    return { outcome: 'deactivated' as const, device: { ...device } };
  }

  async deactivateByToken(registrationToken: string, nowIso: string) {
    let count = 0;
    for (const device of this.devices) {
      if (device.registration_token === registrationToken && device.active) {
        device.active = false;
        device.updated_at = nowIso;
        count += 1;
      }
    }
    return count;
  }

  async deactivateAllForUser(actorUserId: string, nowIso: string) {
    let count = 0;
    for (const device of this.devices) {
      if (device.user_id.toLowerCase() === actorUserId.toLowerCase() && device.active) {
        device.active = false;
        device.updated_at = nowIso;
        count += 1;
      }
    }
    return count;
  }
}
