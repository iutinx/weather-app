# 🌤️ Weather App

An interactive weather statistics web app built with TypeScript, Vite, and React Three Fiber. It visualizes country-average weather data fetched from a custom-built API powered by Redis and Docker.

---

## ✨ Features

- 🌍 **Country weather statistics** — browse average weather data by country
- ☀️ **3D visuals** — interactive 3D sun model rendered with React Three Fiber / Three.js
- ⚡ **Fast & cached** — backend API uses Redis for low-latency data delivery

---

## 🛠️ Tech Stack

### Frontend
| Technology | Purpose |
|---|---|
| TypeScript | Type-safe development |
| Vite | Build tool & dev server |
| Three.js / React Three Fiber | 3D rendering |

### Backend (to be added)
| Technology | Purpose |
|---|---|
| Custom REST API | Weather data endpoints |
| Redis | Data caching & storage |
| Docker | Containerized deployment |

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [Docker](https://www.docker.com/) & Docker Compose

### 1. Clone the repository

```bash
git clone https://github.com/iutinx/weather-app.git
cd weather-app
```

### 2. Start the backend

```bash
docker compose up -d
```

### 3. Install frontend dependencies

```bash
npm install
```

### 4. Start the dev server

```bash
npm run dev
```

The app will be available at `http://localhost:5173`.

---

## 📁 Project Structure

```
weather-app/
├── public/
│   └── models/         # 3D assets (GLTF/GLB)
├── src/
│   ├── components/     # React components
│   ├── hooks/          # Custom hooks
│   └── main.tsx        # Entry point
├── docker-compose.yml  # Backend services
└── vite.config.ts
```

---

## 📄 License

This project is for personal/educational use. See [LICENSE](./LICENSE) for details.