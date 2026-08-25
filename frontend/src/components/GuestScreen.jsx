import React, { useState } from 'react';
import Timeline, { useLocalTime, formatTime } from './Timeline';
import VideoPlayer from './VideoPlayer';

const GuestScreen = ({ socket, state, guestName }) => {
  const [clickEffect, setClickEffect] = useState(null);
  const localTimeMs = useLocalTime(state);

  const handleGuestClick = (val) => {
    socket.emit('register_click', { name: guestName, val });
    
    // Trigger visual effect
    setClickEffect(val === 1 ? 'effect-left' : 'effect-right');
    setTimeout(() => setClickEffect(null), 300);
  };

  const handlePause = () => socket.emit('pause_timeline');
  const handleResume = () => socket.emit('resume_timeline');
  const handleSeek = (ms) => socket.emit('seek_timeline', ms);

  return (
    <div className={`screen-container guest-screen ${clickEffect || ''}`}>
      <div className="guest-header glass-panel" style={{ padding: '0.5rem 1rem', marginBottom: '0.5rem', display: 'flex', flexWrap: 'nowrap', overflowX: 'auto', gap: '0.5rem', alignItems: 'center', whiteSpace: 'nowrap' }}>
        <div className="user-info" style={{ marginRight: '0.5rem' }}>
          Guest: <span>{guestName}</span>
        </div>

        <div className="timeline-clock-header" style={{ fontWeight: 'bold', fontSize: '1.2rem', fontFamily: 'monospace', color: 'var(--accent-primary)', letterSpacing: '1px', padding: '0 0.5rem' }}>
          {formatTime(localTimeMs)} / {state.durationMinutes}:00
        </div>

        <div className="control-group">
          {state.status === 'running' && (
             <button className="btn btn-primary" style={{ padding: '0.4rem 1rem', backgroundColor: '#f59e0b' }} onClick={handlePause}>Pause</button>
          )}
          {state.status === 'paused' && (
             <button className="btn btn-primary" style={{ padding: '0.4rem 1rem', backgroundColor: '#10b981' }} onClick={handleResume}>Resume</button>
          )}
          <button className="btn btn-secondary" style={{ padding: '0.4rem 0.6rem' }} onClick={() => handleSeek(-10000)} disabled={state.status === 'idle' || state.status === 'finished'}>-10s</button>
          <button className="btn btn-secondary" style={{ padding: '0.4rem 0.6rem' }} onClick={() => handleSeek(10000)} disabled={state.status === 'idle' || state.status === 'finished'}>+10s</button>
        </div>

        <div className="status-badge" style={{ marginLeft: 'auto' }}>
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
            onTimelineClick={handleGuestClick} 
          />
        </div>
      </div>
    </div>
  );
};

export default GuestScreen;
