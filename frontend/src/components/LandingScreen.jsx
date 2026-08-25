import React, { useState } from 'react';

const LandingScreen = ({ socket, setRole, setGuestName }) => {
  const [nameInput, setNameInput] = useState('');

  const getDeviceType = () => {
    const ua = navigator.userAgent;
    if (/(tablet|ipad|playbook|silk)|(android(?!.*mobi))/i.test(ua)) return 'Tablet';
    if (/Mobile|Android|iP(hone|od)|IEMobile|BlackBerry|Kindle|Silk-Accelerated|(hpw|web)OS|Opera M(obi|ini)/.test(ua)) return 'Mobile';
    return 'Desktop';
  };

  const handleJoinGuest = (e) => {
    e.preventDefault();
    const name = nameInput.trim();
    if (name) {
      setGuestName(name);
      setRole('guest');
      if (socket) socket.emit('join_as_guest', { name, device: getDeviceType() });
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
              placeholder="Enter your name" 
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              required
              className="glass-input"
            />
            <button type="submit" className="btn btn-primary">Join as Guest</button>
          </form>

          <div className="divider">
            <span>OR</span>
          </div>

          <button 
            className="btn btn-secondary" 
            onClick={() => setRole('host')}
          >
            Create as Host
          </button>
        </div>
      </div>
    </div>
  );
};

export default LandingScreen;
