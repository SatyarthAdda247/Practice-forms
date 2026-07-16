# OMR GradePro — API Reference

Base URL (dev): `http://localhost:5000`

All request/response bodies are JSON unless noted. Errors use the shape
`{ "error": "<message>" }` with an appropriate HTTP status. A machine-readable
index of every route is also available at `GET /api`.

**Authentication:** every `/api/exams*`, `/api/sheets*`, `/api/admin*`, and
results route requires a session token obtained via Google sign-in. Send it as
`Authorization: Bearer <token>`. Missing/expired tokens return `401`; a revoked
account returns `403`. Only `/api/health`, `/api`, and the `/api/auth/*`
endpoints are public.

**Access control:** sign-in is restricted to configured email domains
(`OMR_ALLOWED_DOMAINS`, default `adda247.com,studyiq.com,addaeducation.com`) —
other domains are rejected with `403`. Users have a role
(`member` | `admin` | `super_admin`) and an `active` flag. `/api/admin/*` routes
require an admin tier. Bootstrap roles via `OMR_SUPER_ADMIN_EMAILS` and
`OMR_ADMIN_EMAILS` (auto-applied on sign-in).

**Role hierarchy:** a **super-admin** can manage everyone and is the only role
that may change other users' roles. A regular **admin** can only revoke/restore
or delete **members** — not other admins or super-admins. The last active
super-admin cannot be removed, and no one can demote/revoke their own account.

| Method | Path | Description |
| ------ | ---- | ----------- |
| GET | `/api` | Machine-readable endpoint index |
| GET | `/api/health` | Liveness probe |
| POST | `/api/auth/google` | Exchange a Google ID token for a session |
| GET | `/api/auth/me` | Return the signed-in user |
| POST | `/api/auth/logout` | Client-side logout (stateless) |
| GET | `/api/admin/users` | List users + allowed domains (admin) |
| PATCH | `/api/admin/users/{id}` | Set a user's role / access (admin) |
| DELETE | `/api/admin/users/{id}` | Delete a user (admin) |
| GET | `/api/exams` | List exams |
| POST | `/api/exams` | Create an exam + answer key |
| GET | `/api/exams/{id}` | Get one exam |
| PUT | `/api/exams/{id}` | Update an exam / answer key |
| DELETE | `/api/exams/{id}` | Delete an exam (cascades) |
| GET | `/api/exams/{id}/sheets` | List uploaded sheets |
| POST | `/api/exams/{id}/upload` | Upload scanned sheets (multipart) |
| DELETE | `/api/sheets/{id}` | Remove a sheet from the queue |
| GET | `/api/exams/{id}/validation` | Upload validation summary |
| POST | `/api/exams/{id}/grade` | Grade all validated sheets |
| GET | `/api/exams/{id}/results` | Results dashboard data |

---

## Health

### `GET /api/health`
Returns `{ "status": "ok" }`.

---

## Authentication (Google Identity Services)

### `POST /api/auth/google`
Verify a Google ID token (the JWT produced by the GIS button in the browser)
and issue a session.

Body: `{ "credential": "<google-id-token>" }`
→ `200 { "token": "<session>", "user": { "id", "email", "name", "picture" } }`
· `401` if the token is invalid or `GOOGLE_CLIENT_ID` is not configured.

### `GET /api/auth/me`
Return the signed-in user for a valid `Authorization: Bearer <token>` header.
→ `200 { "id", "email", "name", "picture" }` · `401`.

### `POST /api/auth/logout`
Stateless — session tokens are self-contained, so the client just discards its
token. → `200 { "status": "ok" }`.

The `user` object returned by sign-in / `me` includes `role` (`member` |
`admin`) and `active` (bool).

---

## Administration (admin role required)

### `GET /api/admin/users`
List all users and the configured allowed domains:
```json
{
  "users": [
    { "id": 1, "email": "a@adda247.com", "name": "A", "picture": null,
      "role": "admin", "active": true, "createdAt": "..." }
  ],
  "allowedDomains": ["adda247.com", "addaeducation.com", "studyiq.com"]
}
```

### `PATCH /api/admin/users/{id}`
Body (any subset): `{ "role": "member"|"admin"|"super_admin", "active": true|false }`.
Returns the updated user. Only super-admins may set `role`; regular admins may
only toggle `active` on members. Guards: you cannot demote/revoke your **own**
account, and the **last active super-admin** cannot be removed (`400`/`403`).

### `DELETE /api/admin/users/{id}`
Remove a user (revokes access immediately). Regular admins may only delete
members; nobody can delete themselves or the last active super-admin.
→ `204` · `400`/`403` · `404`.

---

## Exams & Answer Keys

The `Exam` object:

```json
{
  "id": 1,
  "name": "Mid-Term Physics 2024",
  "date": "2024-03-14",
  "numQuestions": 50,
  "marksCorrect": 4,
  "marksPenalty": 1,
  "answerKey": { "1": "B", "2": "C", "10": "A" },
  "createdAt": "2024-03-01 10:20:00"
}
```

`answerKey` maps a question number (string) to one of `"A" | "B" | "C" | "D"`.
It may be partial — questions not present are treated as unattempted-safe and
excluded from scoring.

### `GET /api/exams`
List all exams, newest first. → `200` `Exam[]`

### `POST /api/exams`
Create an exam.

Body:
```json
{
  "name": "Mid-Term Physics 2024",   // required
  "date": "2024-03-14",              // optional, YYYY-MM-DD
  "numQuestions": 50,                // 50 | 100 | 200, default 50
  "marksCorrect": 4,                 // default 4
  "marksPenalty": 1,                 // default 1
  "answerKey": { "1": "B" }          // optional
}
```
→ `201` `Exam` · `400` on validation failure.

### `GET /api/exams/{id}`
→ `200` `Exam` · `404` if not found.

### `PUT /api/exams/{id}`
Partial update — send any subset of the create body. Only provided fields
change. → `200` `Exam` · `404` / `400`.

### `DELETE /api/exams/{id}`
Deletes the exam and cascade-removes its sheets and results.
→ `204` · `404`.

---

## Uploads

The `Sheet` object:

```json
{
  "id": 12,
  "examId": 1,
  "filename": "Midterm_Physics_Batch1.pdf",
  "sizeBytes": 4404019,
  "status": "validated",          // processing | validated | failed
  "error": null,                   // set when status == failed
  "rollNumber": "R1234",
  "studentName": null,
  "answers": { "1": "A", "2": "C" },
  "createdAt": "2024-03-01 10:25:00"
}
```

### `GET /api/exams/{id}/sheets`
List every uploaded sheet for an exam (the upload queue). → `200` `Sheet[]`

### `POST /api/exams/{id}/upload`
`multipart/form-data`. Attach one or more files under the field **`files`**.
Accepted extensions: `.pdf`, `.jpg`, `.jpeg`, `.png`; max 50 MB each.

Recognised files are stored, run through the mark detector, and returned with
status `validated`. Unrecognised files are recorded with status `failed` and an
`error` message. → `201` `Sheet[]` (the newly created records) · `404` if the
exam does not exist.

Example:
```bash
curl -F "files=@sheet1.pdf" -F "files=@sheet2.jpg" \
     http://localhost:5000/api/exams/1/upload
```

### `DELETE /api/sheets/{id}`
Remove a single sheet (and its result, if graded). → `204` · `404`.

### `GET /api/exams/{id}/validation`
Aggregated summary for the upload screen:
```json
{
  "totalDetected": 51,
  "readyForGrading": 50,
  "issues": 1,
  "issueDetails": ["Roll number missing on 1 sheet."]
}
```

---

## Grading & Results

### `POST /api/exams/{id}/grade`
Grades every `validated` sheet against the exam's answer key. Idempotent —
re-running replaces prior results. Requires a non-empty answer key.
→ `200` `{ "graded": 50 }` · `400` if the key is empty · `404`.

**Scoring:** `score = correct × marksCorrect − wrong × marksPenalty`.
Unattempted questions are neither rewarded nor penalised. Only questions present
in the answer key are counted; `maxScore = |answerKey| × marksCorrect`.

### `GET /api/exams/{id}/results`
Full dashboard payload:
```json
{
  "exam": { "...": "Exam object" },
  "stats": {
    "graded": 50,
    "average": 132.5,
    "highest": 196,
    "lowest": 40,
    "passRate": 0.72
  },
  "rows": [
    {
      "sheetId": 12,
      "rollNumber": "R1234",
      "studentName": null,
      "filename": "scan_12.pdf",
      "correct": 40,
      "wrong": 8,
      "unattempted": 2,
      "score": 152,
      "maxScore": 200
    }
  ]
}
```
Rows are sorted by score descending. `passRate` uses a 40%-of-maxScore
threshold. → `200` · `404`.

---

## Notes on OMR detection

Mark detection (`backend/grading.py :: detect_answers`) is a **deterministic
stub** — it fabricates reproducible answers seeded by the filename rather than
reading pixels. Replace it with a real OpenCV pipeline (deskew → locate fiducial
markers → sample bubble intensity → threshold) in production; nothing else in
the app changes as long as it returns `{ "<question>": "<A|B|C|D>" }`.
