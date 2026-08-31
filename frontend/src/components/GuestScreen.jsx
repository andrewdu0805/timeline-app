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

  const getDeviceType = () => {
    const ua = navigator.userAgent;
    if (/(tablet|ipad|playbook|silk)|(android(?!.*mobi))/i.test(ua)) return 'Tablet';
    if (/Mobile|Android|iP(hone|od)|IEMobile|BlackBerry|Kindle|Silk-Accelerated|(hpw|web)OS|Opera M(obi|ini)/.test(ua)) return 'Mobile';
    return 'Desktop';
  };
  const isMobilePhone = getDeviceType() === 'Mobile';

  const myClicks = state.clicks.filter(c => c.name === guestName);
  const myPlus = myClicks.filter(c => c.val > 0).reduce((sum, c) => sum + c.val, 0);
  const myMinus = myClicks.filter(c => c.val < 0).reduce((sum, c) => sum + Math.abs(c.val), 0);
  const myBalance = myPlus - myMinus;

  const statusMap = {
    idle: '等待中',
    running: '進行中',
    paused: '已暫停',
    finished: '已結束'
  };

  return (
    <div className={`screen-container guest-screen ${clickEffect || ''}`}>
      <div className="guest-header glass-panel" style={{ padding: '0.5rem 1rem', marginBottom: '0.5rem', display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
        <div className="user-info" style={{ marginRight: '0.5rem' }}>
          名字: <span>{guestName}</span>
        </div>

        <div className="timeline-clock-header" style={{ fontWeight: 'bold', fontSize: '1.2rem', fontFamily: 'monospace', color: 'var(--accent-primary)', letterSpacing: '1px', padding: '0 0.5rem' }}>
          {formatTime(localTimeMs)} / {state.durationMinutes}:00
        </div>

        {state.status !== 'idle' && (
          <div className="live-balance" style={{ display: 'flex', gap: '0.8rem', background: 'rgba(0,0,0,0.4)', padding: '0.3rem 0.8rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', fontSize: '0.9rem', alignItems: 'center' }}>
            <span style={{ color: 'var(--text-secondary)' }}>我的點擊:</span>
            <span style={{ color: 'var(--color-plus)', fontWeight: 'bold' }}>+{myPlus}</span>
            <span style={{ color: 'var(--color-minus)', fontWeight: 'bold' }}>-{myMinus}</span>
            <span style={{ fontWeight: 'bold', marginLeft: '0.5rem', color: myBalance === 0 ? 'var(--text-primary)' : (myBalance > 0 ? 'var(--color-plus)' : 'var(--color-minus)') }}>
              {myBalance === 0 ? '✅ 空手' : `${myBalance > 0 ? '多單: +' : '空單: '}${myBalance}`}
            </span>
          </div>
        )}

        <div className="control-group">
          {state.status === 'running' && (
             <button className="btn btn-primary" style={{ padding: '0.4rem 1rem', backgroundColor: '#f59e0b' }} onClick={handlePause}>暫停</button>
          )}
          {state.status === 'paused' && (
             <button className="btn btn-primary" style={{ padding: '0.4rem 1rem', backgroundColor: '#10b981' }} onClick={handleResume}>繼續</button>
          )}
          <button className="btn btn-secondary" style={{ padding: '0.4rem 0.6rem' }} onClick={() => handleSeek(-10000)} disabled={state.status === 'idle' || state.status === 'finished'}>-10秒</button>
          <button className="btn btn-secondary" style={{ padding: '0.4rem 0.6rem' }} onClick={() => handleSeek(10000)} disabled={state.status === 'idle' || state.status === 'finished'}>+10秒</button>
        </div>

        {state.guests && state.guests.length > 0 && (
          <div 
            className="guest-summary" 
            title={state.guests.map(g => `${g.name} (${g.device})`).join('\n')}
            style={{ 
              cursor: 'help', display: 'flex', gap: '0.5rem', background: 'rgba(255,255,255,0.1)', 
              padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.9rem', marginLeft: 'auto',
              border: '1px solid rgba(255,255,255,0.2)'
            }}
          >
            <span>線上: {state.guests.length} 人</span>
            <span style={{opacity: 0.8}}>
              ({[
                state.guests.some(g => g.device === 'Desktop') ? `💻 ${state.guests.filter(g => g.device === 'Desktop').length}` : '',
                state.guests.some(g => g.device === 'Mobile') ? `📱 ${state.guests.filter(g => g.device === 'Mobile').length}` : '',
                state.guests.some(g => g.device === 'Tablet') ? `📟 ${state.guests.filter(g => g.device === 'Tablet').length}` : ''
              ].filter(Boolean).join(', ')})
            </span>
          </div>
        )}

        <div className="status-badge" style={{ marginLeft: state.guests && state.guests.length > 0 ? '0' : 'auto' }}>
          狀態: <span className={`status-${state.status}`}>{statusMap[state.status] || state.status}</span>
        </div>
      </div>

      <div className="split-layout">
        {!isMobilePhone && (
          <div className="split-video-pane">
            <VideoPlayer videoId={state.videoId} state={state} />
          </div>
        )}
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
