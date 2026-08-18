import React, { useRef, useEffect } from 'react';
import YouTube from 'react-youtube';

const VideoPlayer = ({ videoId, state, onDurationReady }) => {
  const playerRef = useRef(null);
  const latestTimeRef = useRef(state.elapsedTimeMs);
  const durationReportedRef = useRef(false);

  useEffect(() => {
    latestTimeRef.current = state.elapsedTimeMs;
    // If paused and host seeks, update the video frame
    if (state.status === 'paused' && playerRef.current) {
        const player = playerRef.current;
        const currentVideoTime = player.getCurrentTime() || 0;
        const expectedTime = state.elapsedTimeMs / 1000;
        if (Math.abs(currentVideoTime - expectedTime) > 1) {
            player.seekTo(expectedTime, true);
        }
    }
  }, [state.elapsedTimeMs]);

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
        
        if (Math.abs(currentVideoTime - expectedTime) > 5) {
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

  // Periodic check to prevent drifting (e.g. if video buffers)
  useEffect(() => {
    const interval = setInterval(() => {
      if (state.status === 'running' && playerRef.current) {
         const expectedTime = latestTimeRef.current / 1000;
         const player = playerRef.current;
         try {
           player.setPlaybackRate(state.speed); // aggressively sync speed
           
           const currentVideoTime = player.getCurrentTime() || 0;
           // If we drift by more than 5 seconds, force a sync
           if (Math.abs(currentVideoTime - expectedTime) > 5) {
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
        onStateChange={onStateChange}
        className="youtube-iframe"
      />
    </div>
  );
};

export default VideoPlayer;
