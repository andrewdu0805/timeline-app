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

  // 1. Group rapid clicks by SAME user (Spam prevention)
  const groupedClicks = [];
  const sortedClicks = [...state.clicks].sort((a, b) => a.exactMs - b.exactMs);
  
  sortedClicks.forEach(click => {
    const mergeWindowMs = 5000; // 5 seconds
    const lastGroup = [...groupedClicks].reverse().find(
      g => g.name === click.name && Math.sign(g.val) === Math.sign(click.val)
    );
    if (lastGroup && (click.exactMs - lastGroup.lastExactMs) <= mergeWindowMs) {
      lastGroup.val += click.val;
      lastGroup.lastExactMs = click.exactMs;
    } else {
      groupedClicks.push({ ...click, lastExactMs: click.exactMs });
    }
  });

  // 2. Cluster VISUALLY overlapping markers (prevent ANY overlap or horizontal pushing)
  const leftClicks = groupedClicks.filter(c => c.val > 0);
  const rightClicks = groupedClicks.filter(c => c.val < 0);

  const createVisualClusters = (clicks) => {
    if (!clicks.length) return [];
    // A label is ~40px. Assuming 600px tall timeline, 40/600 = ~6.6%.
    // If timeline is 120 mins, 6.6% = ~8 mins.
    // We use a fixed 6-minute window (360,000 ms) for clustering to guarantee no overlap.
    const visualMergeWindowMs = 360000; 

    const clusters = [];
    let currentCluster = {
      clicks: [clicks[0]],
      exactMs: clicks[0].exactMs,
      isMe: clicks[0].name === guestName
    };

    for (let i = 1; i < clicks.length; i++) {
      const click = clicks[i];
      if (click.exactMs - currentCluster.exactMs < visualMergeWindowMs) {
        currentCluster.clicks.push(click);
        if (click.name === guestName) currentCluster.isMe = true;
      } else {
        clusters.push(currentCluster);
        currentCluster = { clicks: [click], exactMs: click.exactMs, isMe: click.name === guestName };
      }
    }
    clusters.push(currentCluster);
    return clusters;
  };

  const leftClicksMe = leftClicks.filter(c => c.name === guestName);
  const leftClicksOthers = leftClicks.filter(c => c.name !== guestName);
  const rightClicksMe = rightClicks.filter(c => c.name === guestName);
  const rightClicksOthers = rightClicks.filter(c => c.name !== guestName);

  const leftClustersMe = createVisualClusters(leftClicksMe);
  const leftClustersOthers = createVisualClusters(leftClicksOthers);
  const rightClustersMe = createVisualClusters(rightClicksMe);
  const rightClustersOthers = createVisualClusters(rightClicksOthers);

  const allClusters = [
    ...leftClustersMe.map(c => ({ ...c, isPlus: true, isMe: true })),
    ...leftClustersOthers.map(c => ({ ...c, isPlus: true, isMe: false })),
    ...rightClustersMe.map(c => ({ ...c, isPlus: false, isMe: true })),
    ...rightClustersOthers.map(c => ({ ...c, isPlus: false, isMe: false }))
  ];

  return (
    <div className="timeline-wrapper" ref={containerRef}>
      
      {/* Left Area (+1) */}
      <div 
        className={`interaction-area left-area ${state.status === 'running' && onTimelineClick ? 'active' : ''}`}
        onClick={() => handleAreaClick(1)}
      >
        {state.status === 'running' && onTimelineClick && <div className="area-hint">點擊 (+1)</div>}
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
        
        {/* Render Visual Clusters */}
        {allClusters.map((cluster, i) => {
          const percent = (cluster.exactMs / totalMs) * 100;
          return (
            <ClusterNode 
              key={i} 
              cluster={cluster} 
              isPlus={cluster.isPlus} 
              percent={percent} 
            />
          );
        })}
      </div>

      {/* Right Area (-1) */}
      <div 
        className={`interaction-area right-area ${state.status === 'running' && onTimelineClick ? 'active' : ''}`}
        onClick={() => handleAreaClick(-1)}
      >
        {state.status === 'running' && onTimelineClick && <div className="area-hint">點擊 (-1)</div>}
      </div>
      
    </div>
  );
};

const ClusterNode = ({ cluster, isPlus, percent, guestName }) => {
  const [expanded, setExpanded] = useState(false);

  const toggle = (e) => {
    e.stopPropagation(); // prevent interaction-area click
    setExpanded(!expanded);
  };

  const totalVal = cluster.clicks.reduce((sum, c) => sum + c.val, 0);
  
  return (
    <div 
      className={`marker ${isPlus ? 'left-marker' : 'right-marker'} ${cluster.isMe ? 'my-marker' : ''}`}
      style={{ top: `${percent}%`, zIndex: expanded ? 100 : (cluster.isMe ? 50 : 10) }}
    >
      <div className="marker-dot"></div>
      
      {cluster.clicks.length === 1 && !expanded ? (
        // Single Click View
        <div className="marker-label" onClick={toggle} style={{ cursor: 'pointer' }}>
          <span className="marker-name" style={{ color: cluster.isMe ? '#facc15' : 'inherit' }}>{cluster.clicks[0].name}</span>
          <span className={`marker-val ${isPlus ? 'plus' : 'minus'}`}>
            {isPlus ? `+${cluster.clicks[0].val}` : cluster.clicks[0].val}
          </span>
          <span className="marker-time" style={{ fontSize: '0.65rem', opacity: 0.8, marginTop: '2px' }}>
            {formatTime(cluster.clicks[0].exactMs)}
          </span>
        </div>
      ) : expanded ? (
        // Expanded List View
        <div className="marker-label expanded-cluster" onClick={toggle} style={{ cursor: 'pointer', minWidth: '130px', zIndex: 100 }}>
          <div style={{ borderBottom: '1px solid rgba(255,255,255,0.2)', marginBottom: '6px', paddingBottom: '4px', fontWeight: 'bold', fontSize: '0.75rem', textAlign: 'center' }}>
            {cluster.clicks.length} 筆紀錄 (關閉)
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '200px', overflowY: 'auto' }}>
            {cluster.clicks.map((c, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', borderBottom: i < cluster.clicks.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none', paddingBottom: i < cluster.clicks.length - 1 ? '4px' : '0' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                  <span className="marker-name" style={{ fontSize: '0.75rem', color: c.name === guestName ? '#facc15' : 'inherit' }}>{c.name}</span>
                  <span className="marker-time" style={{ fontSize: '0.65rem', opacity: 0.8 }}>{formatTime(c.exactMs)}</span>
                </div>
                <span className={`marker-val ${isPlus ? 'plus' : 'minus'}`} style={{ fontSize: '0.85rem', fontWeight: 'bold' }}>
                  {isPlus ? `+${c.val}` : c.val}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        // Collapsed Group View (Multiple clicks, but ALL from Me OR ALL from Others)
        <div className="marker-label cluster-summary" onClick={toggle} style={{ cursor: 'pointer', border: isPlus ? '1px solid rgba(239, 68, 68, 0.5)' : '1px solid rgba(16, 185, 129, 0.5)', background: 'rgba(0,0,0,0.8)' }}>
          <span style={{ fontWeight: 'bold', fontSize: '0.75rem', color: isPlus ? 'var(--color-plus)' : 'var(--color-minus)' }}>
            {cluster.isMe ? `${cluster.clicks.length} 次點擊` : `${cluster.clicks.length} 人點擊`}
          </span>
          <span className={`marker-val ${isPlus ? 'plus' : 'minus'}`} style={{ fontSize: '1rem', marginTop: '2px' }}>
            {totalVal > 0 ? `+${totalVal}` : totalVal}
          </span>
          <span className="marker-time" style={{ fontSize: '0.65rem', opacity: 0.8, marginTop: '2px' }}>
            {formatTime(cluster.exactMs)}
          </span>
        </div>
      )}
    </div>
  );
};

export default Timeline;
