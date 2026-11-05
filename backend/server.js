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

// Multi-Classroom State Map (key: roomId string '1', '2', ...)
const rooms = new Map();

// Disconnect grace timers (key: `${roomId}:${clientId}` or `host:${clientId}`, value: Timeout)
const disconnectTimers = new Map();
const GRACE_PERIOD_MS = 90000; // 90 seconds grace period for mobile app-switching / screen lock

const createRoomObject = (roomId) => ({
  roomId: String(roomId),
  roomName: `教室 ${roomId}`,
  hostClientId: null,
  hostSocketId: null,
  hostOnline: false,
  status: 'idle', // idle, running, paused, finished
  durationMinutes: 120,
  speed: 1,
  elapsedTimeMs: 0,
  clicks: [], // { name, val, exactMs }
  guests: [], // { id, clientId, name, device, isOnline }
  videoId: '',
  videoTitle: '',
  tickInterval: null,
  lastTickTime: Date.now()
});

// Always ensure Classroom 1 exists for early guests arriving before any Host
const getOrCreateRoom = (roomId) => {
  const id = String(roomId || '1');
  if (!rooms.has(id)) {
    rooms.set(id, createRoomObject(id));
  }
  return rooms.get(id);
};

// Initialize Classroom 1
getOrCreateRoom('1');

const getRoomsList = () => {
  const list = [];
  const sortedIds = Array.from(rooms.keys()).sort((a, b) => Number(a) - Number(b));
  for (const id of sortedIds) {
    const r = rooms.get(id);
    if (!r) continue;
    list.push({
      roomId: r.roomId,
      roomName: r.roomName,
      hasHost: Boolean(r.hostClientId),
      hostOnline: Boolean(r.hostOnline),
      guestCount: r.guests.length,
      status: r.status,
      videoTitle: r.videoTitle || ''
    });
  }
  return list;
};

const serializeRoomState = (room) => ({
  roomId: room.roomId,
  roomName: room.roomName,
  hasHost: Boolean(room.hostClientId),
  hostOnline: Boolean(room.hostOnline),
  status: room.status,
  durationMinutes: room.durationMinutes,
  speed: room.speed,
  elapsedTimeMs: room.elapsedTimeMs,
  clicks: room.clicks,
  guests: room.guests,
  videoId: room.videoId,
  videoTitle: room.videoTitle,
  roomsList: getRoomsList()
});

const broadcastRoomState = (roomId) => {
  const room = rooms.get(String(roomId));
  if (!room) return;
  io.to(`room_${room.roomId}`).emit('state_update', serializeRoomState(room));
};

const broadcastAllRoomsSummary = () => {
  const list = getRoomsList();
  io.emit('rooms_list_update', list);
  for (const id of rooms.keys()) {
    broadcastRoomState(id);
  }
};

// Clean up extra empty rooms (roomId !== '1') when they have no host, no guests, and are idle
const cleanupEmptyRooms = () => {
  let removed = false;
  for (const [id, room] of rooms.entries()) {
    if (id !== '1' && !room.hostClientId && room.guests.length === 0 && room.status === 'idle') {
      if (room.tickInterval) clearInterval(room.tickInterval);
      rooms.delete(id);
      removed = true;
    }
  }
  if (removed) {
    broadcastAllRoomsSummary();
  }
};

const startRoomTick = (room) => {
  if (room.tickInterval) clearInterval(room.tickInterval);
  room.lastTickTime = Date.now();

  room.tickInterval = setInterval(() => {
    if (room.status !== 'running') {
      clearInterval(room.tickInterval);
      room.tickInterval = null;
      return;
    }

    const now = Date.now();
    const delta = now - room.lastTickTime;
    room.lastTickTime = now;

    room.elapsedTimeMs += delta * room.speed;

    const maxMs = room.durationMinutes * 60 * 1000;
    if (room.elapsedTimeMs >= maxMs) {
      room.elapsedTimeMs = maxMs;
      room.status = 'finished';
      clearInterval(room.tickInterval);
      room.tickInterval = null;
      broadcastAllRoomsSummary();
      return;
    }
    broadcastRoomState(room.roomId);
  }, 500);
};

const removeGuestFromRoom = (room, socketId, clientId, name) => {
  if (!room) return false;
  const before = room.guests.length;
  room.guests = room.guests.filter(
    g => g.id !== socketId && (!clientId || g.clientId !== clientId) && (!name || g.name !== name)
  );
  return room.guests.length !== before;
};

io.on('connection', (socket) => {
  // Default new connections to Classroom 1 view so LandingScreen gets roomsList immediately
  const defaultRoom = getOrCreateRoom('1');
  socket.emit('state_update', serializeRoomState(defaultRoom));
  socket.emit('rooms_list_update', getRoomsList());

  // Host joins or creates a classroom automatically
  socket.on('join_as_host', ({ clientId, preferredRoomId } = {}) => {
    const cId = clientId || socket.id;
    socket.clientId = cId;
    socket.role = 'host';

    // Clear any pending host disconnect timer for this clientId
    const hostTimerKey = `host:${cId}`;
    if (disconnectTimers.has(hostTimerKey)) {
      clearTimeout(disconnectTimers.get(hostTimerKey));
      disconnectTimers.delete(hostTimerKey);
    }

    let targetRoom = null;

    // 1. Check if this Host already owns an existing classroom (e.g. page refresh / reconnect)
    for (const r of rooms.values()) {
      if (r.hostClientId === cId) {
        targetRoom = r;
        break;
      }
    }

    // 2. If a preferredRoomId was specified and it has no active host, use it
    if (!targetRoom && preferredRoomId && rooms.has(String(preferredRoomId))) {
      const prefRoom = rooms.get(String(preferredRoomId));
      if (!prefRoom.hostClientId || prefRoom.hostClientId === cId) {
        targetRoom = prefRoom;
      }
    }

    // 3. Otherwise, find the first existing classroom without a Host (starting with Classroom 1)
    if (!targetRoom) {
      const sortedIds = Array.from(rooms.keys()).sort((a, b) => Number(a) - Number(b));
      for (const id of sortedIds) {
        const r = rooms.get(id);
        if (!r.hostClientId) {
          targetRoom = r;
          break;
        }
      }
    }

    // 4. If all existing classrooms already have a Host, open a new classroom (next number)
    if (!targetRoom) {
      let nextNum = 1;
      while (rooms.has(String(nextNum))) {
        nextNum++;
      }
      targetRoom = getOrCreateRoom(String(nextNum));
    }

    // Leave previous socket room if any
    if (socket.roomId && socket.roomId !== targetRoom.roomId) {
      socket.leave(`room_${socket.roomId}`);
    }

    targetRoom.hostClientId = cId;
    targetRoom.hostSocketId = socket.id;
    targetRoom.hostOnline = true;
    socket.roomId = targetRoom.roomId;
    socket.join(`room_${targetRoom.roomId}`);

    socket.emit('room_assigned', { roomId: targetRoom.roomId, roomName: targetRoom.roomName });
    broadcastAllRoomsSummary();
  });

  socket.on('leave_host', () => {
    const cId = socket.clientId || socket.id;
    const hostTimerKey = `host:${cId}`;
    if (disconnectTimers.has(hostTimerKey)) {
      clearTimeout(disconnectTimers.get(hostTimerKey));
      disconnectTimers.delete(hostTimerKey);
    }

    const room = rooms.get(String(socket.roomId || '1'));
    if (room && (room.hostClientId === cId || room.hostSocketId === socket.id)) {
      room.hostClientId = null;
      room.hostSocketId = null;
      room.hostOnline = false;
    }
    if (socket.roomId) {
      socket.leave(`room_${socket.roomId}`);
    }
    socket.role = null;
    cleanupEmptyRooms();
    broadcastAllRoomsSummary();
  });

  // Helper to get the socket's current room
  const getSocketRoom = () => {
    const rId = String(socket.roomId || '1');
    return getOrCreateRoom(rId);
  };

  // Host Control Events (scoped to the Host/Guest's current classroom)
  socket.on('set_video_id', (id) => {
    const room = getSocketRoom();
    if (room.status === 'idle') {
      room.videoId = id;
      broadcastAllRoomsSummary();
    }
  });

  socket.on('set_video_metadata', ({ minutes, title }) => {
    const room = getSocketRoom();
    if (room.status === 'idle') {
      room.durationMinutes = Math.max(1, minutes);
      if (title) {
        room.videoTitle = title;
      }
      broadcastAllRoomsSummary();
    }
  });

  socket.on('start_timeline', () => {
    const room = getSocketRoom();
    if (room.status === 'idle') {
      room.status = 'running';
      startRoomTick(room);
      broadcastAllRoomsSummary();
    }
  });

  socket.on('pause_timeline', () => {
    const room = getSocketRoom();
    if (room.status === 'running') {
      room.status = 'paused';
      const now = Date.now();
      const delta = now - room.lastTickTime;
      room.elapsedTimeMs += delta * room.speed;
      if (room.tickInterval) {
        clearInterval(room.tickInterval);
        room.tickInterval = null;
      }
      broadcastAllRoomsSummary();
    }
  });

  socket.on('resume_timeline', () => {
    const room = getSocketRoom();
    if (room.status === 'paused') {
      room.status = 'running';
      startRoomTick(room);
      broadcastAllRoomsSummary();
    }
  });

  socket.on('seek_timeline', (offsetMs) => {
    const room = getSocketRoom();
    if (room.status !== 'idle') {
      if (room.status === 'running') {
        const now = Date.now();
        const delta = now - room.lastTickTime;
        room.elapsedTimeMs += delta * room.speed;
        room.lastTickTime = now;
      }

      room.elapsedTimeMs = Math.max(0, room.elapsedTimeMs + offsetMs);
      const maxMs = room.durationMinutes * 60 * 1000;
      if (room.elapsedTimeMs >= maxMs) {
        room.elapsedTimeMs = maxMs;
        if (room.status === 'running') {
          room.status = 'finished';
          if (room.tickInterval) {
            clearInterval(room.tickInterval);
            room.tickInterval = null;
          }
        }
      }
      broadcastRoomState(room.roomId);
    }
  });

  socket.on('set_speed', (speed) => {
    const room = getSocketRoom();
    if (room.status === 'running' || room.status === 'idle' || room.status === 'paused') {
      room.speed = speed;
      if (room.status === 'running') {
        const now = Date.now();
        const delta = now - room.lastTickTime;
        room.elapsedTimeMs += delta * room.speed;
        room.lastTickTime = now;
      }
      broadcastRoomState(room.roomId);
    }
  });

  socket.on('end_timeline', () => {
    const room = getSocketRoom();
    if (room.status === 'running' || room.status === 'paused') {
      if (room.status === 'running') {
        const now = Date.now();
        const delta = now - room.lastTickTime;
        room.elapsedTimeMs += delta * room.speed;
      }
      room.status = 'finished';
      if (room.tickInterval) {
        clearInterval(room.tickInterval);
        room.tickInterval = null;
      }
      broadcastAllRoomsSummary();
    }
  });

  socket.on('reset', () => {
    const room = getSocketRoom();
    if (room.tickInterval) {
      clearInterval(room.tickInterval);
      room.tickInterval = null;
    }
    room.status = 'idle';
    room.speed = 1;
    room.elapsedTimeMs = 0;
    room.clicks = [];
    broadcastAllRoomsSummary();
  });

  // Guest Events
  socket.on('join_as_guest', ({ name, device, clientId, roomId }) => {
    const cId = clientId || socket.id;
    socket.clientId = cId;
    socket.guestName = name;
    socket.role = 'guest';
    socket.guestDevice = device;

    // Determine target room: if requested roomId exists, use it; else default to '1'
    let targetRoomId = String(roomId || socket.roomId || '1');
    if (!rooms.has(targetRoomId)) {
      const availableIds = Array.from(rooms.keys()).sort((a, b) => Number(a) - Number(b));
      targetRoomId = availableIds[0] || '1';
    }
    const targetRoom = getOrCreateRoom(targetRoomId);

    // Clear any pending disconnect timers for this guest across all rooms
    for (const key of Array.from(disconnectTimers.keys())) {
      if (key.endsWith(`:${cId}`) || (name && key.endsWith(`:${name}`))) {
        clearTimeout(disconnectTimers.get(key));
        disconnectTimers.delete(key);
      }
    }

    // Remove this guest from any OTHER room they might have been in previously
    for (const [otherId, otherRoom] of rooms.entries()) {
      if (otherId !== targetRoom.roomId) {
        removeGuestFromRoom(otherRoom, socket.id, cId, name);
      }
    }

    if (socket.roomId && socket.roomId !== targetRoom.roomId) {
      socket.leave(`room_${socket.roomId}`);
    }

    socket.roomId = targetRoom.roomId;
    socket.join(`room_${targetRoom.roomId}`);

    const existingIndex = targetRoom.guests.findIndex(
      g => (g.clientId && g.clientId === cId) || g.name === name
    );

    if (existingIndex !== -1) {
      targetRoom.guests[existingIndex] = {
        id: socket.id,
        clientId: cId,
        name,
        device: device || targetRoom.guests[existingIndex].device,
        isOnline: true
      };
    } else {
      targetRoom.guests.push({
        id: socket.id,
        clientId: cId,
        name,
        device,
        isOnline: true
      });
    }

    socket.emit('room_assigned', { roomId: targetRoom.roomId, roomName: targetRoom.roomName });
    cleanupEmptyRooms();
    broadcastAllRoomsSummary();
  });

  // Allow a guest to switch classrooms on the fly without re-entering their name
  socket.on('switch_room', ({ roomId }) => {
    const targetId = String(roomId);
    if (!rooms.has(targetId)) return;

    const cId = socket.clientId || socket.id;
    const name = socket.guestName || 'Guest';
    const device = socket.guestDevice || 'Desktop';

    // Remove from current room
    if (socket.roomId && rooms.has(String(socket.roomId))) {
      const oldRoom = rooms.get(String(socket.roomId));
      removeGuestFromRoom(oldRoom, socket.id, cId, name);
      socket.leave(`room_${socket.roomId}`);
    }

    const newRoom = rooms.get(targetId);
    socket.roomId = newRoom.roomId;
    socket.join(`room_${newRoom.roomId}`);

    const existingIndex = newRoom.guests.findIndex(
      g => (g.clientId && g.clientId === cId) || g.name === name
    );
    if (existingIndex !== -1) {
      newRoom.guests[existingIndex] = {
        id: socket.id,
        clientId: cId,
        name,
        device,
        isOnline: true
      };
    } else {
      newRoom.guests.push({
        id: socket.id,
        clientId: cId,
        name,
        device,
        isOnline: true
      });
    }

    socket.emit('room_assigned', { roomId: newRoom.roomId, roomName: newRoom.roomName });
    cleanupEmptyRooms();
    broadcastAllRoomsSummary();
  });

  socket.on('leave_guest', () => {
    const cId = socket.clientId || socket.id;
    const name = socket.guestName;

    for (const key of Array.from(disconnectTimers.keys())) {
      if (key.endsWith(`:${cId}`) || (name && key.endsWith(`:${name}`))) {
        clearTimeout(disconnectTimers.get(key));
        disconnectTimers.delete(key);
      }
    }

    const room = rooms.get(String(socket.roomId || '1'));
    if (room) {
      removeGuestFromRoom(room, socket.id, cId, name);
    }
    if (socket.roomId) {
      socket.leave(`room_${socket.roomId}`);
    }
    socket.role = null;
    cleanupEmptyRooms();
    broadcastAllRoomsSummary();
  });

  socket.on('disconnect', () => {
    const cId = socket.clientId || socket.id;
    const name = socket.guestName;
    const rId = String(socket.roomId || '1');
    const room = rooms.get(rId);
    if (!room) return;

    // Handle Host disconnect with grace period
    if (socket.role === 'host' && (room.hostClientId === cId || room.hostSocketId === socket.id)) {
      room.hostOnline = false;
      const hostTimerKey = `host:${cId}`;
      if (disconnectTimers.has(hostTimerKey)) {
        clearTimeout(disconnectTimers.get(hostTimerKey));
      }
      const timer = setTimeout(() => {
        disconnectTimers.delete(hostTimerKey);
        if (room.hostClientId === cId) {
          room.hostClientId = null;
          room.hostSocketId = null;
          room.hostOnline = false;
          cleanupEmptyRooms();
          broadcastAllRoomsSummary();
        }
      }, GRACE_PERIOD_MS);
      disconnectTimers.set(hostTimerKey, timer);
      return;
    }

    // Handle Guest disconnect with 90s grace period
    const guest = room.guests.find(
      g => g.id === socket.id || (cId && g.clientId === cId) || (name && g.name === name)
    );

    if (guest) {
      guest.isOnline = false;

      const timerKey = `${rId}:${cId || name || socket.id}`;
      if (disconnectTimers.has(timerKey)) {
        clearTimeout(disconnectTimers.get(timerKey));
      }

      const timer = setTimeout(() => {
        disconnectTimers.delete(timerKey);
        removeGuestFromRoom(room, socket.id, cId, name);
        cleanupEmptyRooms();
        broadcastAllRoomsSummary();
      }, GRACE_PERIOD_MS);

      disconnectTimers.set(timerKey, timer);
    }
  });

  socket.on('register_click', ({ name, val, isClose }) => {
    const room = getSocketRoom();
    if (room.status === 'running') {
      const now = Date.now();
      const delta = now - room.lastTickTime;
      const exactMs = room.elapsedTimeMs + (delta * room.speed);

      const maxMs = room.durationMinutes * 60 * 1000;
      const finalMs = Math.min(exactMs, maxMs);

      const clickData = { name, val, exactMs: finalMs, ...(isClose ? { isClose: true } : {}) };
      room.clicks.push(clickData);
      io.to(`room_${room.roomId}`).emit('new_click', clickData);
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
