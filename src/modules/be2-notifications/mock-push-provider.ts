import type { PushProvider, PushSendRequest, PushSendResponse } from './push-provider.js';
import type { DeliveryAttemptResult } from './types.js';

export type MockPushBehavior =
  | { mode: 'success' }
  | { mode: 'fail_all'; result: Extract<DeliveryAttemptResult, { outcome: 'failure' }> }
  | {
    mode: 'per_device';
    results: Record<string, DeliveryAttemptResult>;
    defaultResult?: DeliveryAttemptResult;
  };

/**
 * Test-only provider. Never treat Mock success as production Firebase delivery.
 */
export class MockPushProvider implements PushProvider {
  readonly name = 'mock' as const;
  readonly sent: PushSendRequest[] = [];
  behavior: MockPushBehavior = { mode: 'success' };

  async send(request: PushSendRequest): Promise<PushSendResponse> {
    this.sent.push(request);
    const behavior = this.behavior;
    if (behavior.mode === 'success') {
      return {
        results: request.targets.map((target) => ({
          device_registration_id: target.device_registration_id,
          result: { outcome: 'success', provider_message_id: `mock-${target.device_registration_id}` },
        })),
      };
    }
    if (behavior.mode === 'fail_all') {
      return {
        results: request.targets.map((target) => ({
          device_registration_id: target.device_registration_id,
          result: behavior.result,
        })),
      };
    }
    const fallback: DeliveryAttemptResult = behavior.defaultResult
      ?? { outcome: 'success', provider_message_id: 'mock-default' };
    return {
      results: request.targets.map((target) => ({
        device_registration_id: target.device_registration_id,
        result: behavior.results[target.device_registration_id] ?? fallback,
      })),
    };
  }

  reset(): void {
    this.sent.length = 0;
    this.behavior = { mode: 'success' };
  }
}
