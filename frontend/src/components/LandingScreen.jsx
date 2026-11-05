import React, { useState } from 'react';
import { getDeviceType, getClientId } from '../App';

const LandingScreen = ({ socket, setRole, setGuestName, selectedRoomId = '1', setSelectedRoomId, roomsList = [] }) => {
  const [nameInput, setNameInput] = useState('');

  const statusTextMap = {
    idle: '待機中',
    running: '進行中',
    paused: '已暫停',
    finished: '已結束'
  };

  const handleJoinGuest = (e) => {
    e.preventDefault();
    const name = nameInput.trim();
    if (name) {
      const targetRoomId = roomsList.length >= 2 ? selectedRoomId : (roomsList[0]?.roomId || '1');
      if (setSelectedRoomId) setSelectedRoomId(targetRoomId);
      setGuestName(name);
      setRole('guest');
      if (socket) {
        socket.emit('join_as_guest', { 
          name, 
          device: getDeviceType(), 
          clientId: getClientId(),
          roomId: targetRoomId
        });
      }
    }
  };

  const handleJoinHost = () => {
    if (socket) {
      socket.emit('join_as_host', {
        clientId: getClientId()
      });
    }
    setRole('host');
  };

  return (
    <div className="landing-container">
      <div className="glass-card">
        <h1 className="title">Timeline Tracker</h1>
        <p className="subtitle">Join the journey in real-time</p>
        
        <div className="actions">
          <form className="guest-form" onSubmit={handleJoinGuest}>
            {roomsList && roomsList.length >= 2 && (
              <div style={{ marginBottom: '0.6rem', textAlign: 'left' }}>
                <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>
                  目前有多間教室開啟，請選擇要加入的教室：
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                  {roomsList.map((r) => {
                    const isSelected = String(selectedRoomId) === String(r.roomId);
                    return (
                      <button
                        key={r.roomId}
                        type="button"
                        onClick={() => setSelectedRoomId && setSelectedRoomId(r.roomId)}
                        style={{
                          flex: '1 1 calc(50% - 0.4rem)',
                          padding: '0.45rem 0.6rem',
                          borderRadius: '8px',
                          border: isSelected ? '2px solid var(--accent-primary)' : '1px solid rgba(255,255,255,0.2)',
                          background: isSelected ? 'rgba(59, 130, 246, 0.25)' : 'rgba(255,255,255,0.06)',
                          color: 'var(--text-primary)',
                          cursor: 'pointer',
                          fontSize: '0.85rem',
                          fontWeight: isSelected ? 'bold' : 'normal',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          gap: '2px',
                          transition: 'all 0.15s ease'
                        }}
                      >
                        <span>🏫 {r.roomName}</span>
                        <span style={{ fontSize: '0.72rem', opacity: 0.85 }}>
                          {statusTextMap[r.status] || r.status} · 👥 {r.guestCount}人
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <input 
              type="text" 
              placeholder="輸入您的名字" 
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              required
              className="glass-input"
            />
            <button type="submit" className="btn btn-primary">
              {roomsList && roomsList.length >= 2 
                ? `以 Guest 加入（教室 ${selectedRoomId}）` 
                : '以 Guest 身分加入'}
            </button>
          </form>

          <div className="divider">
            <span>OR</span>
          </div>

          <button 
            className="btn btn-secondary" 
            onClick={handleJoinHost}
          >
            以 Host 主機建立
          </button>
        </div>
      </div>
    </div>
  );
};

export default LandingScreen;
