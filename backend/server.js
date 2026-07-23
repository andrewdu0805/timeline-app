const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// App State
let state = {
  status: 'idle', // idle, running, finished
  durationMinutes: 120, // default
  speed: 1, // 1, 2, 3
  elapsedTimeMs: 0,
  clicks: [], // { name, val, exactMs }
};

let tickInterval = null;
let lastTickTime = Date.now();

const broadcastState = () => {
  io.emit('state_update', state);
};

const startTick = () => {
  if (tickInterval) clearInterval(tickInterval);
  lastTickTime = Date.now();
  
  // Update state every 500ms so clients stay closely in sync
  tickInterval = setInterval(() => {
    if (state.status !== 'running') {
      clearInterval(tickInterval);
      return;
    }

    const now = Date.now();
    const delta = now - lastTickTime;
    lastTickTime = now;

    state.elapsedTimeMs += delta * state.speed;

    const maxMs = state.durationMinutes * 60 * 1000;
    if (state.elapsedTimeMs >= maxMs) {
      state.elapsedTimeMs = maxMs;
      state.status = 'finished';
      clearInterval(tickInterval);
    }
    broadcastState();
  }, 500); 
};

io.on('connection', (socket) => {
  // Send current state to new client
  socket.emit('state_update', state);

  // Host Events
  socket.on('set_duration', (minutes) => {
    if (state.status === 'idle') {
      state.durationMinutes = Math.max(1, minutes);
      broadcastState();
    }
  });

  socket.on('start_timeline', () => {
    if (state.status === 'idle') {
      state.status = 'running';
      startTick();
      broadcastState();
    }
  });

  socket.on('set_speed', (speed) => {
    if (state.status === 'running' || state.status === 'idle') {
      state.speed = speed;
      // also calculate intermediate elapsed time accurately if running
      if (state.status === 'running') {
        const now = Date.now();
        const delta = now - lastTickTime;
        state.elapsedTimeMs += delta * state.speed;
        lastTickTime = now;
      }
      broadcastState();
    }
  });

  socket.on('reset', () => {
    state = {
      status: 'idle',
      durationMinutes: state.durationMinutes,
      speed: 1,
      elapsedTimeMs: 0,
      clicks: []
    };
    if (tickInterval) clearInterval(tickInterval);
    broadcastState();
  });

  // Guest Events
  socket.on('register_click', ({ name, val }) => {
    if (state.status === 'running') {
      // Calculate exact time based on current time plus small offset
      const now = Date.now();
      const delta = now - lastTickTime;
      const exactMs = state.elapsedTimeMs + (delta * state.speed);

      // Make sure we don't exceed max
      const maxMs = state.durationMinutes * 60 * 1000;
      const finalMs = Math.min(exactMs, maxMs);

      const clickData = { name, val, exactMs: finalMs };
      state.clicks.push(clickData);
      io.emit('new_click', clickData); // broadcast instantly to everyone
    }
  });
});

// Serve frontend in production
app.use(express.static(path.join(__dirname, '../frontend/dist')));

// Fallback for React Router (if needed)
app.use((req, res, next) => {
  res.sendFile(path.join(__dirname, '../frontend/dist', 'index.html'));
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
