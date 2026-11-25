import React, { useRef, useEffect } from 'react';
import YouTube from 'react-youtube';

const VideoPlayer = ({ videoId, state, onDurationReady }) => {
  const playerRef = useRef(null);
  const latestTimeRef = useRef(state.elapsedTimeMs);
  const durationReportedRef = useRef(false);
  const isPreviewingRef = useRef(false);
  const previewedVideoIdRef = useRef(null);
  const statusRef = useRef(state.status);

  useEffect(() => {
    statusRef.current = state.status;
  }, [state.status]);

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

  // Reset flags when video changes
  useEffect(() => {
    durationReportedRef.current = false;
    isPreviewingRef.current = false;
  }, [videoId]);

  const syncPlayer = () => {
    if (!playerRef.current || !videoId) return;

    const player = playerRef.current;
    
    try {
      player.setPlaybackRate(state.speed);

      if (state.status === 'running') {
        isPreviewingRef.current = false;
        if (player.unMute) player.unMute();

        const currentVideoTime = player.getCurrentTime() || 0;
        const expectedTime = latestTimeRef.current / 1000;
        
        if (Math.abs(currentVideoTime - expectedTime) > 10) {
          player.seekTo(expectedTime, true);
        }
        player.playVideo();
      } else if (state.status === 'idle') {
        // Decode and pause on the actual first frame (00:00) once per video so Host can read the chart start time
        if (previewedVideoIdRef.current !== videoId) {
          previewedVideoIdRef.current = videoId;
          isPreviewingRef.current = true;
          if (player.mute) player.mute();
          player.seekTo(0, true);
          player.playVideo();
        } else if (!isPreviewingRef.current) {
          player.seekTo(0, true);
          player.pauseVideo();
        }
      } else if (state.status === 'paused') {
        isPreviewingRef.current = false;
        const expectedTime = latestTimeRef.current / 1000;
        player.seekTo(expectedTime, true);
        player.pauseVideo();
      } else if (state.status === 'finished') {
        isPreviewingRef.current = false;
        player.pauseVideo();
      }
    } catch (e) {
      console.warn('YouTube Player API not ready yet', e);
    }
  };

  const onReady = (event) => {
    playerRef.current = event.target;
    try {
      if (event.target.setPlaybackQuality) {
        event.target.setPlaybackQuality('hd1080');
      }
    } catch (e) {}
    syncPlayer();
    checkDuration();
  };

  const checkDuration = () => {
    if (onDurationReady && playerRef.current && !durationReportedRef.current) {
      const d = playerRef.current.getDuration();
      if (d > 0) {
        let title = '';
        try {
          const videoData = playerRef.current.getVideoData();
          if (videoData && videoData.title) {
            title = videoData.title;
          }
        } catch (e) {}
        
        onDurationReady(d, title);
        durationReportedRef.current = true;
      }
    }
  };

  const onStateChange = (event) => {
    checkDuration();

    // As soon as the muted first-frame preview starts playing (state 1), immediately pause at 00:00 & unmute
    if (isPreviewingRef.current && event.data === 1 && statusRef.current === 'idle') {
      isPreviewingRef.current = false;
      try {
        event.target.pauseVideo();
        event.target.seekTo(0, true);
        if (event.target.unMute) event.target.unMute();
      } catch (e) {}
    }
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
      controls: 1, // Enable native controls so user can select 1080p/4K and adjust volume
      rel: 0,
      modestbranding: 1,
      vq: 'hd1080', // Hint YouTube to request 1080p
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
