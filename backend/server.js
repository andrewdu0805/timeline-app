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
  },
  // Compress payloads larger than 1 KB (e.g., initial clicks history on join/finish)
  perMessageDeflate: {
    threshold: 1024
  }
});

// Multi-Classroom State Map (key: roomId string '1', '2', ...)
const rooms = new Map();

// Disconnect grace timers (key: `${roomId}:${clientId}` or `host:${clientId}`, value: Timeout)
const disconnectTimers = new Map();
const GRACE_PERIOD_MS = 90000; // 90 seconds grace period for mobile app-switching / screen lock
const MAX_ROOMS = 5; // Maximum number of classrooms open at the same time
const TICK_INTERVAL_MS = 1000; // Lightweight time sync every 1s (client interpolates smoothly at 60fps)

let lastRoomsListJson = '';

const createRoomObject = (roomId) => ({
  roomId: String(roomId),
  roomName: `教室 ${roomId}`,
  hostClientId: null,
  lastHostClientId: null,
  everHosted: false,
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

// Strip internal socket/client IDs when sending guests list to clients
const serializeGuests = (room) =>
  room.guests.map(({ name, device, isOnline }) => ({ name, device, isOnline }));

const serializeRoomState = (room) => ({
  roomId: room.roomId,
  roomName: room.roomName,
  hasHost: Boolean(room.hostClientId),
  hostOnline: Boolean(room.hostOnline),
  status: room.status,
  durationMinutes: room.durationMinutes,
  speed: room.speed,
  elapsedTimeMs: Math.round(room.elapsedTimeMs),
  clicks: room.clicks,
  guests: serializeGuests(room),
  videoId: room.videoId,
  videoTitle: room.videoTitle,
  maxRooms: MAX_ROOMS
});

// Send only changed fields to sockets inside a specific room
const broadcastRoomPatch = (roomId, patch) => {
  io.to(`room_${roomId}`).emit('state_update', patch);
};

// Emit lightweight rooms summary only when something in the summary actually changed
const broadcastRoomsListIfChanged = () => {
  const list = getRoomsList();
  const json = JSON.stringify(list);
  if (json !== lastRoomsListJson) {
    lastRoomsListJson = json;
    io.emit('rooms_list_update', list);
  }
};

// Remove rooms that have no Host and no Guests.
// The only exception is a "placeholder" room that has never been hosted (lobby for early guests).
const cleanupEmptyRooms = () => {
  let removed = false;
  for (const [id, room] of rooms.entries()) {
    if (room.everHosted && !room.hostClientId && room.guests.length === 0) {
      if (room.tickInterval) clearInterval(room.tickInterval);
      rooms.delete(id);
      removed = true;
    }
  }
  // Always keep at least one room available so early guests have somewhere to wait
  if (rooms.size === 0) {
    getOrCreateRoom('1');
    removed = true;
  }
  if (removed) {
    broadcastRoomsListIfChanged();
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
      // Send final authoritative clicks + guests on finish so Excel export is 100% consistent
      broadcastRoomPatch(room.roomId, {
        status: 'finished',
        elapsedTimeMs: maxMs,
        clicks: room.clicks,
        guests: serializeGuests(room)
      });
      broadcastRoomsListIfChanged();
      return;
    }

    // Ultra-lightweight time sync (~26 bytes) instead of re-sending all clicks & guests every tick
    broadcastRoomPatch(room.roomId, { elapsedTimeMs: Math.round(room.elapsedTimeMs) });
  }, TICK_INTERVAL_MS);
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
  // On initial landing, only send maxRooms and lightweight rooms list (not full click history)
  socket.emit('state_update', { maxRooms: MAX_ROOMS });
  socket.emit('rooms_list_update', getRoomsList());

  // Host joins a classroom.
  // - forceNew = true  (user pressed "以 Host 主機建立"): ALWAYS open a brand-new classroom
  //   (the only exception: an un-hosted placeholder lobby where early guests are already waiting).
  // - forceNew = false (auto-rejoin after refresh / reconnect / app switch): return to own classroom.
  socket.on('join_as_host', ({ clientId, preferredRoomId, forceNew } = {}, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
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
    const prefId = preferredRoomId ? String(preferredRoomId) : null;
    const prefRoom = prefId && rooms.has(prefId) ? rooms.get(prefId) : null;

    if (forceNew) {
      // Claim a never-hosted placeholder lobby (e.g. Classroom 1 with early guests waiting)
      const sortedIds = Array.from(rooms.keys()).sort((a, b) => Number(a) - Number(b));
      for (const id of sortedIds) {
        const r = rooms.get(id);
        if (!r.everHosted && !r.hostClientId) {
          targetRoom = r;
          break;
        }
      }
    } else {
      // Rejoin: 1) preferred room I own  2) any room I own  3) my own room after grace expired
      if (prefRoom && prefRoom.hostClientId === cId) {
        targetRoom = prefRoom;
      }
      if (!targetRoom) {
        for (const r of rooms.values()) {
          if (r.hostClientId === cId) {
            targetRoom = r;
            break;
          }
        }
      }
      if (!targetRoom && prefRoom && !prefRoom.hostClientId && prefRoom.lastHostClientId === cId) {
        targetRoom = prefRoom;
      }
    }

    // Otherwise open a brand-new classroom (next free number) — unless the classroom limit is reached
    if (!targetRoom) {
      if (rooms.size >= MAX_ROOMS) {
        socket.role = null;
        const payload = { ok: false, reason: 'full', maxRooms: MAX_ROOMS, roomsList: getRoomsList() };
        socket.emit('rooms_full', payload);
        reply(payload);
        return;
      }
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
    targetRoom.lastHostClientId = cId;
    targetRoom.hostSocketId = socket.id;
    targetRoom.hostOnline = true;
    targetRoom.everHosted = true;
    socket.roomId = targetRoom.roomId;
    socket.join(`room_${targetRoom.roomId}`);

    socket.emit('room_assigned', { roomId: targetRoom.roomId, roomName: targetRoom.roomName });
    // Send full room state only to the joining Host socket
    socket.emit('state_update', serializeRoomState(targetRoom));
    // Notify existing occupants in this room with minimal host-status patch
    socket.to(`room_${targetRoom.roomId}`).emit('state_update', { hasHost: true, hostOnline: true });

    reply({ ok: true, roomId: targetRoom.roomId, roomName: targetRoom.roomName });
    broadcastRoomsListIfChanged();
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
      broadcastRoomPatch(room.roomId, { hasHost: false, hostOnline: false });
    }
    if (socket.roomId) {
      socket.leave(`room_${socket.roomId}`);
    }
    socket.role = null;
    socket.roomId = null;
    cleanupEmptyRooms();
    broadcastRoomsListIfChanged();
  });

  // Helper to get the socket's current room
  const getSocketRoom = () => {
    // Only act on a classroom the socket has actually joined (never auto-create one here)
    if (!socket.roomId) return null;
    return rooms.get(String(socket.roomId)) || null;
  };

  // Host Control Events (scoped to the Host/Guest's current classroom)
  socket.on('set_video_id', (id) => {
    const room = getSocketRoom();
    if (!room) return;
    if (room.status === 'idle') {
      room.videoId = id;
      broadcastRoomPatch(room.roomId, { videoId: room.videoId });
    }
  });

  socket.on('set_video_metadata', ({ minutes, title }) => {
    const room = getSocketRoom();
    if (!room) return;
    if (room.status === 'idle') {
      room.durationMinutes = Math.max(1, minutes);
      if (title) {
        room.videoTitle = title;
      }
      broadcastRoomPatch(room.roomId, {
        durationMinutes: room.durationMinutes,
        videoTitle: room.videoTitle
      });
      broadcastRoomsListIfChanged();
    }
  });

  socket.on('start_timeline', () => {
    const room = getSocketRoom();
    if (!room) return;
    if (room.status === 'idle') {
      room.status = 'running';
      startRoomTick(room);
      broadcastRoomPatch(room.roomId, {
        status: 'running',
        elapsedTimeMs: Math.round(room.elapsedTimeMs)
      });
      broadcastRoomsListIfChanged();
    }
  });

  socket.on('pause_timeline', () => {
    const room = getSocketRoom();
    if (!room) return;
    if (room.status === 'running') {
      room.status = 'paused';
      const now = Date.now();
      const delta = now - room.lastTickTime;
      room.elapsedTimeMs += delta * room.speed;
      if (room.tickInterval) {
        clearInterval(room.tickInterval);
        room.tickInterval = null;
      }
      broadcastRoomPatch(room.roomId, {
        status: 'paused',
        elapsedTimeMs: Math.round(room.elapsedTimeMs)
      });
      broadcastRoomsListIfChanged();
    }
  });

  socket.on('resume_timeline', () => {
    const room = getSocketRoom();
    if (!room) return;
    if (room.status === 'paused') {
      room.status = 'running';
      startRoomTick(room);
      broadcastRoomPatch(room.roomId, {
        status: 'running',
        elapsedTimeMs: Math.round(room.elapsedTimeMs)
      });
      broadcastRoomsListIfChanged();
    }
  });

  socket.on('seek_timeline', (offsetMs) => {
    const room = getSocketRoom();
    if (!room) return;
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
          broadcastRoomPatch(room.roomId, {
            status: 'finished',
            elapsedTimeMs: maxMs,
            clicks: room.clicks,
            guests: serializeGuests(room)
          });
          broadcastRoomsListIfChanged();
          return;
        }
      }
      broadcastRoomPatch(room.roomId, {
        status: room.status,
        elapsedTimeMs: Math.round(room.elapsedTimeMs)
      });
    }
  });

  socket.on('set_speed', (speed) => {
    const room = getSocketRoom();
    if (!room) return;
    if (room.status === 'running' || room.status === 'idle' || room.status === 'paused') {
      if (room.status === 'running') {
        const now = Date.now();
        const delta = now - room.lastTickTime;
        room.elapsedTimeMs += delta * room.speed;
        room.lastTickTime = now;
      }
      room.speed = speed;
      broadcastRoomPatch(room.roomId, {
        speed: room.speed,
        elapsedTimeMs: Math.round(room.elapsedTimeMs)
      });
    }
  });

  socket.on('end_timeline', () => {
    const room = getSocketRoom();
    if (!room) return;
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
      broadcastRoomPatch(room.roomId, {
        status: 'finished',
        elapsedTimeMs: Math.round(room.elapsedTimeMs),
        clicks: room.clicks,
        guests: serializeGuests(room)
      });
      broadcastRoomsListIfChanged();
    }
  });

  socket.on('reset', () => {
    const room = getSocketRoom();
    if (!room) return;
    if (room.tickInterval) {
      clearInterval(room.tickInterval);
      room.tickInterval = null;
    }
    room.status = 'idle';
    room.speed = 1;
    room.elapsedTimeMs = 0;
    room.clicks = [];
    broadcastRoomPatch(room.roomId, {
      status: 'idle',
      speed: 1,
      elapsedTimeMs: 0,
      clicks: []
    });
    broadcastRoomsListIfChanged();
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
        if (removeGuestFromRoom(otherRoom, socket.id, cId, name)) {
          broadcastRoomPatch(otherId, { guests: serializeGuests(otherRoom) });
        }
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
    // Send full state only to the joining/reconnecting guest
    socket.emit('state_update', serializeRoomState(targetRoom));
    // Notify others in the room with only the updated guests list
    socket.to(`room_${targetRoom.roomId}`).emit('state_update', { guests: serializeGuests(targetRoom) });

    cleanupEmptyRooms();
    broadcastRoomsListIfChanged();
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
      const changed = removeGuestFromRoom(oldRoom, socket.id, cId, name);
      socket.leave(`room_${socket.roomId}`);
      if (changed) {
        broadcastRoomPatch(oldRoom.roomId, { guests: serializeGuests(oldRoom) });
      }
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
    socket.emit('state_update', serializeRoomState(newRoom));
    socket.to(`room_${newRoom.roomId}`).emit('state_update', { guests: serializeGuests(newRoom) });

    cleanupEmptyRooms();
    broadcastRoomsListIfChanged();
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
      if (removeGuestFromRoom(room, socket.id, cId, name)) {
        broadcastRoomPatch(room.roomId, { guests: serializeGuests(room) });
      }
    }
    if (socket.roomId) {
      socket.leave(`room_${socket.roomId}`);
    }
    socket.role = null;
    socket.roomId = null;
    cleanupEmptyRooms();
    broadcastRoomsListIfChanged();
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
          broadcastRoomPatch(room.roomId, { hasHost: false, hostOnline: false });
          cleanupEmptyRooms();
          broadcastRoomsListIfChanged();
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
        if (removeGuestFromRoom(room, socket.id, cId, name)) {
          broadcastRoomPatch(room.roomId, { guests: serializeGuests(room) });
        }
        cleanupEmptyRooms();
        broadcastRoomsListIfChanged();
      }, GRACE_PERIOD_MS);

      disconnectTimers.set(timerKey, timer);
    }
  });

  socket.on('register_click', ({ name, val, isClose }) => {
    const room = getSocketRoom();
    if (!room) return;
    if (room.status === 'running') {
      // Calculate current user balance in this room
      const userClicks = room.clicks.filter(c => c.name === name);
      const currentBalance = userClicks.reduce((sum, c) => sum + c.val, 0);

      // Unless it's an explicit close-position order, enforce limit of [-10, +10]
      if (!isClose) {
        if (val > 0 && currentBalance >= 10) return;
        if (val < 0 && currentBalance <= -10) return;
      }

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

// Cache hashed Vite asset bundles (JS/CSS) aggressively in browser so repeat visits use 0 bytes for bundles
app.use('/assets', express.static(path.join(__dirname, '../frontend/dist/assets'), {
  maxAge: '1y',
  immutable: true
}));

// Serve remaining static files (index.html should stay uncached / revalidated)
app.use(express.static(path.join(__dirname, '../frontend/dist')));

// Fallback for React Router (if needed)
app.use((req, res, next) => {
  res.sendFile(path.join(__dirname, '../frontend/dist', 'index.html'));
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
