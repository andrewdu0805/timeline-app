import React, { useEffect, useState, useRef } from 'react';

export const formatTime = (ms) => {
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

export const useLocalTime = (state) => {
  const [localTimeMs, setLocalTimeMs] = useState(state.elapsedTimeMs);
  const totalMs = state.durationMinutes * 60 * 1000;

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
        lastUpdate = Date.now();
      }
      animationFrameId = requestAnimationFrame(animate);
    };

    if (state.status === 'running') {
      animationFrameId = requestAnimationFrame(animate);
    }

    return () => cancelAnimationFrame(animationFrameId);
  }, [state.elapsedTimeMs, state.status, state.speed, totalMs]);

  return localTimeMs;
};

const Timeline = ({ state, guestName, isHost, onTimelineClick }) => {
  const containerRef = useRef(null);
  const localTimeMs = useLocalTime(state);

  const totalMs = state.durationMinutes * 60 * 1000;
  const progressPercent = Math.min((localTimeMs / totalMs) * 100, 100);

  const handleAreaClick = (val) => {
    if (state.status === 'running' && onTimelineClick) {
      onTimelineClick(val);
    }
  };

  const ticks = [];
  for (let i = 0; i <= state.durationMinutes; i += 5) {
    ticks.push({
      minute: i,
      isMajor: i % 30 === 0,
      percent: (i / state.durationMinutes) * 100
    });
  }

  // Group rapid clicks to prevent UI spam
  const groupedClicks = [];
  const sortedClicks = [...state.clicks].sort((a, b) => a.exactMs - b.exactMs);
  
  sortedClicks.forEach(click => {
    // Find the most recent group by this user for this side
    const mergeWindowMs = 5000; // Group clicks within 5 seconds
    const lastGroup = [...groupedClicks].reverse().find(
      g => g.name === click.name && Math.sign(g.val) === Math.sign(click.val)
    );
    
    if (lastGroup && (click.exactMs - lastGroup.lastExactMs) <= mergeWindowMs) {
      // Merge into existing group
      lastGroup.val += click.val;
      lastGroup.lastExactMs = click.exactMs;
    } else {
      // Start a new group
      groupedClicks.push({
        ...click,
        lastExactMs: click.exactMs
      });
    }
  });

  // Pre-calculate stack levels for collision detection on grouped clicks
  const placedLeft = [];
  const placedRight = [];

  const clicksWithStacks = groupedClicks.map(click => {
    const percent = (click.exactMs / totalMs) * 100;
    const isPlus = click.val > 0;
    const placed = isPlus ? placedLeft : placedRight;
    
    let maxStack = -1;
    placed.forEach(p => {
      // If within 1.5% of timeline height, they collide
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
      
      {/* Left Area (+1) */}
      <div 
        className={`interaction-area left-area ${state.status === 'running' && onTimelineClick ? 'active' : ''}`}
        onClick={() => handleAreaClick(1)}
      >
        {state.status === 'running' && onTimelineClick && <div className="area-hint">Click (+1)</div>}
      </div>

      {/* The Central Timeline Bar */}
      <div className="timeline-track">
        <div 
          className="timeline-fill" 
          style={{ height: `${progressPercent}%` }}
        >
           <div className="timeline-glow-head"></div>
        </div>
        
        {/* Render Ruler Ticks */}
        {ticks.map((tick, i) => (
          <div 
            key={`tick-${i}`} 
            className={`timeline-tick ${tick.isMajor ? 'major-tick' : 'minor-tick'}`}
            style={{ top: `${tick.percent}%` }}
          >
            {tick.isMajor && (
              <span className="tick-label">{tick.minute}m</span>
            )}
          </div>
        ))}
        
        {/* Render Clicks as Markers */}
        {clicksWithStacks.map((click, i) => {
          const isPlus = click.val === 1;
          const isMe = click.name === guestName;
          
          return (
            <div 
              key={i} 
              className={`marker ${isPlus ? 'left-marker' : 'right-marker'} ${isMe ? 'my-marker' : ''}`}
              style={{ top: `${click.percent}%`, '--stack': click.stackLevel }}
            >
              <div className="marker-dot"></div>
              <div className="marker-label" title={`Time: ${formatTime(click.exactMs)}`}>
                <span className="marker-name">{click.name}</span>
                <span className={`marker-val ${isPlus ? 'plus' : 'minus'}`}>
                  {isPlus ? `+${click.val}` : click.val}
                </span>
                <span className="marker-time" style={{ fontSize: '0.65rem', opacity: 0.8, marginTop: '2px' }}>
                  {formatTime(click.exactMs)}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Right Area (-1) */}
      <div 
        className={`interaction-area right-area ${state.status === 'running' && onTimelineClick ? 'active' : ''}`}
        onClick={() => handleAreaClick(-1)}
      >
        {state.status === 'running' && onTimelineClick && <div className="area-hint">Click (-1)</div>}
      </div>
      
    </div>
  );
};

export default Timeline;

