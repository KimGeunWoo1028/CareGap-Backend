# Recipient & Authorization Policy

## Defaults

**DENY** when verification is missing or inconclusive.

| Port | Default stub reason |
| --- | --- |
| PersonUserLinkPort | `BE1_PERSON_USER_LINK_UNSET` |
| StaffAssignmentPort | `BE1_STAFF_ASSIGNMENT_UNSET` |
| FamilySharePort | `BE1_FAMILY_SHARE_POLICY_UNSET` |
| AdminRolePort | `BE1_ADMIN_ROLE_UNSET` |
| NotificationAuthPort | `BE1_NOTIFICATION_AUTH_UNSET` |

## Rules

1. Never treat `person_id` as `user_id`.
2. Staff role alone must not receive all subjects' alerts — require assignment check.
3. Family requires verified relationship + share consent + category allowance (all unset → no send).
4. Admin external push deferred; admin in-app for welfare request is allowed when admin port verifies.
5. Notification click must re-check resource access; historical delivery does not grant access.
6. Prefer existing BE1 middleware (`authenticateUser` / `requireApprovedUser` / `requireRole`) over new auth stacks once contracts are confirmed.

## BE1 code observed on upstream/main

- Supabase JWT middleware exists in `shared/middleware/auth.middleware.ts`.
- `be1-auth/auth.service.ts` and `relationship.service.ts` are still **memory demos**.
- Do not promote synthetic `final-be2` session auth to production notification auth.
