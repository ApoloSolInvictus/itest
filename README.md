# iTest

iTest is a responsive study workspace for creating exams from a topic or uploaded source material, practicing in a timed exam room, and reviewing explanations. The interface starts in English. Exam content can be generated in several languages, and the dashboard includes links to Google Translate for page translation.

## Features

- Landing page and Firebase email/password or Google sign-in.
- Separate Student, Educator, and HR & Hiring account profiles. The selected profile is saved to the user's Firestore record and determines which workspace navigation is shown.
- Personal dashboard with exams, source documents, and practice history.
- Exam builder with question count, time, knowledge level, thinking focus, question style, and output language.
- PDF, legacy Word `.doc`, and `.docx` text extraction. Files are stored in Firebase Storage; extracted text is stored in the signed-in user’s Firestore workspace.
- Timed digital exams, answer explanations, and short-answer grading.
- Exam downloads as print-ready PDF, Word-compatible `.doc`, or `.txt`.
- Study desk for questions grounded in selected source documents.
- Educator and hiring workspaces with saved rosters, exam invitations, passing thresholds, and result history.
- Public timed exam pages authenticate students and keep answer keys private.
- Invited students sign in with the same verified email address as the roster. Opening the invitation adds its teacher, subject, exam, and score history to their own workspace.
- Each retry draws a new question selection from the saved exam when its question bank allows it, and shuffles question and option order. Students can retry until they meet the passing score; all attempts remain visible to both workspaces.
- Responsive layouts for desktop, tablet, and mobile.
- Demo workspace when Firebase is not configured. Demo records stay in the current browser and are clearly marked.

## Run locally

1. Install Node.js 24.12 or later.
2. Copy `.env.example` to `.env.local` and add the Firebase web app configuration values.
3. Install dependencies with `npm install`.
4. Start the frontend with `npm run dev`.

AI generation and legacy `.doc` extraction use Vercel functions. To run those locally, use the Vercel CLI (`vercel dev`) after configuring the server-only variables below. The API key is never bundled into the browser.

## Firebase setup

1. Create a Firebase project and register a Web App.
2. Enable Email/Password and Google providers in Authentication. Add your local host and deployed domain to authorized domains.
3. Create a Firestore database and a Storage bucket.
4. Deploy `firestore.rules` and `storage.rules` with Firebase CLI (`firebase deploy --only firestore,storage`), or publish the same files in the Firebase console. Paginated educator queries use snapshot cursors and do not need custom composite indexes.
5. Add the Web App values to `.env.local` or Vercel. These `VITE_FIREBASE_*` values are client configuration, not service-account credentials.
6. Set `VITE_FIREBASE_PROJECT_ID` in Vercel. The OpenAI and DOC extraction routes verify Firebase ID tokens against Google's signing certificates.
7. For educator assignments, add the Firebase service account JSON as `FIREBASE_SERVICE_ACCOUNT_JSON` in Vercel. The Admin SDK uses it only in server functions for private Firestore operations and result grading.
8. New accounts choose a Student, Educator, or HR & Hiring profile during registration. The selected profile is saved once to `users/{uid}.profileType`; existing educator and employer custom claims continue to work.

The Firestore and Storage rules limit user records and uploaded files to the authenticated user’s own UID path.

## Vercel deployment

Import `https://github.com/ApoloSolInvictus/itest` into Vercel. The project uses Vite’s `dist` output and Vercel Node.js functions in `/api`.

Add these environment variables in Vercel, then redeploy:

| Variable | Where it is used |
| --- | --- |
| `VITE_FIREBASE_API_KEY` | Firebase Web App config |
| `VITE_FIREBASE_AUTH_DOMAIN` | Firebase Web App config |
| `VITE_FIREBASE_PROJECT_ID` | Firebase Web App config |
| `VITE_FIREBASE_STORAGE_BUCKET` | Firebase Web App config |
| `VITE_FIREBASE_APP_ID` | Firebase Web App config |
| `OPENAI_API_KEY` | Server-side OpenAI requests only |
| `OPENAI_MODEL` | Optional; defaults to `gpt-6-astra` |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Firebase Admin SDK for educator lists, assignments, and results |
| `RESEND_API_KEY` | Server-side email invitations; create a key in Resend |
| `RESEND_FROM_EMAIL` | Verified sender, for example `iTest <exams@your-verified-domain.com>` |
| `APP_BASE_URL` | Public site origin used in exam links; set to `https://itest.wstudio3d.com` |

Never add an OpenAI key, Firebase service account, or Resend key with a `VITE_` prefix or commit one to Git. Use Vercel’s encrypted environment variables for server credentials. The Firebase Web App settings are public client configuration; the Admin service account is private.

### Legacy custom-claim access

New registrations do not need an administrator to grant a workspace role. The Educator and HR buttons select the matching profile at signup. Existing accounts that already use Firebase custom claims remain supported. To grant legacy claim access, download a Firebase service account key to a secure location outside the repository, then run this from PowerShell after installing dependencies:

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS = "C:\secure\firebase-admin.json"
node scripts/grant-educator.mjs educator@example.com
```

For legacy claims, the user must sign out and back in so Firebase refreshes the claim. Never commit the service account file. The Vercel runtime uses the same credentials from `FIREBASE_SERVICE_ACCOUNT_JSON`.

For an approved HR account, use the same secure Admin SDK setup and run:

```powershell
node scripts/grant-employer.mjs hiring@example.com
```

Hiring scores are assessment evidence for human review; iTest does not make employment decisions.

### Email invitations

Invitations are sent using Resend’s batch email API, with one separate message per student. Verify the sender domain in Resend, then set `RESEND_API_KEY` and `RESEND_FROM_EMAIL` in Vercel. If those values are missing, iTest still creates a shareable exam link, but it does not claim that invitations were sent; the educator can copy the link and send again after configuring email. Email volume is subject to the Resend account’s limits.

Each link uses a high-entropy random token and can be created independently for an exam and roster. A list supports up to 1,000 people; the assignment keeps a private snapshot of its invitees, so editing a reusable list does not change an existing roster. Opening a link requires a verified Firebase account whose email matches that snapshot. The answer key stays in the creator’s private assignment record; submissions are graded by a server function and written to both Firestore workspaces. Each retry stays within the same assignment, draws a randomized selection/order, and stops when the configured passing score is reached. Results and exam links load in pages so large classes do not overwhelm the dashboards.

## Document handling

PDF and DOCX text is extracted in the browser, across every PDF page. Legacy binary DOC extraction is done by an authenticated Vercel function. Original files and complete extracted text are stored separately in private Firebase Storage; Firestore keeps the document index, extraction status, and a short preview. Existing library entries without a full-text sidecar are re-read from their original file the first time they are used, and can also be refreshed from My documents.

Signed-in users can select documents from the same private library in exam creation and Study & research, across their Student, Educator, or HR workspace. The AI API loads only the signed-in user's selected documents. It reads up to 20 documents and 600,000 extracted characters per request. Larger source collections should be split into chapters. Longer selections are analyzed section by section so later parts of a document are included instead of being silently dropped. Image-only/scanned PDF pages are identified as having no selectable text; iTest does not perform OCR itself. PDFs and DOCX files have a 10 MB upload limit, legacy DOC files have a 3 MB limit (and must remain within the server response size), and extracted text is capped at 9 MB per document to fit the existing private Storage rule.

## Data paths

- Firestore: `users/{uid}`, with subcollections `documents`, `exams`, and `attempts`.
- Creator Firestore: `users/{uid}/mailingLists/{listId}`, `users/{uid}/assignments/{assignmentId}`, `users/{uid}/assignments/{assignmentId}/results/{resultId}`, and `users/{uid}/studentResults/{resultId}`.
- Student Firestore: invited exams are linked at `users/{studentUid}/assignedExams/{assignmentKey}`, with attempt history in its `attempts` subcollection. This workspace index contains no answer keys.
- Public exam metadata: `publicExams/{shareId}` is available only through authenticated server functions, which omit answer keys from student responses. Enrollments and timed sessions are stored privately under each creator assignment and checked when a student submits.
- Firebase Storage: original files and extracted text sidecars in `users/{uid}/documents/{fileName}`; Firestore stores the path, size, page count, and extraction status.
- Vercel Functions: `/api/profile` saves a one-time account profile; `/api/ai` and `/api/extract-doc` require a Firebase ID token; `/api/educator` requires an Educator/HR profile or a legacy custom claim; `/api/student` and the timed exam routes require a verified invited email. A per-instance request limit helps prevent accidental bursts.
