import React, { useState } from 'react';
import Timeline from './Timeline';
import VideoPlayer from './VideoPlayer';

const GuestScreen = ({ socket, state, guestName }) => {
  const [clickEffect, setClickEffect] = useState(null);

  const handleGuestClick = (val) => {
    socket.emit('register_click', { name: guestName, val });
    
    // Trigger visual effect
    setClickEffect(val === 1 ? 'effect-top' : 'effect-bottom');
    setTimeout(() => setClickEffect(null), 300);
  };

  return (
    <div className={`screen-container guest-screen ${clickEffect || ''}`}>
      <div className="guest-header glass-panel">
        <div className="user-info">
          Guest: <span>{guestName}</span>
        </div>
        <div className="status-badge">
            Status: <span className={`status-${state.status}`}>{state.status.toUpperCase()}</span>
        </div>
      </div>

      <div className="split-layout">
        <div className="split-video-pane">
          <VideoPlayer videoId={state.videoId} state={state} />
        </div>
        <div className="split-timeline-pane">
          <Timeline 
            state={state} 
            guestName={guestName} 
            isHost={false} 
            onGuestClick={handleGuestClick} 
          />
        </div>
      </div>
    </div>
  );
};

export default GuestScreen;
