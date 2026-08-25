import React, { useState } from 'react';
import Timeline, { useLocalTime, formatTime } from './Timeline';
import VideoPlayer from './VideoPlayer';

const HostScreen = ({ socket, state }) => {
  const [videoUrlInput, setVideoUrlInput] = useState('');
  const [clickEffect, setClickEffect] = useState(null);
  const localTimeMs = useLocalTime(state);

  const handleDurationReady = (durationSecs) => {
    const mins = Math.ceil(durationSecs / 60);
    if (state.durationMinutes !== mins) {
      socket.emit('set_duration', mins);
    }
  };

  const handleSetVideo = () => {
    // Extract video ID from URL or just use it directly
    let id = videoUrlInput;
    const match = videoUrlInput.match(/(?:v=|\/)([0-9A-Za-z_-]{11}).*/);
    if (match && match[1]) {
      id = match[1];
    }
    socket.emit('set_video_id', id);
    setVideoUrlInput(''); // clear input after setting
  };

  const handleStart = () => {
    socket.emit('start_timeline');
  };

  const handlePause = () => {
    socket.emit('pause_timeline');
  };

  const handleResume = () => {
    socket.emit('resume_timeline');
  };

  const handleSeek = (ms) => {
    socket.emit('seek_timeline', ms);
  };

  const handleSetSpeed = (s) => {
    socket.emit('set_speed', s);
  };

  const handleReset = () => {
    socket.emit('reset');
  };

  const handleHostClick = (val) => {
    socket.emit('register_click', { name: 'Host', val });
    
    // Trigger visual effect
    setClickEffect(val === 1 ? 'effect-left' : 'effect-right');
    setTimeout(() => setClickEffect(null), 300);
  };

  return (
    <div className={`screen-container host-screen ${clickEffect || ''}`}>
      <div className="host-dashboard glass-panel" style={{ padding: '0.5rem 1rem', marginBottom: '0.5rem', display: 'flex', flexWrap: 'nowrap', overflowX: 'auto', gap: '0.5rem', alignItems: 'center', whiteSpace: 'nowrap' }}>
        <h2 style={{ fontSize: '1.1rem', margin: 0, marginRight: '0.5rem' }}>Host Control Panel</h2>
        
        <div className="control-group">
          <label>Duration:</label>
          <span style={{ fontWeight: 'bold', minWidth: '40px' }}>{state.durationMinutes}m</span>
        </div>

        <div className="control-group">
          <label>YouTube Link/ID:</label>
          <input 
            type="text" 
            value={videoUrlInput} 
            onChange={(e) => setVideoUrlInput(e.target.value)} 
            placeholder="e.g. dQw4w9WgXcQ or youtube url"
            disabled={state.status !== 'idle'}
            className="glass-input"
            style={{ width: '180px', padding: '0.4rem 0.5rem' }}
          />
          <button className="btn btn-secondary" style={{ padding: '0.4rem 0.8rem' }} onClick={handleSetVideo} disabled={state.status !== 'idle' || !videoUrlInput}>Set Video</button>
        </div>

        <div className="timeline-clock-header" style={{ fontWeight: 'bold', fontSize: '1.2rem', fontFamily: 'monospace', color: 'var(--accent-primary)', letterSpacing: '1px', padding: '0 0.5rem' }}>
          {formatTime(localTimeMs)} / {state.durationMinutes}:00
        </div>

        <div className="control-group">
          {state.status === 'idle' && (
             <button className="btn btn-primary" style={{ padding: '0.4rem 1rem' }} onClick={handleStart}>Start Timeline</button>
          )}
          {state.status === 'running' && (
             <button className="btn btn-primary" style={{ padding: '0.4rem 1rem', backgroundColor: '#f59e0b' }} onClick={handlePause}>Pause</button>
          )}
          {state.status === 'paused' && (
             <button className="btn btn-primary" style={{ padding: '0.4rem 1rem', backgroundColor: '#10b981' }} onClick={handleResume}>Resume</button>
          )}
          
          <button className="btn btn-secondary" style={{ padding: '0.4rem 0.6rem' }} onClick={() => handleSeek(-10000)} disabled={state.status === 'idle' || state.status === 'finished'}>-10s</button>
          <button className="btn btn-secondary" style={{ padding: '0.4rem 0.6rem' }} onClick={() => handleSeek(10000)} disabled={state.status === 'idle' || state.status === 'finished'}>+10s</button>

          <button className="btn btn-danger" style={{ padding: '0.4rem 1rem' }} onClick={handleReset}>Reset</button>
        </div>

        <div className="control-group speed-controls">
          <label>Speed:</label>
          {[1, 1.5, 2].map(s => (
            <button key={s} className={`btn btn-speed ${state.speed === s ? 'active' : ''}`} style={{ padding: '0.4rem 0.8rem' }} onClick={() => handleSetSpeed(s)} disabled={state.status === 'finished'}>{s}x</button>
          ))}
        </div>

        <div className="status-badge" style={{ marginLeft: 'auto' }}>
          Status: <span className={`status-${state.status}`}>{state.status.toUpperCase()}</span>
        </div>
      </div>
      
      <div className="split-layout">
        <div className="split-video-pane">
          {/* Video Player */}
          <VideoPlayer videoId={state.videoId} state={state} onDurationReady={handleDurationReady} />
        </div>
        <div className="split-timeline-pane">
          {/* Timeline View for Host */}
          <Timeline state={state} guestName="Host" isHost={true} onTimelineClick={handleHostClick} />
        </div>
      </div>
      
    </div>
  );
};

export default HostScreen;
