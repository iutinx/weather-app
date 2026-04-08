# Toon Weather Globe

> ⚠️ **Work in Progress** — core features are functional, active development ongoing.

An interactive 3D weather visualization built with Three.js and React Three Fiber. Displays real-time worldwide weather data through an immersive toon-shaded globe, powered by a custom Redis-backed REST API running in Docker.

---

## Preview

> _Screenshots coming soon_

---

## Features

- 🌍 &nbsp;**Interactive 3D globe** — toon-shaded world rendered with Three.js & React Three Fiber
- 📡 &nbsp;**Live weather data** — fetched from a custom-built REST API
- ⚡ &nbsp;**Redis caching** — low-latency responses via server-side caching
- 🐳 &nbsp;**Dockerized backend** — API + Redis spin up with a single command

---

## Tech Stack

**Frontend**

| Package | Version |
|---|---|
| [Three.js](https://threejs.org/) | ^0.169.0 |
| [@react-three/fiber](https://docs.pmnd.rs/react-three-fiber) | ^9.5.0 |
| [@react-three/drei](https://github.com/pmndrs/drei) | ^10.7.7 |
| [TypeScript](https://www.typescriptlang.org/) | ^5.6.3 |
| [Vite](https://vitejs.dev/) | ^8.0.2 |

**Backend**

| Technology | Role |
|---|---|
| Custom REST API (Python) | Weather data endpoints |
| [Redis 7](https://redis.io/) | Caching & persistent storage |
| [Docker](https://www.docker.com/) + Compose | Containerized services |

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v18+
- [Docker](https://www.docker.com/) & Docker Compose

### 1. Clone the repository

```bash
git clone https://github.com/iutinx/weather-app.git
cd weather-app
```

### 2. Set up environment variables

Create a `.env` file in the project root:

```env
REDIS_PASSWORD=your_redis_password
```

### 3. Start everything

The `dev` script starts the Docker backend and the Vite dev server concurrently:

```bash
npm install
npm run dev
```

Frontend → `http://localhost:5173`  
Backend API → `http://localhost:5001`

### Run frontend only

```bash
npm run dev:web
```

### Run backend only

```bash
docker compose up --build
```

---

## Project Structure

```
weather-app/
├── backend/               # Python REST API (Dockerized)
├── public/
│   └── models/            # 3D assets (GLTF + textures)
├── src/                   # Frontend TypeScript source
├── .env                   # Environment variables (not committed)
├── docker-compose.yaml    # API + Redis services
├── package.json
├── tsconfig.json
└── vite.config.ts
```

---

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start backend (Docker) + frontend (Vite) concurrently |
| `npm run dev:web` | Start frontend only |
| `npm run build` | Type-check and build for production |
| `npm run preview` | Preview the production build |

---

## Roadmap

- [ ] Country search & filter
- [ ] Animated weather transitions
- [ ] Mobile responsive layout
- [ ] Full API documentation

---

## License

This project is for personal and educational use.
