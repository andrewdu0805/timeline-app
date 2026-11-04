import React, { useState } from 'react';
import { getDeviceType, getClientId } from '../App';

const LandingScreen = ({ socket, setRole, setGuestName }) => {
  const [nameInput, setNameInput] = useState('');

  const handleJoinGuest = (e) => {
    e.preventDefault();
    const name = nameInput.trim();
    if (name) {
      setGuestName(name);
      setRole('guest');
      if (socket) {
        socket.emit('join_as_guest', { 
          name, 
          device: getDeviceType(), 
          clientId: getClientId() 
        });
      }
    }
  };

  return (
    <div className="landing-container">
      <div className="glass-card">
        <h1 className="title">Timeline Tracker</h1>
        <p className="subtitle">Join the journey in real-time</p>
        
        <div className="actions">
          <form className="guest-form" onSubmit={handleJoinGuest}>
            <input 
              type="text" 
              placeholder="輸入您的名字" 
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              required
              className="glass-input"
            />
            <button type="submit" className="btn btn-primary">以 Guest 身分加入</button>
          </form>

          <div className="divider">
            <span>OR</span>
          </div>

          <button 
            className="btn btn-secondary" 
            onClick={() => setRole('host')}
          >
            以 Host 主機建立
          </button>
        </div>
      </div>
    </div>
  );
};

export default LandingScreen;
