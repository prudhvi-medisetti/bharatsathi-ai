# BharatSathi AI — Hackathon Submission Build

## What is included

- Firebase Authentication: Email/Password + Google Sign-In
- Firebase Firestore user profiles and persistence
- Protected routes and profile completion flow
- Central + Andhra Pradesh scheme explorer
- Structured eligibility matching
- Saved schemes
- Application progress tracker
- Firebase Storage document workflow with on-device document-type recognition
- 22 scheduled Indian languages + English language foundation
- Voice input + spoken AI responses in browser-supported languages
- FastAPI/Python secure AI gateway
- Gemini-grounded assistant with scheme-context validation
- Deterministic local fallback when the backend or Gemini key is unavailable
- Official-source links and preliminary-guidance disclaimers

## Run frontend

```bash
npm install
npm run dev
```

Create `.env.local` from `.env.example` and set:

```env
VITE_API_BASE_URL=http://localhost:8000
```

## Run FastAPI

```bash
cd backend
python -m venv .venv
# Windows
.venv\\Scripts\\activate
pip install -r requirements.txt
copy .env.example .env
uvicorn app:app --reload --port 8000
```

Set `GEMINI_API_KEY` in `backend/.env` for real Gemini generation. The key is never placed in React/Vite code.

## Demo path

Register → Complete Profile → Dashboard → Explore Schemes → Eligibility → Save Scheme → Documents → Application Tracker → AI Assistant → choose language → microphone → spoken answer.

## Important trust boundary

BharatSathi provides preliminary guidance. Final eligibility, benefits, deadlines and approvals must be verified against the linked official government source.
