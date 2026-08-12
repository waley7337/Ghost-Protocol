# Ghost Protocol Backend (Phase 1 scaffold)

This package is a **non-production** API skeleton.

- No authentication
- No PostgreSQL connection
- No ORM
- Optional `GET /health` only

It is **not** wired to the Electron app or web client yet. Root `npm start` still launches Electron exactly as before.

```bash
cd backend
npm start
# GET http://localhost:3000/health
```
