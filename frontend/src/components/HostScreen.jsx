import React, { useState } from 'react';
import Timeline from './Timeline';
import VideoPlayer from './VideoPlayer';

const HostScreen = ({ socket, state }) => {
  const [durationInput, setDurationInput] = useState(state.durationMinutes);
  const [videoUrlInput, setVideoUrlInput] = useState('');

  const handleSetDuration = () => {
    socket.emit('set_duration', Number(durationInput));
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

  const handleSetSpeed = (s) => {
    socket.emit('set_speed', s);
  };

  const handleReset = () => {
    socket.emit('reset');
  };

  return (
    <div className="screen-container host-screen">
      <div className="host-dashboard glass-panel">
        <div className="dashboard-header">
          <h2>Host Control Panel</h2>
          <div className="status-badge">
            Status: <span className={`status-${state.status}`}>{state.status.toUpperCase()}</span>
          </div>
        </div>

        <div className="controls">
          <div className="control-group">
            <label>Duration (mins):</label>
            <input 
              type="number" 
              value={durationInput} 
              onChange={(e) => setDurationInput(e.target.value)} 
              disabled={state.status !== 'idle'}
              className="glass-input small-input"
            />
            <button 
              className="btn btn-secondary" 
              onClick={handleSetDuration}
              disabled={state.status !== 'idle'}
            >
              Set
            </button>
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
              style={{ width: '200px' }}
            />
            <button 
              className="btn btn-secondary" 
              onClick={handleSetVideo}
              disabled={state.status !== 'idle' || !videoUrlInput}
            >
              Set Video
            </button>
          </div>

          <div className="control-group">
            <button 
              className="btn btn-primary start-btn" 
              onClick={handleStart}
              disabled={state.status !== 'idle'}
            >
              Start Timeline
            </button>
            <button 
              className="btn btn-danger" 
              onClick={handleReset}
            >
              Reset
            </button>
          </div>

          <div className="control-group speed-controls">
            <label>Speed:</label>
            {[1, 2, 3].map(s => (
              <button 
                key={s}
                className={`btn btn-speed ${state.speed === s ? 'active' : ''}`}
                onClick={() => handleSetSpeed(s)}
                disabled={state.status === 'finished'}
              >
                {s}x
              </button>
            ))}
          </div>
        </div>
      </div>
      
      <div className="split-layout">
        <div className="split-video-pane">
          {/* Video Player */}
          <VideoPlayer videoId={state.videoId} state={state} />
        </div>
        <div className="split-timeline-pane">
          {/* Timeline View for Host (Read Only) */}
          <Timeline state={state} isHost={true} />
        </div>
      </div>
      
    </div>
  );
};

export default HostScreen;
