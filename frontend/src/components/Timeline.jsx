import React, { useEffect, useState, useRef } from 'react';

const Timeline = ({ state, guestName, isHost, onGuestClick }) => {
  const containerRef = useRef(null);
  const [localTimeMs, setLocalTimeMs] = useState(state.elapsedTimeMs);

  const totalMs = state.durationMinutes * 60 * 1000;
  const progressPercent = Math.min((localTimeMs / totalMs) * 100, 100);

  // Interpolate time locally for smooth animation between server ticks
  useEffect(() => {
    setLocalTimeMs(state.elapsedTimeMs);
    let animationFrameId;
    let lastUpdate = Date.now();

    const animate = () => {
      if (state.status === 'running') {
        const now = Date.now();
        const delta = now - lastUpdate;
        lastUpdate = now;
        
        setLocalTimeMs((prev) => {
          const next = prev + (delta * state.speed);
          return Math.min(next, totalMs);
        });
      } else {
        lastUpdate = Date.now(); // keep it fresh
      }
      animationFrameId = requestAnimationFrame(animate);
    };

    if (state.status === 'running') {
      animationFrameId = requestAnimationFrame(animate);
    }

    return () => cancelAnimationFrame(animationFrameId);
  }, [state.elapsedTimeMs, state.status, state.speed, totalMs]);

  const handleAreaClick = (val) => {
    if (!isHost && state.status === 'running' && onGuestClick) {
      onGuestClick(val);
    }
  };

  const formatTime = (ms) => {
    const totalSeconds = Math.floor(ms / 1000);
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const ticks = [];
  for (let i = 0; i <= state.durationMinutes; i += 5) {
    ticks.push({
      minute: i,
      isMajor: i % 30 === 0,
      percent: (i / state.durationMinutes) * 100
    });
  }

  // Pre-calculate stack levels for collision detection
  const placedTop = [];
  const placedBottom = [];

  const clicksWithStacks = state.clicks.map(click => {
    const percent = (click.exactMs / totalMs) * 100;
    const isTop = click.val === 1;
    const placed = isTop ? placedTop : placedBottom;
    
    let maxStack = -1;
    placed.forEach(p => {
      // If within 1.5% of timeline width, they collide
      if (Math.abs(p.percent - percent) < 1.5) {
        maxStack = Math.max(maxStack, p.stackLevel);
      }
    });
    
    const stackLevel = maxStack + 1;
    placed.push({ percent, stackLevel });
    
    return { ...click, percent, stackLevel };
  });

  return (
    <div className="timeline-wrapper" ref={containerRef}>
      
      {/* Top Area (+1) */}
      <div 
        className={`interaction-area top ${!isHost && state.status === 'running' ? 'active' : ''}`}
        onClick={() => handleAreaClick(1)}
      >
        {!isHost && state.status === 'running' && <div className="area-hint">Click Here (+1)</div>}
      </div>

      {/* The Central Timeline Bar */}
      <div className="timeline-track">
        <div 
          className="timeline-fill" 
          style={{ width: `${progressPercent}%` }}
        >
           <div className="timeline-glow-head"></div>
        </div>
        
        {/* Render Ruler Ticks */}
        {ticks.map((tick, i) => (
          <div 
            key={`tick-${i}`} 
            className={`timeline-tick ${tick.isMajor ? 'major-tick' : 'minor-tick'}`}
            style={{ left: `${tick.percent}%` }}
          >
            {tick.isMajor && (
              <span className="tick-label">{tick.minute}m</span>
            )}
          </div>
        ))}
        
        {/* Render Clicks as Markers */}
        {clicksWithStacks.map((click, i) => {
          const isTop = click.val === 1;
          const isMe = click.name === guestName;
          
          return (
            <div 
              key={i} 
              className={`marker ${isTop ? 'top-marker' : 'bottom-marker'} ${isMe ? 'my-marker' : ''}`}
              style={{ left: `${click.percent}%`, '--stack': click.stackLevel }}
            >
              <div className="marker-dot"></div>
              <div className="marker-label">
                <span className="marker-name">{click.name}</span>
                <span className={`marker-val ${isTop ? 'plus' : 'minus'}`}>
                  {isTop ? '+1' : '-1'}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Bottom Area (-1) */}
      <div 
        className={`interaction-area bottom ${!isHost && state.status === 'running' ? 'active' : ''}`}
        onClick={() => handleAreaClick(-1)}
      >
        {!isHost && state.status === 'running' && <div className="area-hint">Click Here (-1)</div>}
      </div>
      
      {/* Time display at the bottom center */}
      <div className="timeline-clock glass-panel">
         {formatTime(localTimeMs)} / {state.durationMinutes}:00
      </div>
    </div>
  );
};

export default Timeline;
