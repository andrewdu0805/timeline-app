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
  status: 'idle', // idle, running, paused, finished
  durationMinutes: 120, // default
  speed: 1, // 1, 2, 3
  elapsedTimeMs: 0,
  clicks: [], // { name, val, exactMs }
  guests: [], // { id, clientId, name, device, isOnline }
  videoId: '', // YouTube video ID
};

let tickInterval = null;
let lastTickTime = Date.now();

// Disconnect grace timers (key: clientId or name, value: Timeout)
const disconnectTimers = new Map();
const GRACE_PERIOD_MS = 90000; // 90 seconds grace period for mobile app-switching / screen lock

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
  socket.on('set_video_id', (id) => {
    if (state.status === 'idle') {
      state.videoId = id;
      broadcastState();
    }
  });

  socket.on('set_video_metadata', ({ minutes, title }) => {
    if (state.status === 'idle') {
      state.durationMinutes = Math.max(1, minutes);
      if (title) {
        state.videoTitle = title;
      }
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

  socket.on('pause_timeline', () => {
    if (state.status === 'running') {
      state.status = 'paused';
      // calculate exact time at pause
      const now = Date.now();
      const delta = now - lastTickTime;
      state.elapsedTimeMs += delta * state.speed;
      if (tickInterval) clearInterval(tickInterval);
      broadcastState();
    }
  });

  socket.on('resume_timeline', () => {
    if (state.status === 'paused') {
      state.status = 'running';
      startTick();
      broadcastState();
    }
  });

  socket.on('seek_timeline', (offsetMs) => {
    if (state.status !== 'idle') {
      // update exact time first
      if (state.status === 'running') {
        const now = Date.now();
        const delta = now - lastTickTime;
        state.elapsedTimeMs += delta * state.speed;
        lastTickTime = now;
      }
      
      state.elapsedTimeMs = Math.max(0, state.elapsedTimeMs + offsetMs);
      const maxMs = state.durationMinutes * 60 * 1000;
      if (state.elapsedTimeMs >= maxMs) {
         state.elapsedTimeMs = maxMs;
         if (state.status === 'running') {
           state.status = 'finished';
           if (tickInterval) clearInterval(tickInterval);
         }
      }
      broadcastState();
    }
  });

  socket.on('set_speed', (speed) => {
    if (state.status === 'running' || state.status === 'idle' || state.status === 'paused') {
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

  socket.on('end_timeline', () => {
    if (state.status === 'running' || state.status === 'paused') {
      if (state.status === 'running') {
        const now = Date.now();
        const delta = now - lastTickTime;
        state.elapsedTimeMs += delta * state.speed;
      }
      state.status = 'finished';
      if (tickInterval) clearInterval(tickInterval);
      broadcastState();
    }
  });

  socket.on('reset', () => {
    state = {
      status: 'idle',
      durationMinutes: state.durationMinutes,
      speed: 1,
      elapsedTimeMs: 0,
      clicks: [],
      guests: state.guests, // Preserve connected guests!
      videoId: state.videoId,
      videoTitle: state.videoTitle
    };
    if (tickInterval) clearInterval(tickInterval);
    broadcastState();
  });

  // Guest Events
  socket.on('join_as_guest', ({ name, device, clientId }) => {
    const cId = clientId || socket.id;
    socket.clientId = cId;
    socket.guestName = name;

    // Clear any pending disconnect timer for this guest
    if (disconnectTimers.has(cId)) {
      clearTimeout(disconnectTimers.get(cId));
      disconnectTimers.delete(cId);
    }
    if (name && disconnectTimers.has(name)) {
      clearTimeout(disconnectTimers.get(name));
      disconnectTimers.delete(name);
    }

    // Match by clientId or name
    const existingIndex = state.guests.findIndex(
      g => (g.clientId && g.clientId === cId) || g.name === name
    );

    if (existingIndex !== -1) {
      state.guests[existingIndex] = {
        id: socket.id,
        clientId: cId,
        name,
        device: device || state.guests[existingIndex].device,
        isOnline: true
      };
    } else {
      state.guests.push({
        id: socket.id,
        clientId: cId,
        name,
        device,
        isOnline: true
      });
    }

    broadcastState();
  });

  socket.on('leave_guest', () => {
    const cId = socket.clientId || socket.id;
    const name = socket.guestName;
    if (disconnectTimers.has(cId)) {
      clearTimeout(disconnectTimers.get(cId));
      disconnectTimers.delete(cId);
    }
    if (name && disconnectTimers.has(name)) {
      clearTimeout(disconnectTimers.get(name));
      disconnectTimers.delete(name);
    }
    state.guests = state.guests.filter(
      g => g.id !== socket.id && (!cId || g.clientId !== cId) && (!name || g.name !== name)
    );
    broadcastState();
  });

  socket.on('disconnect', () => {
    const cId = socket.clientId || socket.id;
    const name = socket.guestName;
    const guest = state.guests.find(
      g => g.id === socket.id || (cId && g.clientId === cId) || (name && g.name === name)
    );

    if (guest) {
      // Mark as temporarily offline instead of deleting immediately
      guest.isOnline = false;

      const timerKey = cId || name || socket.id;
      if (disconnectTimers.has(timerKey)) {
        clearTimeout(disconnectTimers.get(timerKey));
      }

      const timer = setTimeout(() => {
        disconnectTimers.delete(timerKey);
        state.guests = state.guests.filter(
          g => g !== guest && g.id !== socket.id && (!cId || g.clientId !== cId) && (!name || g.name !== name)
        );
        broadcastState();
      }, GRACE_PERIOD_MS);

      disconnectTimers.set(timerKey, timer);
      // We do NOT broadcast immediate removal, so guest count does NOT drop during mobile app switching
    }
  });

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
