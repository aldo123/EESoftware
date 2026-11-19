# WIK Interlock & Traceability — React + FastAPI

## Project Structure

```
interlock-app/
├── backend/
│   ├── main.py          # FastAPI routes
│   ├── database.py      # MySQL DatabaseManager
│   ├── requirements.txt
│   └── interlock.json   # Config file (auto-created on first save)
└── frontend/
    ├── src/
    │   ├── LoginPage.jsx  # Login UI + Interlock Settings modal
    │   ├── App.jsx
    │   ├── main.jsx
    │   └── index.css
    ├── index.html
    ├── package.json
    ├── vite.config.js
    ├── tailwind.config.js
    └── postcss.config.js
```

## Setup

### 1. Backend (Python FastAPI)

```bash
cd backend
pip install -r requirements.txt

# Copy your interlock.json here (or create one via the Settings UI)
# Then run:
uvicorn main:app --reload --port 8000
```

Backend runs at: http://localhost:8000

API Endpoints:
- GET  /api/health         — DB connection status
- POST /api/login/card     — { id_card: "..." }
- POST /api/login/password — { username: "...", password: "..." }
- GET  /api/interlock      — load interlock.json
- POST /api/interlock      — save interlock.json + reload DB

### 2. Frontend (React + Vite + Tailwind)

```bash
cd frontend
npm install
npm run dev
```

Frontend runs at: http://localhost:5173

### 3. Build for production

```bash
cd frontend
npm run build
# Output in frontend/dist/
```

## Features

- Card scan login (RFID/barcode)
- Username + password login
- Live clock display
- Loading progress bar
- DB connection status indicator
- Interlock settings modal (reads/writes interlock.json + reloads DB)
- Dark theme matching original Python app palette
- Tailwind CSS (no separate stylesheet needed)

## Database (MySQL)

Requires a `users` table:
```sql
CREATE TABLE users (
  id       INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(100),
  password VARCHAR(255),
  role     VARCHAR(50),
  id_card  VARCHAR(100)
);
```
