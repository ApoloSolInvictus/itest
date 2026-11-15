# iTest

iTest is a responsive study workspace for creating exams from a topic or uploaded source material, practicing in a timed exam room, and reviewing explanations. The interface starts in English. Exam content can be generated in several languages, and the dashboard includes links to Google Translate for page translation.

## Features

- Landing page and Firebase email/password or Google sign-in.
- Personal dashboard with exams, source documents, and practice history.
- Exam builder with question count, time, knowledge level, thinking focus, question style, and output language.
- PDF, legacy Word `.doc`, and `.docx` text extraction. Files are stored in Firebase Storage; extracted text is stored in the signed-in user’s Firestore workspace.
- Timed digital exams, answer explanations, and short-answer grading.
- Exam downloads as print-ready PDF, Word-compatible `.doc`, or `.txt`.
- Study desk for questions grounded in selected source documents.
- Educator-only workspace with saved student lists, exam invitations, multiple unique exam links, and student results.
- Public timed exam pages that receive name and email, grade on the server, and keep answer keys private.
- Student submissions are accepted only for an email on that assignment’s saved invitation list; each invited email can submit once.
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
4. Publish `firestore.rules` and `storage.rules` in the Firebase console.
5. Add the Web App values to `.env.local` or Vercel. These `VITE_FIREBASE_*` values are client configuration, not service-account credentials.
6. Set `VITE_FIREBASE_PROJECT_ID` in Vercel. The OpenAI and DOC extraction routes verify Firebase ID tokens against Google's signing certificates.
7. For educator assignments, add the Firebase service account JSON as `FIREBASE_SERVICE_ACCOUNT_JSON` in Vercel. The Admin SDK uses it only in server functions for private Firestore operations and result grading.
8. Enable educator access for approved accounts with the admin script below. Educator status is a Firebase custom claim; users cannot grant it to themselves.

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

### Grant educator access

Educator access is controlled by the Firebase Auth custom claim `educator: true`, which is checked by the Vercel API and Firestore rules. To grant it to an approved account, download a Firebase service account key to a secure location outside the repository, then run this from PowerShell after installing dependencies:

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS = "C:\secure\firebase-admin.json"
node scripts/grant-educator.mjs educator@example.com
```

The user must sign out and sign back in so Firebase refreshes the custom claim. Never commit the service account file. The Vercel runtime uses the same credentials from `FIREBASE_SERVICE_ACCOUNT_JSON`.

### Email invitations

Invitations are sent using Resend’s batch email API, with one separate message per student. Verify the sender domain in Resend, then set `RESEND_API_KEY` and `RESEND_FROM_EMAIL` in Vercel. If those values are missing, iTest still creates a shareable exam link, but it does not claim that invitations were sent; the educator can copy the link and send again after configuring email. Email volume is subject to the Resend account’s limits.

Each link uses a high-entropy random token and can be created independently for an exam and student list. A list supports up to 1,000 students; the assignment keeps a private snapshot of its invited students, so editing a reusable list does not change an existing exam’s roster. The public exam endpoint returns only questions and options. The answer key stays in the educator’s private assignment record; submissions are graded by a server function and written to that educator’s Firestore workspace. Results and exam links load in pages so large classes do not overwhelm the dashboard.

## Document handling

PDF and DOCX text is extracted in the browser. Legacy binary DOC extraction is done by an authenticated Vercel function. The app limits stored extracted text to 26,000 characters per document; PDFs and DOCX files have a 10 MB upload limit, and legacy DOC files have a 3 MB limit. Only documents selected for a generation or study request are sent to OpenAI.

## Data paths

- Firestore: `users/{uid}`, with subcollections `documents`, `exams`, and `attempts`.
- Educator Firestore: `users/{uid}/mailingLists/{listId}`, `users/{uid}/assignments/{assignmentId}`, `users/{uid}/assignments/{assignmentId}/results/{resultId}`, and the paginated educator index `users/{uid}/studentResults/{resultId}`.
- Public exam metadata: `publicExams/{shareId}` is available only through server functions, which omit answer keys from student responses. Timed sessions are stored privately at `users/{uid}/assignments/{assignmentId}/sessions/{emailHash}` and checked when a student submits.
- Firebase Storage: `users/{uid}/documents/{fileName}`.
- Vercel Functions: `/api/ai` and `/api/extract-doc` require a Firebase ID token; `/api/educator` also requires the educator custom claim. `/api/public-exam`, `/api/start-exam`, and `/api/submit-exam` handle the timed student exam and result. A per-instance request limit helps prevent accidental bursts.
