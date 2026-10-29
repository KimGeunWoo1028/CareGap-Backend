# NTF-01~08 Traceability

| ID | Requirement | Status | Evidence | Remaining |
| --- | --- | --- | --- | --- |
| NTF-01 | Subject/family appointment & message alerts | PARTIAL | Event types + resolver + tests; family DENY by default | BE1 family share policy; live appointment emitters |
| NTF-02 | Staff alerts (assignment-based) | PARTIAL | StaffAssignmentPort + tests rejecting role-only | Verified BE1 assignment table/API |
| NTF-03 | Admin welfare review in-app | PARTIAL | `WELFARE_REVIEW_REQUESTED` → in-app, no external push | Real review workflow event source; admin role contract |
| NTF-04 | Preferences | IMPLEMENTED (server) | preferences module + HTTP PATCH self-only tests | Product mandatory-notification policy (unset) |
| NTF-05 | Notification list/read | IMPLEMENTED (server) | Reuses BE2 functions + routes + tests | Persistent DB repository wiring |
| NTF-06 | Safe navigation destination | IMPLEMENTED (contract) | `destination_type` + `resource_id` only | FE routes; click-time auth recheck in FE/BE resource APIs |
| NTF-07 | Lock-screen privacy | IMPLEMENTED (server default) | Conservative payload builder + tests | Product rich-preview policy confirmation |
| NTF-08 | Reminder timing | PARTIAL | ReminderScheduler + fake clock tests; policy unset default | Confirm 1d/1h offsets; activate policy |

## Explicit BLOCKED / NOT VERIFIED

- Real FCM delivery to devices: **NOT VERIFIED** (no project credentials/devices in this session)
- Family live send: **BLOCKED** (policy unset → DENY)
- person_id→user_id production mapping: **BLOCKED** (BE1)
- Mobile E2E receive: **BLOCKED** (no mobile client in this repo)
- DB migration apply: **NOT VERIFIED** (draft only; no confirmed isolated DB run in this session)
