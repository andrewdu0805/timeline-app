import React, { useState } from 'react';

const LandingScreen = ({ setRole, setGuestName }) => {
  const [nameInput, setNameInput] = useState('');

  const handleJoinGuest = (e) => {
    e.preventDefault();
    if (nameInput.trim()) {
      setGuestName(nameInput.trim());
      setRole('guest');
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
