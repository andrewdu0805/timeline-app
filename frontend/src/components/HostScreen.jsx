import React, { useState, useRef, useEffect } from 'react';
import Timeline, { useLocalTime, formatTime } from './Timeline';
import VideoPlayer from './VideoPlayer';
import { parseHistoricalFile, parseTimeStringToSec, parseVideoTimeToMs } from '../utils/priceDataParser';

const HostScreen = ({ socket, state, onLogout }) => {
  const [videoUrlInput, setVideoUrlInput] = useState('');
  const [clickEffect, setClickEffect] = useState(null);
  const [anchorMarketInput, setAnchorMarketInput] = useState('');
  const [anchorVideoInput, setAnchorVideoInput] = useState('00:00');
  const [priceError, setPriceError] = useState('');
  const [driveStatus, setDriveStatus] = useState(null); // { status, title, fileName, message }
  const [showDriveConfig, setShowDriveConfig] = useState(false);
  const [driveBridgeUrl, setDriveBridgeUrl] = useState(() => {
    try {
      return localStorage.getItem('timeline_gdrive_bridge_url') || '';
    } catch (e) {
      return '';
    }
  });
  const [driveUrlDraft, setDriveUrlDraft] = useState(() => {
    try {
      return localStorage.getItem('timeline_gdrive_bridge_url') || '';
    } catch (e) {
      return '';
    }
  });
  const fileInputRef = useRef(null);
  const localTimeMs = useLocalTime(state);

  const hasDriveConnected = Boolean(state.hasServerDriveBridge || driveBridgeUrl);

  // Listen for automatic Google Drive price file results from backend
  useEffect(() => {
    if (!socket) return;

    const handleDriveStatus = (info) => {
      setDriveStatus(info);
    };

    const handleDriveFile = async ({ fileName, base64 }) => {
      setPriceError('');
      try {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        const virtualFile = {
          name: fileName || 'drive.csv',
          arrayBuffer: async () => bytes.buffer
        };
        const parsed = await parseHistoricalFile(virtualFile);
        const defaultMarketTime = parsed.firstTimeStr;
        setAnchorVideoInput('00:00');
        setAnchorMarketInput(defaultMarketTime);

        socket.emit('set_price_data', {
          rows: parsed.rows,
          sourceLabel: `☁️ ${parsed.sourceLabel}`,
          intervalSec: parsed.intervalSec,
          firstTimeStr: parsed.firstTimeStr,
          lastTimeStr: parsed.lastTimeStr,
          anchorVideoMs: 0,
          anchorMarketSec: parsed.firstTimeSec,
          anchorMarketTime: defaultMarketTime
        });
        setDriveStatus({ status: 'loaded', fileName });
      } catch (err) {
        setDriveStatus(null);
        setPriceError(`雲端檔案「${fileName}」解析失敗：${err.message || ''}`);
      }
    };

    socket.on('drive_sync_status', handleDriveStatus);
    socket.on('drive_price_file', handleDriveFile);

    return () => {
      socket.off('drive_sync_status', handleDriveStatus);
      socket.off('drive_price_file', handleDriveFile);
    };
  }, [socket]);

  const handleSaveDriveUrl = () => {
    const trimmed = driveUrlDraft.trim();
    if (trimmed && !trimmed.startsWith('https://script.google.com/') && !trimmed.startsWith('https://script.googleusercontent.com/')) {
      setPriceError('雲端橋樑網址必須是 https://script.google.com/... 開頭');
      return;
    }
    setPriceError('');
    setDriveBridgeUrl(trimmed);
    try {
      if (trimmed) localStorage.setItem('timeline_gdrive_bridge_url', trimmed);
      else localStorage.removeItem('timeline_gdrive_bridge_url');
    } catch (e) {}
    setShowDriveConfig(false);
    // If a video is already set in idle state, trigger lookup immediately
    if (trimmed && state.videoId && state.status === 'idle') {
      socket.emit('set_video_id', { id: state.videoId, driveBridgeUrl: trimmed });
    }
  };

  // Sync anchor display if state already has priceDataInfo (e.g. after refresh)
  useEffect(() => {
    if (state.priceDataInfo) {
      if (state.priceDataInfo.anchorMarketTime && !anchorMarketInput) {
        setAnchorMarketInput(state.priceDataInfo.anchorMarketTime);
      }
      if (typeof state.priceDataInfo.anchorVideoMs === 'number') {
        const totalSec = Math.floor(state.priceDataInfo.anchorVideoMs / 1000);
        const m = Math.floor(totalSec / 60);
        const s = totalSec % 60;
        setAnchorVideoInput(`${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`);
      }
    }
  }, [state.priceDataInfo]);

  const handlePriceFileUpload = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setPriceError('');
    try {
      const parsed = await parseHistoricalFile(file);
      const videoMs = parseVideoTimeToMs(anchorVideoInput);
      const defaultMarketTime = parsed.firstTimeStr;
      setAnchorMarketInput(defaultMarketTime);

      socket.emit('set_price_data', {
        rows: parsed.rows,
        sourceLabel: parsed.sourceLabel,
        intervalSec: parsed.intervalSec,
        firstTimeStr: parsed.firstTimeStr,
        lastTimeStr: parsed.lastTimeStr,
        anchorVideoMs: videoMs,
        anchorMarketSec: parsed.firstTimeSec,
        anchorMarketTime: defaultMarketTime
      });
    } catch (err) {
      setPriceError(err.message || '解析歷史報價檔失敗');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleApplyAnchor = (nextVideoStr, nextMarketStr) => {
    if (!state.priceDataInfo) return;
    const vMs = parseVideoTimeToMs(nextVideoStr);
    const mSec = parseTimeStringToSec(nextMarketStr);
    if (mSec === null) {
      setPriceError('盤面時間格式請輸入 HH:MM 或 HH:MM:SS（例如 08:45:00）');
      return;
    }
    setPriceError('');
    socket.emit('update_price_anchor', {
      anchorVideoMs: vMs,
      anchorMarketSec: mSec,
      anchorMarketTime: nextMarketStr.trim()
    });
  };

  const handleClearPriceData = () => {
    setPriceError('');
    setDriveStatus(null);
    setAnchorMarketInput('');
    setAnchorVideoInput('00:00');
    socket.emit('clear_price_data');
  };

  const handleDurationReady = (durationSecs, title) => {
    const mins = Math.ceil(durationSecs / 60);
    if (state.durationMinutes !== mins || (title && state.videoTitle !== title)) {
      socket.emit('set_video_metadata', { minutes: mins, title, driveBridgeUrl });
    }
  };

  const handleSetVideo = () => {
    const raw = videoUrlInput.trim();
    if (!raw) return;
    let id = raw;
    const match = raw.match(/(?:v=|\/|embed\/|shorts\/)([0-9A-Za-z_-]{11})/);
    if (match && match[1]) {
      id = match[1];
    }
    setDriveStatus(null);
    socket.emit('set_video_id', { id, driveBridgeUrl });
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

  const myClicks = state.clicks.filter(c => c.name === 'Host');
  const myPlus = myClicks.filter(c => c.val > 0).reduce((sum, c) => sum + c.val, 0);
  const myMinus = myClicks.filter(c => c.val < 0).reduce((sum, c) => sum + Math.abs(c.val), 0);
  const myBalance = myPlus - myMinus;

  const handleClosePosition = () => {
    if (state.status === 'running' && myBalance !== 0) {
      const closeVal = -myBalance;
      socket.emit('register_click', { name: 'Host', val: closeVal, isClose: true });
      setClickEffect(closeVal > 0 ? 'effect-left' : 'effect-right');
      setTimeout(() => setClickEffect(null), 300);
    }
  };

  return (
    <div className={`screen-container host-screen ${clickEffect || ''}`}>
      <div className="host-dashboard glass-panel" style={{ padding: '0.5rem 1rem', marginBottom: '0.5rem', display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginRight: '0.5rem' }}>
          <h2 style={{ fontSize: '1.1rem', margin: 0 }}>Host Control Panel</h2>
          <span
            style={{
              background: 'rgba(59, 130, 246, 0.2)',
              border: '1px solid rgba(59, 130, 246, 0.5)',
              color: '#93c5fd',
              fontSize: '0.78rem',
              fontWeight: 'bold',
              padding: '1px 7px',
              borderRadius: '4px'
            }}
          >
            🏫 {state.roomName || `教室 ${state.roomId || '1'}`}
          </span>
          {onLogout && (
            <button 
              onClick={onLogout}
              title="退出主機身分"
              style={{ 
                background: 'rgba(255,255,255,0.1)', 
                border: '1px solid rgba(255,255,255,0.2)', 
                color: 'var(--text-secondary)', 
                cursor: 'pointer', 
                fontSize: '0.72rem',
                padding: '1px 6px',
                borderRadius: '4px',
                lineHeight: '1.4'
              }}
            >
              退出
            </button>
          )}
        </div>
        
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
          {state.videoId && (
            <a 
              href={`https://youtu.be/${state.videoId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="guest-video-link"
              style={{ marginLeft: '0.3rem' }}
              title={state.videoTitle ? `${state.videoTitle}\nhttps://youtu.be/${state.videoId}` : `https://youtu.be/${state.videoId}`}
            >
              <span>📺</span>
              <span className="guest-video-link-text">youtu.be/{state.videoId}</span>
              <span style={{ fontSize: '0.7rem', opacity: 0.8 }}>↗</span>
            </a>
          )}
        </div>

        {/* Historical Price Data Upload & Anchor Time (Optional) */}
        <div className="control-group" style={{ gap: '0.4rem', flexWrap: 'wrap' }}>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={handlePriceFileUpload}
            style={{ display: 'none' }}
          />
          <button
            type="button"
            className="btn btn-secondary"
            style={{ padding: '0.4rem 0.7rem', fontSize: '0.82rem' }}
            onClick={() => fileInputRef.current && fileInputRef.current.click()}
            disabled={state.status !== 'idle'}
            title="手動上傳 XQ (.xlsx/.csv) 或 TradingView (.csv) 歷史收盤價資料"
          >
            📊 {state.priceDataInfo ? '更換歷史資料' : '上傳歷史資料'}
          </button>

          {state.status === 'idle' && (
            <button
              type="button"
              className="btn btn-secondary"
              style={{
                padding: '0.4rem 0.65rem',
                fontSize: '0.78rem',
                borderColor: hasDriveConnected ? 'rgba(16, 185, 129, 0.5)' : undefined,
                color: hasDriveConnected ? '#a7f3d0' : undefined
              }}
              onClick={() => setShowDriveConfig(!showDriveConfig)}
              title="設定 Google 雲端硬碟自動抓取橋樑網址（設定一次即可）"
            >
              ☁️ {hasDriveConnected ? '雲端已連結' : '雲端設定'}
            </button>
          )}

          {showDriveConfig && state.status === 'idle' && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              background: 'rgba(15, 23, 42, 0.85)',
              border: '1px solid rgba(148, 163, 184, 0.35)',
              padding: '0.3rem 0.55rem',
              borderRadius: '6px',
              fontSize: '0.78rem',
              flexWrap: 'wrap'
            }}>
              <input
                type="text"
                value={driveUrlDraft}
                onChange={(e) => setDriveUrlDraft(e.target.value)}
                placeholder="貼上 Google Apps Script 網址 (https://script.google.com/macros/s/.../exec)"
                className="glass-input"
                style={{ width: '280px', padding: '0.25rem 0.45rem', fontSize: '0.76rem' }}
              />
              <button
                type="button"
                className="btn btn-primary"
                style={{ padding: '0.25rem 0.6rem', fontSize: '0.76rem' }}
                onClick={handleSaveDriveUrl}
              >
                儲存
              </button>
            </div>
          )}

          {driveStatus && driveStatus.status === 'searching' && (
            <span style={{ color: '#93c5fd', fontSize: '0.78rem' }}>
              ⏳ 正在雲端尋找「{driveStatus.title}」...
            </span>
          )}
          {driveStatus && driveStatus.status === 'not_found' && !state.priceDataInfo && (
            <span style={{ color: '#fde68a', fontSize: '0.78rem' }}>
              ℹ️ 雲端找不到「{driveStatus.title}」同名檔（可手動上傳）
            </span>
          )}
          {driveStatus && driveStatus.status === 'error' && !state.priceDataInfo && (
            <span style={{ color: '#fca5a5', fontSize: '0.78rem' }}>
              ⚠️ {driveStatus.message || '雲端讀取失敗'}
            </span>
          )}

          {state.priceDataInfo && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              background: 'rgba(16, 185, 129, 0.14)',
              border: '1px solid rgba(16, 185, 129, 0.45)',
              padding: '0.2rem 0.55rem',
              borderRadius: '6px',
              fontSize: '0.78rem',
              color: '#a7f3d0',
              flexWrap: 'wrap'
            }}>
              <span style={{ fontWeight: 'bold' }}>
                ✅ {state.priceDataInfo.sourceLabel} {state.priceDataInfo.intervalSec <= 1 ? '1秒K' : `${Math.round(state.priceDataInfo.intervalSec / 60)}分K`} ({state.priceDataInfo.count}筆)
              </span>
              <span style={{ opacity: 0.85 }}>影片</span>
              <input
                type="text"
                value={anchorVideoInput}
                onChange={(e) => setAnchorVideoInput(e.target.value)}
                onBlur={() => handleApplyAnchor(anchorVideoInput, anchorMarketInput)}
                disabled={state.status !== 'idle'}
                title="對齊的影片時間（預設 00:00）"
                style={{
                  width: '48px',
                  padding: '1px 4px',
                  fontSize: '0.76rem',
                  background: 'rgba(0,0,0,0.35)',
                  border: '1px solid rgba(255,255,255,0.25)',
                  borderRadius: '4px',
                  color: '#fff',
                  textAlign: 'center',
                  fontFamily: 'monospace'
                }}
              />
              <span style={{ opacity: 0.85 }}>= 盤面</span>
              <input
                type="text"
                value={anchorMarketInput}
                onChange={(e) => setAnchorMarketInput(e.target.value)}
                onBlur={() => handleApplyAnchor(anchorVideoInput, anchorMarketInput)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleApplyAnchor(anchorVideoInput, anchorMarketInput);
                }}
                disabled={state.status !== 'idle'}
                placeholder="08:45:00"
                title="該影片時間點對應的盤面時間（格式 HH:MM 或 HH:MM:SS）"
                style={{
                  width: '68px',
                  padding: '1px 4px',
                  fontSize: '0.76rem',
                  background: 'rgba(0,0,0,0.35)',
                  border: '1px solid rgba(255,255,255,0.25)',
                  borderRadius: '4px',
                  color: '#fff',
                  textAlign: 'center',
                  fontFamily: 'monospace'
                }}
              />
              {state.status === 'idle' && (
                <button
                  type="button"
                  onClick={handleClearPriceData}
                  title="移除歷史資料"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#fca5a5',
                    cursor: 'pointer',
                    fontSize: '0.85rem',
                    padding: '0 2px',
                    lineHeight: 1
                  }}
                >
                  ✕
                </button>
              )}
            </div>
          )}

          {priceError && (
            <span style={{ color: '#fca5a5', fontSize: '0.78rem' }}>⚠️ {priceError}</span>
          )}
        </div>

        <div className="timeline-clock-header" style={{ fontWeight: 'bold', fontSize: '1.2rem', fontFamily: 'monospace', color: 'var(--accent-primary)', letterSpacing: '1px', padding: '0 0.5rem' }}>
          {formatTime(localTimeMs)} / {state.durationMinutes}:00
        </div>

        {state.status !== 'idle' && (
          <div className="live-balance" style={{ display: 'flex', gap: '0.8rem', background: 'rgba(0,0,0,0.4)', padding: '0.3rem 0.8rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', fontSize: '0.9rem', alignItems: 'center' }}>
            <span style={{ color: 'var(--text-secondary)' }}>My Clicks:</span>
            <span style={{ color: 'var(--color-plus)', fontWeight: 'bold' }}>+{myPlus}</span>
            <span style={{ color: 'var(--color-minus)', fontWeight: 'bold' }}>-{myMinus}</span>
            <span style={{ fontWeight: 'bold', marginLeft: '0.5rem', color: myBalance === 0 ? 'var(--text-primary)' : (myBalance > 0 ? 'var(--color-plus)' : 'var(--color-minus)') }}>
              {myBalance === 0 ? '✅ 空手' : `${myBalance > 0 ? '多單: +' : '空單: '}${myBalance}${Math.abs(myBalance) >= 10 ? ' (滿倉)' : ''}`}
            </span>
            {myBalance !== 0 && (
              <button
                type="button"
                onClick={handleClosePosition}
                disabled={state.status !== 'running'}
                title="一鍵平倉（直接轉為空手 0）"
                style={{
                  marginLeft: '0.3rem',
                  padding: '2px 9px',
                  fontSize: '0.82rem',
                  fontWeight: 'bold',
                  color: '#fff',
                  background: state.status === 'running' ? 'linear-gradient(135deg, #f59e0b, #d97706)' : 'rgba(255,255,255,0.15)',
                  border: '1px solid rgba(251, 191, 36, 0.7)',
                  borderRadius: '4px',
                  cursor: state.status === 'running' ? 'pointer' : 'not-allowed',
                  boxShadow: state.status === 'running' ? '0 2px 6px rgba(245, 158, 11, 0.35)' : 'none',
                  lineHeight: '1.3',
                  whiteSpace: 'nowrap'
                }}
              >
                平倉
              </button>
            )}
          </div>
        )}

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
          
          <button className="btn btn-danger" style={{ padding: '0.4rem 1rem' }} onClick={() => socket.emit('end_timeline')} disabled={state.status === 'idle' || state.status === 'finished'}>Finish & Output Data</button>

          <button className="btn btn-secondary" style={{ padding: '0.4rem 1rem', marginLeft: '0.5rem' }} onClick={handleReset}>Clear All Data</button>
        </div>

        <div className="control-group speed-controls">
          <label>Speed:</label>
          {[1, 1.5, 2].map(s => (
            <button key={s} className={`btn btn-speed ${state.speed === s ? 'active' : ''}`} style={{ padding: '0.4rem 0.8rem' }} onClick={() => handleSetSpeed(s)} disabled={state.status === 'finished'}>{s}x</button>
          ))}
        </div>

        {state.guests && state.guests.length > 0 && (
          <div 
            className="guest-summary" 
            title={state.guests.map(g => `${g.name} (${g.device})${g.isOnline === false ? ' [切換網頁中]' : ''}`).join('\n')}
            style={{ 
              cursor: 'help', display: 'flex', gap: '0.5rem', background: 'rgba(255,255,255,0.1)', 
              padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.9rem', marginLeft: 'auto',
              border: '1px solid rgba(255,255,255,0.2)'
            }}
          >
            <span>Guests: {state.guests.length}</span>
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
