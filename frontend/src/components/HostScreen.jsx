import React, { useState } from 'react';
import Timeline from './Timeline';

const HostScreen = ({ socket, state }) => {
  const [durationInput, setDurationInput] = useState(state.durationMinutes);

  const handleSetDuration = () => {
    socket.emit('set_duration', Number(durationInput));
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
      
      {/* Timeline View for Host (Read Only) */}
      <Timeline state={state} isHost={true} />
      
    </div>
  );
};

export default HostScreen;
