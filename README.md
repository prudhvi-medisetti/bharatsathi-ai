# BharatSathi AI 🇮🇳

![BharatSathi AI — Empowering India Together](./BharatSathi%20AI_%20Empowering%20India%20Together.png)

**Understand your options. Find public-benefit schemes. Take the next step with confidence.**

BharatSathi AI is a web application that helps people explore Indian government schemes, check preliminary eligibility, organize application documents, and get step-by-step guidance. Its AI assistant is grounded in the scheme information available to the app; official government portals remain the authority for applications and decisions.
## What you can do

- **Explore schemes:** Browse a curated starter catalogue of Central Government and Andhra Pradesh schemes, including eligibility notes, benefits, required documents, and official links.
- **Check preliminary eligibility:** Answer structured questions to identify schemes that may fit your situation.
- **Get tailored assistance:** Use profile-aware scheme recommendations and ask questions in supported languages.
- **Prepare applications:** Follow step-by-step application guidance and open the relevant official portal.
- **Understand application pages:** Upload a screenshot for on-device text recognition, review the extracted text, then ask for help interpreting it.
- **Manage your documents:** Keep documents in a personal vault and optionally associate them with an application.
- **Track your progress:** Save schemes and manage application status in your own tracker. Government status is not synchronized automatically.
- **Use voice features:** Speak a question or listen to an answer where the browser supports the selected language.
- **Keep your place:** Signed-in users can restore recent assistant conversation context when conversation history is enabled.

## Technology

| Area | Technologies |
| --- | --- |
| Frontend | React, TypeScript, Vite, Tailwind CSS |
| Authentication and data | Firebase Authentication, Cloud Firestore, Firebase Storage |
| AI gateway | Python, FastAPI, Gemini API |
| Browser capabilities | Tesseract.js OCR, Web Speech APIs |

## Get started

### Requirements

- Node.js 20 or later
- Python 3.13 for the Windows launcher
- A Firebase project for authentication, cloud data, and document storage

### Quick start on Windows

1. Clone this repository and open its project folder.
2. Install Node.js 20+ and Python 3.13.
3. Double-click `START_BHARATSATHI.bat`.
4. The launcher installs dependencies, creates local environment files when missing, and starts the frontend and backend. Open [http://localhost:5173](http://localhost:5173).
5. Keep both terminal windows open while using the app. Run `STOP_BHARATSATHI.bat` to stop the local services.

The launcher creates `.env.local` and `backend/.env` from the example files if they do not exist. Review and configure them for your Firebase project and any services you want to use.

### Run the frontend and backend separately

Install frontend dependencies and create the frontend environment file:

```powershell
npm install
Copy-Item .env.example .env.local
```

Set `VITE_API_BASE_URL=http://localhost:8000` in `.env.local`, then start Vite:

```powershell
npm run dev
```

In another terminal, prepare and start the API:

```powershell
Set-Location backend
py -3.13 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Copy-Item .env.example .env
uvicorn app:app --reload --port 8000
```

The Gemini key is optional for local development. Without it, the API can use deterministic scheme matching. Firebase Admin credentials and SMTP settings are needed for protected backend workflows such as branded email and authenticated document operations. See [backend setup and configuration](./backend/README.md) for environment variables and operational details.

### Firebase configuration

1. Create or select a Firebase project.
2. Enable the authentication providers you plan to use (Email/Password and Google are supported).
3. Configure Firestore and Firebase Storage, and review the repository's `firestore.rules`, `firestore.indexes.json`, and `storage.rules`.
4. Copy `.env.example` to `.env.local` and enter the Firebase web-app configuration and App Check site key for your project.
5. Set the frontend's `VITE_API_BASE_URL` to the address of your FastAPI service.
6. Configure backend-only Firebase Admin credentials and any required SMTP settings in `backend/.env`.

Firebase web configuration belongs in the frontend environment; **never put Gemini, Firebase Admin service-account, SMTP, or recovery secrets in a `VITE_*` variable**. Do not commit `.env.local`, `backend/.env`, or service-account files.

## Development

Build the frontend:

```bash
npm run build
```

Run the backend unit tests from the project root after installing backend dependencies:

```bash
python -m unittest backend.test_security_flows
```

## Deployment

Build the frontend and deploy the Firebase resources configured in `firebase.json`:

```bash
npm run build
firebase deploy --only hosting,firestore:rules,firestore:indexes,storage
```

The FastAPI backend is deployed separately to a Python-capable hosting provider. Configure its production environment variables, restrict `CORS_ORIGINS` to the deployed frontend origin, and set `APP_ENV=production` and `PUBLIC_APP_URL` to the production HTTPS URL. See the [backend production notes](./backend/README.md#production-notes) before deploying protected workflows.

## Project structure

```text
src/
  components/   Shared interface components
  context/      Authentication and application context
  data/         Language and starter scheme data
  hooks/        Reusable React hooks
  pages/        Application routes and screens
  services/     Firebase, AI, scheme, and workflow services
backend/
  app.py        FastAPI gateway and protected API endpoints
  README.md     Backend setup, configuration, and API notes
firestore.rules
storage.rules
firebase.json
```

## Important guidance

BharatSathi AI offers **preliminary information, not legal, financial, or official eligibility advice**. Scheme rules, benefits, deadlines, and application processes may change; verify current details with the linked official source. The app does not submit applications or make government decisions.

Do not enter Aadhaar numbers, OTPs, bank credentials, or other sensitive personal information into the AI chat. Screenshot text is processed on-device for OCR; review and remove personal information before choosing to send the extracted text with a question.

## License

No license is currently specified. Add a `LICENSE` file before distributing this project or granting reuse rights.
