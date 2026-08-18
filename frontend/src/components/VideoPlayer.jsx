import React, { useRef, useEffect } from 'react';
import YouTube from 'react-youtube';

const VideoPlayer = ({ videoId, state }) => {
  const playerRef = useRef(null);
  const latestTimeRef = useRef(state.elapsedTimeMs);

  useEffect(() => {
    latestTimeRef.current = state.elapsedTimeMs;
  }, [state.elapsedTimeMs]);

  const syncPlayer = () => {
    if (!playerRef.current || !videoId) return;

    const player = playerRef.current;
    
    try {
      player.setPlaybackRate(state.speed);

      if (state.status === 'running') {
        const currentVideoTime = player.getCurrentTime() || 0;
        const expectedTime = latestTimeRef.current / 1000;
        
        if (Math.abs(currentVideoTime - expectedTime) > 2) {
          player.seekTo(expectedTime, true);
        }
        player.playVideo();
      } else if (state.status === 'idle') {
        player.seekTo(0, true);
        player.pauseVideo();
      } else if (state.status === 'finished') {
        player.pauseVideo();
      }
    } catch (e) {
      console.warn('YouTube Player API not ready yet', e);
    }
  };

  const onReady = (event) => {
    playerRef.current = event.target;
    syncPlayer();
  };

  // Sync on major state changes
  useEffect(() => {
    syncPlayer();
  }, [state.status, state.speed, videoId]);

  // Periodic check to prevent drifting (e.g. if video buffers)
  useEffect(() => {
    const interval = setInterval(() => {
      if (state.status === 'running' && playerRef.current) {
         const expectedTime = latestTimeRef.current / 1000;
         const player = playerRef.current;
         try {
           const currentVideoTime = player.getCurrentTime() || 0;
           // If we drift by more than 2 seconds, force a sync
           if (Math.abs(currentVideoTime - expectedTime) > 2) {
             player.seekTo(expectedTime, true);
             player.playVideo();
           }
         } catch(e) {}
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [state.status]);

  const opts = {
    height: '100%',
    width: '100%',
    playerVars: {
      autoplay: 0,
      controls: 0, // hide controls to enforce sync
      disablekb: 1, // disable keyboard controls
      rel: 0,
      modestbranding: 1
    },
  };

  if (!videoId) {
    return (
      <div className="video-player-placeholder glass-panel">
        <p>Waiting for Host to set a YouTube video...</p>
      </div>
    );
  }

  return (
    <div className="video-player-container">
      <YouTube 
        videoId={videoId} 
        opts={opts} 
        onReady={onReady} 
        className="youtube-iframe"
      />
    </div>
  );
};

export default VideoPlayer;
