import React, { useState, useRef, useEffect } from 'react';
import { getDeviceType, getClientId } from '../App';

const LandingScreen = ({
  socket,
  setRole,
  setGuestName,
  selectedRoomId = '1',
  setSelectedRoomId,
  roomsList = [],
  roomsFullNotice = null,
  setRoomsFullNotice,
  maxRooms = 5
}) => {
  const [nameInput, setNameInput] = useState(() => {
    try {
      return localStorage.getItem('timeline_guest_name') || '';
    } catch (e) {
      return '';
    }
  });
  const [hostPending, setHostPending] = useState(false);
  const nameInputRef = useRef(null);

  const statusTextMap = {
    idle: '待機中',
    running: '進行中',
    paused: '已暫停',
    finished: '已結束'
  };

  const isFull = roomsList.length >= maxRooms;

  // When classrooms are full: make sure a valid classroom is pre-selected and focus the name box
  useEffect(() => {
    if (!roomsFullNotice) return;
    const exists = roomsList.some(r => String(r.roomId) === String(selectedRoomId));
    if (!exists && roomsList.length > 0 && setSelectedRoomId) {
      const firstHosted = roomsList.find(r => r.hasHost) || roomsList[0];
      setSelectedRoomId(firstHosted.roomId);
    }
    if (nameInputRef.current) nameInputRef.current.focus();
  }, [roomsFullNotice, roomsList, selectedRoomId, setSelectedRoomId]);

  const handleJoinGuest = (e) => {
    e.preventDefault();
    const name = nameInput.trim();
    if (name) {
      const targetRoomId = roomsList.length >= 2 ? selectedRoomId : (roomsList[0]?.roomId || '1');
      if (setSelectedRoomId) setSelectedRoomId(targetRoomId);
      if (setRoomsFullNotice) setRoomsFullNotice(null);
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
    if (!socket || hostPending) return;
    setHostPending(true);
    // Every press of the Host button asks the server for a brand-new classroom.
    // Only enter Host mode once the server confirms; if the limit is reached, stay here and pick a classroom.
    socket.timeout(8000).emit(
      'join_as_host',
      { clientId: getClientId(), forceNew: true },
      (err, res) => {
        setHostPending(false);
        if (err) {
          alert('連線逾時，請稍後再試一次。');
          return;
        }
        if (res && res.ok) {
          if (setRoomsFullNotice) setRoomsFullNotice(null);
          if (setSelectedRoomId && res.roomId) setSelectedRoomId(res.roomId);
          setRole('host');
        }
        // If not ok (classrooms full), App receives 'rooms_full' and shows the notice below.
      }
    );
  };

  return (
    <div className="landing-container">
      <div className="glass-card">
        <h1 className="title">Timeline Tracker</h1>
        <p className="subtitle">Join the journey in real-time</p>

        {roomsFullNotice && (
          <div
            style={{
              marginBottom: '0.9rem',
              padding: '0.65rem 0.8rem',
              borderRadius: '8px',
              border: '1px solid rgba(251, 191, 36, 0.6)',
              background: 'rgba(245, 158, 11, 0.15)',
              color: '#fde68a',
              fontSize: '0.86rem',
              lineHeight: 1.5,
              textAlign: 'left'
            }}
          >
            <div style={{ fontWeight: 'bold', marginBottom: '0.2rem' }}>
              ⚠️ 教室已滿（{roomsList.length}/{roomsFullNotice.maxRooms || maxRooms} 間），無法再開新教室
            </div>
            <div>請在下方選擇一間已開好的教室，輸入名字後加入。</div>
          </div>
        )}
        
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
              ref={nameInputRef}
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
            disabled={hostPending}
            title={isFull ? `教室已達上限 ${maxRooms} 間` : '開一間新的教室'}
          >
            {hostPending ? '建立中…' : '以 Host 主機建立'}
          </button>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.4rem', textAlign: 'center' }}>
            目前教室：{roomsList.length}/{maxRooms} 間{isFull ? '（已滿）' : ''}
          </div>
        </div>
      </div>
    </div>
  );
};

export default LandingScreen;
