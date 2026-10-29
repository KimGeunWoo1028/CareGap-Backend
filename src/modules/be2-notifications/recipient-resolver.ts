import type { DomainNotificationEvent, NotificationCategory } from './types.js';

/**
 * Identity / relationship ports. Unverified relationships DENY by default.
 * person_id is never treated as user_id.
 */
export type IdentityLink =
  | { verified: false; reason: string }
  | { verified: true; user_id: string };

export type RelationshipDecision =
  | { verified: false; reason: string }
  | { verified: true; allowed: boolean; reason?: string };

export interface PersonUserLinkPort {
  /** Map care-subject person_id → account user_id when linked. */
  resolveUserForPerson(personId: string): Promise<IdentityLink>;
}

export interface StaffAssignmentPort {
  /** staff_user_id must be a users.user_id with a verified care relationship to person_id. */
  isAssignedStaff(staffUserId: string, personId: string): Promise<RelationshipDecision>;
}

export interface FamilySharePort {
  /**
   * Family alerts require verified family link + share consent + category allowance.
   * Until BE1 contracts land, implementations should return verified:false.
   */
  canReceiveFamilyNotification(input: {
    familyUserId: string;
    personId: string;
    category: NotificationCategory;
  }): Promise<RelationshipDecision>;
}

export interface AdminRolePort {
  isApprovedAdmin(userId: string): Promise<RelationshipDecision>;
}

export type RecipientCandidate = {
  user_id: string;
  role_hint: 'patient' | 'family' | 'staff' | 'admin';
  category: NotificationCategory;
};

export type RecipientResolution =
  | { outcome: 'resolved'; recipients: RecipientCandidate[] }
  | { outcome: 'blocked'; reason: string; recipients: [] };

export type RecipientResolverContext = {
  /** Appointment staff_user_id when known (users.user_id). */
  staff_user_id?: string;
  /** Explicit patient account if already resolved by caller (still re-validated). */
  patient_user_id?: string;
  /** Family candidates are ignored unless FamilySharePort allows each one. */
  family_user_ids?: string[];
  /** Admin recipients for WELFARE_REVIEW_REQUESTED etc. */
  admin_user_ids?: string[];
  /** Message peer account when MESSAGE_RECEIVED. */
  message_recipient_user_id?: string;
};

export class NotificationRecipientResolver {
  constructor(
    private readonly personLink: PersonUserLinkPort,
    private readonly staff: StaffAssignmentPort,
    private readonly family: FamilySharePort,
    private readonly admin: AdminRolePort,
  ) {}

  async resolve(
    event: DomainNotificationEvent,
    category: NotificationCategory,
    context: RecipientResolverContext = {},
  ): Promise<RecipientResolution> {
    const recipients: RecipientCandidate[] = [];

    switch (event.event_type) {
      case 'APPOINTMENT_REQUESTED':
      case 'APPOINTMENT_RESCHEDULED':
      case 'APPOINTMENT_CANCELLED':
      case 'APPOINTMENT_REMINDER_DUE':
      case 'MESSAGE_RECEIVED':
      case 'CONSULTATION_RESULT_REGISTERED':
      case 'ANALYSIS_COMPLETED':
      case 'ANALYSIS_FAILED':
      case 'WELFARE_REVIEW_COMPLETED':
      case 'CALL_INVITATION_CREATED':
      case 'CALL_INVITATION_CANCELLED':
      case 'CALL_MISSED':
        await this.addPatient(event, category, context, recipients);
        await this.addStaff(event, category, context, recipients);
        await this.addFamily(event, category, context, recipients);
        break;
      case 'APPOINTMENT_ACCEPTED':
      case 'APPOINTMENT_REJECTED':
        await this.addPatient(event, category, context, recipients);
        await this.addFamily(event, category, context, recipients);
        break;
      case 'WELFARE_REVIEW_REQUESTED':
        await this.addAdmins(category, context, recipients);
        break;
      default:
        return { outcome: 'blocked', reason: 'unknown_event_type', recipients: [] };
    }

    if (event.event_type === 'MESSAGE_RECEIVED' && context.message_recipient_user_id) {
      recipients.push({
        user_id: context.message_recipient_user_id,
        role_hint: 'patient',
        category,
      });
    }

    const deduped = dedupeRecipients(recipients);
    if (deduped.length === 0) {
      return { outcome: 'blocked', reason: 'no_verified_recipients', recipients: [] };
    }
    return { outcome: 'resolved', recipients: deduped };
  }

  private async addPatient(
    event: DomainNotificationEvent,
    category: NotificationCategory,
    context: RecipientResolverContext,
    recipients: RecipientCandidate[],
  ): Promise<void> {
    if (context.patient_user_id) {
      recipients.push({ user_id: context.patient_user_id, role_hint: 'patient', category });
      return;
    }
    if (!event.person_id) return;
    const link = await this.personLink.resolveUserForPerson(event.person_id);
    if (!link.verified) return;
    recipients.push({ user_id: link.user_id, role_hint: 'patient', category });
  }

  private async addStaff(
    event: DomainNotificationEvent,
    category: NotificationCategory,
    context: RecipientResolverContext,
    recipients: RecipientCandidate[],
  ): Promise<void> {
    if (!context.staff_user_id || !event.person_id) return;
    const decision = await this.staff.isAssignedStaff(context.staff_user_id, event.person_id);
    if (!decision.verified || !decision.allowed) return;
    recipients.push({ user_id: context.staff_user_id, role_hint: 'staff', category });
  }

  private async addFamily(
    event: DomainNotificationEvent,
    category: NotificationCategory,
    context: RecipientResolverContext,
    recipients: RecipientCandidate[],
  ): Promise<void> {
    if (!event.person_id || !context.family_user_ids?.length) return;
    for (const familyUserId of context.family_user_ids) {
      const decision = await this.family.canReceiveFamilyNotification({
        familyUserId,
        personId: event.person_id,
        category,
      });
      if (!decision.verified || !decision.allowed) continue;
      recipients.push({ user_id: familyUserId, role_hint: 'family', category });
    }
  }

  private async addAdmins(
    category: NotificationCategory,
    context: RecipientResolverContext,
    recipients: RecipientCandidate[],
  ): Promise<void> {
    for (const adminUserId of context.admin_user_ids ?? []) {
      const decision = await this.admin.isApprovedAdmin(adminUserId);
      if (!decision.verified || !decision.allowed) continue;
      recipients.push({ user_id: adminUserId, role_hint: 'admin', category });
    }
  }
}

function dedupeRecipients(recipients: RecipientCandidate[]): RecipientCandidate[] {
  const seen = new Set<string>();
  const out: RecipientCandidate[] = [];
  for (const recipient of recipients) {
    const key = recipient.user_id.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(recipient);
  }
  return out;
}

/** Fail-closed stubs until BE1 relationship contracts are confirmed. */
export const denyAllPersonLink: PersonUserLinkPort = {
  async resolveUserForPerson() {
    return { verified: false, reason: 'BE1_PERSON_USER_LINK_UNSET' };
  },
};

export const denyAllStaffAssignment: StaffAssignmentPort = {
  async isAssignedStaff() {
    return { verified: false, reason: 'BE1_STAFF_ASSIGNMENT_UNSET' };
  },
};

export const denyAllFamilyShare: FamilySharePort = {
  async canReceiveFamilyNotification() {
    return { verified: false, reason: 'BE1_FAMILY_SHARE_POLICY_UNSET' };
  },
};

export const denyAllAdminRole: AdminRolePort = {
  async isApprovedAdmin() {
    return { verified: false, reason: 'BE1_ADMIN_ROLE_UNSET' };
  },
};

export function createDenyClosedResolver(): NotificationRecipientResolver {
  return new NotificationRecipientResolver(
    denyAllPersonLink,
    denyAllStaffAssignment,
    denyAllFamilyShare,
    denyAllAdminRole,
  );
}
