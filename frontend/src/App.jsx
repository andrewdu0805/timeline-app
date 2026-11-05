import { useState, useEffect } from 'react'
import { io } from 'socket.io-client'
import LandingScreen from './components/LandingScreen'
import HostScreen from './components/HostScreen'
import GuestScreen from './components/GuestScreen'
import SummaryScreen from './components/SummaryScreen'
import './index.css'

export const getDeviceType = () => {
  const ua = navigator.userAgent;
  if (/(tablet|ipad|playbook|silk)|(android(?!.*mobi))/i.test(ua)) return 'Tablet';
  if (/Mobile|Android|iP(hone|od)|IEMobile|BlackBerry|Kindle|Silk-Accelerated|(hpw|web)OS|Opera M(obi|ini)/.test(ua)) return 'Mobile';
  return 'Desktop';
};

export const getClientId = () => {
  try {
    let id = localStorage.getItem('timeline_client_id');
    if (!id) {
      id = 'client_' + Math.random().toString(36).substring(2, 9) + '_' + Date.now().toString(36);
      localStorage.setItem('timeline_client_id', id);
    }
    return id;
  } catch (e) {
    return 'client_' + Date.now();
  }
};

// Connect to backend dynamically based on the URL the user is visiting
const socketUrl = import.meta.env.PROD ? '/' : `http://${window.location.hostname}:3001`;
const socket = io(socketUrl, {
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  timeout: 20000,
});

function App() {
  const [role, setRole] = useState(() => {
    try {
      return localStorage.getItem('timeline_role') || null;
    } catch (e) {
      return null;
    }
  });

  const [guestName, setGuestName] = useState(() => {
    try {
      return localStorage.getItem('timeline_guest_name') || '';
    } catch (e) {
      return '';
    }
  });

  const [roomId, setRoomId] = useState(() => {
    try {
      return localStorage.getItem('timeline_room_id') || '1';
    } catch (e) {
      return '1';
    }
  });

  const [roomsList, setRoomsList] = useState([
    { roomId: '1', roomName: '教室 1', hasHost: false, guestCount: 0, status: 'idle' }
  ]);

  // Set when a Host tried to open a classroom but the limit was reached
  const [roomsFullNotice, setRoomsFullNotice] = useState(null);

  const [gameState, setGameState] = useState({
    roomId: '1',
    roomName: '教室 1',
    status: 'idle',
    durationMinutes: 120,
    speed: 1,
    elapsedTimeMs: 0,
    clicks: [],
    guests: [],
    roomsList: []
  });

  const handleSetRole = (newRole) => {
    setRole(newRole);
    try {
      if (newRole) {
        localStorage.setItem('timeline_role', newRole);
      } else {
        localStorage.removeItem('timeline_role');
      }
    } catch (e) {}
  };

  const handleSetGuestName = (name) => {
    setGuestName(name);
    try {
      if (name) {
        localStorage.setItem('timeline_guest_name', name);
      } else {
        localStorage.removeItem('timeline_guest_name');
      }
    } catch (e) {}
  };

  const handleSetRoomId = (newRoomId) => {
    const rId = String(newRoomId || '1');
    setRoomId(rId);
    try {
      localStorage.setItem('timeline_room_id', rId);
    } catch (e) {}
  };

  const handleSwitchRoom = (targetRoomId) => {
    const rId = String(targetRoomId);
    handleSetRoomId(rId);
    if (role === 'guest') {
      socket.emit('switch_room', { roomId: rId });
    }
  };

  const handleLogout = () => {
    if (role === 'guest') {
      socket.emit('leave_guest');
    } else if (role === 'host') {
      socket.emit('leave_host');
    }
    try {
      localStorage.removeItem('timeline_role');
      localStorage.removeItem('timeline_guest_name');
      localStorage.removeItem('timeline_room_id');
    } catch (e) {}
    setRole(null);
    setGuestName('');
    setRoomId('1');
  };

  // Auto re-join whenever socket connects / reconnects, or user returns to tab (visibility change / focus)
  useEffect(() => {
    const handleRejoin = () => {
      if (role === 'guest' && guestName) {
        if (!socket.connected) {
          socket.connect();
        }
        socket.emit('join_as_guest', {
          name: guestName,
          device: getDeviceType(),
          clientId: getClientId(),
          roomId
        });
      } else if (role === 'host') {
        if (!socket.connected) {
          socket.connect();
        }
        socket.emit('join_as_host', {
          clientId: getClientId(),
          preferredRoomId: roomId
        });
      }
    };

    socket.on('connect', handleRejoin);

    if (socket.connected && (role === 'host' || (role === 'guest' && guestName))) {
      handleRejoin();
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        handleRejoin();
      }
    };

    const handleFocus = () => {
      handleRejoin();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);

    return () => {
      socket.off('connect', handleRejoin);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, [role, guestName, roomId]);

  useEffect(() => {
    socket.on('state_update', (newState) => {
      setGameState((prev) => ({ ...prev, ...newState }));
      if (newState.roomsList && Array.isArray(newState.roomsList)) {
        setRoomsList(newState.roomsList);
      }
      if (newState.roomId) {
        handleSetRoomId(newState.roomId);
      }
    });

    socket.on('rooms_list_update', (list) => {
      if (Array.isArray(list)) {
        setRoomsList(list);
        setGameState((prev) => ({ ...prev, roomsList: list }));
      }
    });

    socket.on('room_assigned', ({ roomId: assignedId }) => {
      if (assignedId) {
        handleSetRoomId(assignedId);
      }
    });

    // Classroom limit reached: send this would-be Host back to the landing page to pick an existing classroom
    socket.on('rooms_full', (payload) => {
      if (payload && Array.isArray(payload.roomsList)) {
        setRoomsList(payload.roomsList);
      }
      setRoomsFullNotice({ maxRooms: (payload && payload.maxRooms) || 5 });
      setRole(null);
      try {
        localStorage.removeItem('timeline_role');
      } catch (e) {}
    });

    socket.on('new_click', (clickData) => {
      setGameState((prev) => {
        const exists = prev.clicks.some(
          (c) => c.name === clickData.name && c.exactMs === clickData.exactMs && c.val === clickData.val
        );
        if (exists) return prev;
        return {
          ...prev,
          clicks: [...prev.clicks, clickData]
        };
      });
    });

    return () => {
      socket.off('state_update');
      socket.off('rooms_list_update');
      socket.off('room_assigned');
      socket.off('rooms_full');
      socket.off('new_click');
    };
  }, []);

  if (!role) {
    return (
      <LandingScreen 
        socket={socket} 
        setRole={handleSetRole} 
        setGuestName={handleSetGuestName}
        selectedRoomId={roomId}
        setSelectedRoomId={handleSetRoomId}
        roomsList={roomsList}
        roomsFullNotice={roomsFullNotice}
        setRoomsFullNotice={setRoomsFullNotice}
        maxRooms={gameState.maxRooms || 5}
      />
    );
  }

  if (gameState.status === 'finished') {
    return (
      <SummaryScreen 
        state={gameState} 
        onReset={() => socket.emit('reset')} 
        role={role} 
        onLogout={handleLogout}
      />
    );
  }

  if (role === 'host') {
    return <HostScreen socket={socket} state={gameState} onLogout={handleLogout} />;
  }

  if (role === 'guest') {
    return (
      <GuestScreen 
        socket={socket} 
        state={gameState} 
        guestName={guestName} 
        onLogout={handleLogout}
        roomsList={roomsList}
        onSwitchRoom={handleSwitchRoom}
      />
    );
  }

  return null;
}

export default App;
