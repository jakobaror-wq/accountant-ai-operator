# Data Model - Accountant AI Operator (Supabase)

## 1. עקרון RLS

כל טבלה נגישה דרך `office_id` (משרד רו"ח) כגבול Multi-tenancy ראשי; משתמש שייך למשרד אחד או יותר דרך `office_member`. אין Row גלוי בין משרדים. Policies נבדקות דרך `auth.uid()` מול `office_member`, לא דרך שדה על הטבלה עצמה (מונע טעות "שכחתי RLS על טבלת ילד").

## 2. ישויות ליבה

```
office (משרד רו"ח)
  └─ office_member (user_id, office_id, role: owner|accountant|bookkeeper|admin)
  └─ client (לקוח, שייך למשרד)
       └─ tax_year (client_id, year, status: open|in_review|closed)
  └─ device (Local Agent מזווג - device_token_hash, paired_at, revoked_at, last_seen_at)
  └─ connector_credential_ref (office_id, connector_id, device_id, credential_label)
       -- שים לב: אין כאן סיסמה. רק תיוג/הפניה. הסיסמה בפועל חיה ב-DPAPI על המחשב המקומי בלבד.
```

## 3. Workflow / Run

```
workflow_definition (office_id?, name, version, source: "manual" | "learned")
  └─ workflow_step_definition (order, tool_name, input_schema_ref, requires_approval: bool)

workflow_run (workflow_definition_id, client_id, tax_year_id, status, started_by, started_at)
  └─ workflow_step (run_id, seq, tool_name, status, input, output(ToolResult), checkpoint_hash, confidence, created_at)
  └─ evidence (step_id, kind, storage_ref, captured_at)   -- storage_ref -> Supabase Storage, לא Base64 בטבלה
```

## 4. החלטות, אישורים, Audit

```
decision (run_id, step_id?, question, data_used(jsonb), alternatives(jsonb), chosen, rationale, confidence, rule_ref?)

approval_package (run_id, status: draft|pending|approved|partially_approved|rejected, executive_summary, created_at)
  └─ approval_item (package_id, system, client_field/account, previous_value, proposed_value, reason, source, risk_level, reversible: bool, decision: pending|approved|rejected|edited, edited_value?)
  └─ exception (package_id, kind: missing_info|mismatch|failed_action|suspicious_value|needs_human_judgment, description, resolved: bool)

audit_event (office_id, run_id?, actor(user|agent), action, payload_hash, payload_ref, occurred_at)
  -- Append-only. אין UPDATE/DELETE ברמת ה-DB (Policy חוסם, רק INSERT מותר לתפקיד השירות)
```

## 5. Skills (Training Mode)

```
skill (office_id?, name, connector_id, version, created_from_run_id?, status: draft|approved)
  └─ skill_step (order, semantic_action, screen_ref, field_ref, value_source: "user_input"|"prior_step"|"constant", validation_rule?)
```

`created_from_run_id` מקשר ל-Run של Training Mode שממנו נלמד ה-Skill, לשקיפות מקור.

## 6. שכבות זיכרון (חובה להפריד - מהמפרט המקורי)

| שכבה | טבלה/מנגנון | Scope |
|---|---|---|
| כללי משרד | `office_memory` (key, value, updated_by) | office_id בלבד |
| לקוח | `client_memory` (key, value) | client_id |
| שנת מס | `tax_year_memory` (key, value) | tax_year_id |
| Workflow | `workflow_definition` עצמו + `office_memory` מתויג | workflow_definition_id |
| הרצה זמנית | לא נשמר מעבר ל-`workflow_run` הפעיל - נמחק/מתיישן בסיום | run_id |

חשוב: שימוש בזיכרון קודם **כהשוואה** (לא כהחלטה אוטומטית) חייב תיעוד ב-`decision.data_used` - ר' דרישת "הצג למשתמש כאשר החלטה קודמת שימשה כהשוואה" במפרט המקור. אין טבלה נפרדת לזה; זה שדה בתוך `decision`.

## 7. הערות מפורשות - מה עדיין לא סגור

- סכמת RLS המדויקת (policies בפועל, לא רק העיקרון) תיכתב כ-migration בשלב 1, לא כאן.
- אין עדיין החלטה אם `evidence`/`screenshot` נשמרים ב-Supabase Storage הרגיל או ב-Bucket עם מדיניות שימור מחמירה יותר (רגישות גבוהה, ר' Threat Model סעיף 1) - שאלה פתוחה ב-`07`.
- טבלת `connector_credential_ref` מכוונת מתוך ההנחה ש-Local Agent יכול לשלוח "יש לי credential בשם X עבור connector Y" בלי לחשוף את הערך - יש לוודא זאת מול מימוש ה-Local Agent בפועל בשלב 2.
