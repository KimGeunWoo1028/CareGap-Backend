import { z } from 'zod';
import {
  DestinationType,
  LOCK_SCREEN_DEFAULT_BODY,
  LOCK_SCREEN_DEFAULT_TITLE,
  LockScreenPolicyMode,
  NotificationCategory,
  NotificationDestination,
  type DomainNotificationEvent,
} from './types.js';

const SENSITIVE_KEY = /password|secret|token|ssn|resident|medical|medication|diagnosis|analysis_detail|record_text|body_full|phone|email/i;
const SENSITIVE_VALUE = /\d{6}-\d{7}|\b\d{13}\b|주민|복약|진단|상담\s*원문|분석\s*상세/;

export const SafePushData = z.object({
  event_id: z.string().uuid(),
  notification_id: z.string().uuid(),
  category: NotificationCategory,
  destination_type: DestinationType,
  destination_resource_id: z.string().uuid().optional(),
}).strict();
export type SafePushData = z.infer<typeof SafePushData>;

export type BuiltPushPayload = {
  title: string;
  body: string;
  data: SafePushData;
  policy_mode: LockScreenPolicyMode;
};

function assertNoSensitiveData(data: Record<string, string>): void {
  for (const [key, value] of Object.entries(data)) {
    if (SENSITIVE_KEY.test(key)) throw new Error('SENSITIVE_PAYLOAD_KEY');
    if (SENSITIVE_VALUE.test(value)) throw new Error('SENSITIVE_PAYLOAD_VALUE');
  }
}

function estimatePayloadBytes(title: string, body: string, data: Record<string, string>): number {
  return Buffer.byteLength(JSON.stringify({ title, body, data }), 'utf8');
}

/**
 * Builds lock-screen safe FCM notification + data.
 * Conservative (PROVISIONAL) default never includes event-specific clinical text.
 */
export function buildSafePushPayload(input: {
  notification_id: string;
  event: DomainNotificationEvent;
  category: NotificationCategory;
  destination: NotificationDestination;
  preferenceAllowsRichLockScreen?: boolean;
  policy_mode?: LockScreenPolicyMode;
}): BuiltPushPayload {
  const mode = input.policy_mode ?? 'conservative';
  const richAllowed = mode === 'provisional_rich' && input.preferenceAllowsRichLockScreen === true;
  const title = LOCK_SCREEN_DEFAULT_TITLE;
  const body = richAllowed
    ? categoryHint(input.category)
    : LOCK_SCREEN_DEFAULT_BODY;

  const dataRaw: Record<string, string> = {
    event_id: input.event.event_id,
    notification_id: input.notification_id,
    category: input.category,
    destination_type: input.destination.type,
  };
  if (input.destination.resource_id) {
    dataRaw.destination_resource_id = input.destination.resource_id;
  }

  assertNoSensitiveData(dataRaw);
  if (estimatePayloadBytes(title, body, dataRaw) > 4096) {
    throw new Error('PAYLOAD_SIZE_LIMIT_EXCEEDED');
  }

  const data = SafePushData.parse({
    event_id: dataRaw.event_id,
    notification_id: dataRaw.notification_id,
    category: dataRaw.category,
    destination_type: dataRaw.destination_type,
    ...(dataRaw.destination_resource_id
      ? { destination_resource_id: dataRaw.destination_resource_id }
      : {}),
  });

  return { title, body, data, policy_mode: mode };
}

function categoryHint(category: NotificationCategory): string {
  switch (category) {
    case 'appointment':
      return '예약 관련 알림이 있습니다.';
    case 'consultation':
      return '상담 관련 알림이 있습니다.';
    case 'message':
      return '새 메시지 알림이 있습니다.';
    case 'analysis':
      return '분석 관련 알림이 있습니다.';
    case 'welfare_review':
      return '자격 심사 관련 알림이 있습니다.';
    case 'reminder':
      return '일정 알림이 있습니다.';
    case 'admin':
      return '관리자 알림이 있습니다.';
    default:
      return LOCK_SCREEN_DEFAULT_BODY;
  }
}

/** In-app title/body may be slightly more specific but must still avoid clinical source text. */
export function buildInAppCopy(eventType: string): { title: string; body: string } {
  const map: Record<string, { title: string; body: string }> = {
    APPOINTMENT_REQUESTED: { title: '상담 예약 요청', body: '새로운 상담 예약 요청이 있습니다.' },
    APPOINTMENT_ACCEPTED: { title: '예약 수락', body: '상담 예약이 수락되었습니다.' },
    APPOINTMENT_REJECTED: { title: '예약 거절', body: '상담 예약이 거절되었습니다.' },
    APPOINTMENT_RESCHEDULED: { title: '예약 변경', body: '상담 예약 일정이 변경되었습니다.' },
    APPOINTMENT_CANCELLED: { title: '예약 취소', body: '상담 예약이 취소되었습니다.' },
    APPOINTMENT_REMINDER_DUE: { title: '상담 예정 안내', body: '예정된 상담 시간이 다가옵니다.' },
    MESSAGE_RECEIVED: { title: '새 메시지', body: '새로운 메시지가 도착했습니다.' },
    CONSULTATION_RESULT_REGISTERED: { title: '상담 결과', body: '상담 결과가 등록되었습니다.' },
    ANALYSIS_COMPLETED: { title: 'AI 분석 완료', body: '분석이 완료되었습니다. 앱에서 확인하세요.' },
    ANALYSIS_FAILED: { title: 'AI 분석 실패', body: '분석에 실패했습니다. 앱에서 확인하세요.' },
    WELFARE_REVIEW_REQUESTED: { title: '자격 심사 요청', body: '새로운 자격 심사 요청이 있습니다.' },
    WELFARE_REVIEW_COMPLETED: { title: '자격 심사 결과', body: '자격 심사 결과가 등록되었습니다.' },
    CALL_INVITATION_CREATED: { title: '전화 상담 초대', body: '전화 상담 초대가 있습니다.' },
    CALL_INVITATION_CANCELLED: { title: '전화 상담 취소', body: '전화 상담 초대가 취소되었습니다.' },
    CALL_MISSED: { title: '부재중 전화', body: '부재중 전화 알림이 있습니다.' },
  };
  return map[eventType] ?? { title: LOCK_SCREEN_DEFAULT_TITLE, body: LOCK_SCREEN_DEFAULT_BODY };
}
