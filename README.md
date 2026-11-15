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
6. Set `VITE_FIREBASE_PROJECT_ID` in Vercel. The API verifies Firebase ID tokens against Google's signing certificates; no Firebase service-account key is needed.

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

Never add an OpenAI API key with a `VITE_` prefix or commit it to Git. Use Vercel’s encrypted environment-variable settings for `OPENAI_API_KEY`.

## Document handling

PDF and DOCX text is extracted in the browser. Legacy binary DOC extraction is done by an authenticated Vercel function. The app limits stored extracted text to 26,000 characters per document; PDFs and DOCX files have a 10 MB upload limit, and legacy DOC files have a 3 MB limit. Only documents selected for a generation or study request are sent to OpenAI.

## Data paths

- Firestore: `users/{uid}`, with subcollections `documents`, `exams`, and `attempts`.
- Firebase Storage: `users/{uid}/documents/{fileName}`.
- Vercel Functions: `POST /api/ai` and `POST /api/extract-doc`. Both require a valid Firebase ID token. A per-instance request limit helps prevent accidental bursts.
