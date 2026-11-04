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
// In production (Render), we connect to the same origin (/). In local dev, we connect to port 3001.
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

  const [gameState, setGameState] = useState({
    status: 'idle',
    durationMinutes: 120,
    speed: 1,
    elapsedTimeMs: 0,
    clicks: []
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

  const handleLogout = () => {
    if (role === 'guest') {
      socket.emit('leave_guest');
    }
    try {
      localStorage.removeItem('timeline_role');
      localStorage.removeItem('timeline_guest_name');
    } catch (e) {}
    setRole(null);
    setGuestName('');
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
          clientId: getClientId()
        });
      }
    };

    socket.on('connect', handleRejoin);

    // If socket is already connected when component mounts with saved credentials
    if (socket.connected && role === 'guest' && guestName) {
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
  }, [role, guestName]);

  useEffect(() => {
    socket.on('state_update', (newState) => {
      setGameState((prev) => ({ ...prev, ...newState }));
    });

    socket.on('new_click', (clickData) => {
      setGameState((prev) => {
        // Only append if it's not already in the array
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
      socket.off('new_click');
    };
  }, []);

  // Render logic based on role and status
  if (!role) {
    return (
      <LandingScreen 
        socket={socket} 
        setRole={handleSetRole} 
        setGuestName={handleSetGuestName} 
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
      />
    );
  }

  return null;
}

export default App;
