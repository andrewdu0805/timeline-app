import React, { useRef, useEffect } from 'react';
import YouTube from 'react-youtube';

const VideoPlayer = ({ videoId, state, onDurationReady }) => {
  const playerRef = useRef(null);
  const latestTimeRef = useRef(state.elapsedTimeMs);
  const durationReportedRef = useRef(false);

  useEffect(() => {
    const diff = Math.abs(state.elapsedTimeMs - latestTimeRef.current);
    latestTimeRef.current = state.elapsedTimeMs;
    
    if (playerRef.current) {
        // If there is a massive jump (e.g. host clicked +/- 10s), force seek immediately
        if (diff > 3000) {
            playerRef.current.seekTo(state.elapsedTimeMs / 1000, true);
        }
        // If paused and drifting (e.g. someone sought while paused), update frame
        else if (state.status === 'paused') {
            const currentVideoTime = playerRef.current.getCurrentTime() || 0;
            const expectedTime = state.elapsedTimeMs / 1000;
            if (Math.abs(currentVideoTime - expectedTime) > 1) {
                playerRef.current.seekTo(expectedTime, true);
            }
        }
    }
  }, [state.elapsedTimeMs, state.status]);

  // Reset duration reported flag when video changes
  useEffect(() => {
    durationReportedRef.current = false;
  }, [videoId]);

  const syncPlayer = () => {
    if (!playerRef.current || !videoId) return;

    const player = playerRef.current;
    
    try {
      player.setPlaybackRate(state.speed);

      if (state.status === 'running') {
        const currentVideoTime = player.getCurrentTime() || 0;
        const expectedTime = latestTimeRef.current / 1000;
        
        if (Math.abs(currentVideoTime - expectedTime) > 10) {
          player.seekTo(expectedTime, true);
        }
        player.playVideo();
      } else if (state.status === 'idle') {
        player.seekTo(0, true);
        player.pauseVideo();
      } else if (state.status === 'paused') {
        const expectedTime = latestTimeRef.current / 1000;
        player.seekTo(expectedTime, true);
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
    checkDuration();
  };

  const checkDuration = () => {
    if (onDurationReady && playerRef.current && !durationReportedRef.current) {
      const d = playerRef.current.getDuration();
      if (d > 0) {
        onDurationReady(d);
        durationReportedRef.current = true;
      }
    }
  };

  const onStateChange = (event) => {
    checkDuration();
  };

  // Sync on major state changes
  useEffect(() => {
    syncPlayer();
  }, [state.status, state.speed, videoId]);

  // Periodic check to prevent drifting (e.g. if video lags)
  useEffect(() => {
    const interval = setInterval(() => {
      if (state.status === 'running' && playerRef.current) {
         const expectedTime = latestTimeRef.current / 1000;
         const player = playerRef.current;
         try {
           player.setPlaybackRate(state.speed); // aggressively sync speed
           
           // If the player is currently buffering (3), DO NOT interrupt it to seek, 
           // as that will just restart the buffering and create a loop!
           const pState = player.getPlayerState();
           if (pState === 3) return;

           const currentVideoTime = player.getCurrentTime() || 0;
           // 10 second drift tolerance for network lags
           if (Math.abs(currentVideoTime - expectedTime) > 10) {
             player.seekTo(expectedTime, true);
             player.playVideo();
           } else if (pState !== 1) {
             // If it somehow paused or stopped but shouldn't have
             player.playVideo();
           }
         } catch(e) {}
      }
    }, 5000); // Check every 5 seconds
    return () => clearInterval(interval);
  }, [state.status, state.speed]);

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
        onStateChange={onStateChange}
        className="youtube-iframe"
      />
    </div>
  );
};

export default VideoPlayer;
