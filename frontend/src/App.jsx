import { useState, useEffect } from 'react'
import { io } from 'socket.io-client'
import LandingScreen from './components/LandingScreen'
import HostScreen from './components/HostScreen'
import GuestScreen from './components/GuestScreen'
import SummaryScreen from './components/SummaryScreen'
import './index.css'

// Connect to backend dynamically based on the URL the user is visiting
// In production (Render), we connect to the same origin (/). In local dev, we connect to port 3001.
const socketUrl = import.meta.env.PROD ? '/' : `http://${window.location.hostname}:3001`;
const socket = io(socketUrl)

function App() {
  const [role, setRole] = useState(null) // 'host' | 'guest'
  const [guestName, setGuestName] = useState('')
  const [gameState, setGameState] = useState({
    status: 'idle',
    durationMinutes: 120,
    speed: 1,
    elapsedTimeMs: 0,
    clicks: []
  })

  useEffect(() => {
    socket.on('state_update', (newState) => {
      setGameState((prev) => ({ ...prev, ...newState }))
    })

    socket.on('new_click', (clickData) => {
      setGameState((prev) => {
        // Only append if it's not already in the array (socket.io might duplicate if state_update is also caught)
        const exists = prev.clicks.some(
          (c) => c.name === clickData.name && c.exactMs === clickData.exactMs && c.val === clickData.val
        )
        if (exists) return prev
        return {
          ...prev,
          clicks: [...prev.clicks, clickData]
        }
      })
    })

    return () => {
      socket.off('state_update')
      socket.off('new_click')
    }
  }, [])

  // Render logic based on role and status
  if (!role) {
    return <LandingScreen setRole={setRole} setGuestName={setGuestName} />
  }

  if (gameState.status === 'finished') {
    return <SummaryScreen state={gameState} onReset={() => socket.emit('reset')} role={role} />
  }

  if (role === 'host') {
    return <HostScreen socket={socket} state={gameState} />
  }

  if (role === 'guest') {
    return <GuestScreen socket={socket} state={gameState} guestName={guestName} />
  }

  return null
}

export default App
