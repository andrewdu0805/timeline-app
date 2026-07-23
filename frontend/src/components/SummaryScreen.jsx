import React, { useMemo } from 'react';

const SummaryScreen = ({ state, onReset, role }) => {
  // Aggregate clicks by user
  const summary = useMemo(() => {
    const userStats = {};
    
    state.clicks.forEach(click => {
      if (!userStats[click.name]) {
        userStats[click.name] = { plus: 0, minus: 0, sum: 0, history: [] };
      }
      
      const stats = userStats[click.name];
      if (click.val === 1) stats.plus += 1;
      if (click.val === -1) stats.minus += 1;
      stats.sum += click.val;
      
      stats.history.push(click);
    });
    
    return Object.entries(userStats).map(([name, stats]) => ({
      name,
      ...stats
    })).sort((a, b) => b.sum - a.sum); // Sort by sum descending
  }, [state.clicks]);

  const formatTime = (ms) => {
    const totalSeconds = Math.floor(ms / 1000);
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="screen-container summary-screen">
      <div className="glass-panel summary-panel">
        <h1 className="title gradient-text">Timeline Completed</h1>
        
        {summary.length === 0 ? (
          <p className="no-data">No clicks recorded during this session.</p>
        ) : (
          <div className="table-responsive">
            <table className="summary-table">
              <thead>
                <tr>
                  <th>Guest Name</th>
                  <th>Top Clicks (+1)</th>
                  <th>Bottom Clicks (-1)</th>
                  <th>Sum</th>
                  <th>Balanced (0)?</th>
                  <th>History (Time)</th>
                </tr>
              </thead>
              <tbody>
                {summary.map((user, idx) => (
                  <tr key={idx}>
                    <td className="user-name">{user.name}</td>
                    <td className="stat-plus">{user.plus}</td>
                    <td className="stat-minus">{user.minus}</td>
                    <td className="stat-sum">
                      <span className={user.sum > 0 ? 'plus' : user.sum < 0 ? 'minus' : 'zero'}>
                        {user.sum > 0 ? '+' : ''}{user.sum}
                      </span>
                    </td>
                    <td>
                      {user.sum === 0 ? (
                        <span className="badge success">Yes</span>
                      ) : (
                        <span className="badge danger">No</span>
                      )}
                    </td>
                    <td className="history-cell">
                      <div className="history-list">
                        {user.history.map((h, i) => (
                          <span key={i} className={`history-item ${h.val === 1 ? 'plus' : 'minus'}`}>
                            {h.val === 1 ? 'Top' : 'Btm'} @ {formatTime(h.exactMs)}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="summary-actions">
          {role === 'host' ? (
            <button className="btn btn-primary" onClick={onReset}>
              Reset Timeline for New Session
            </button>
          ) : (
            <p className="waiting-text">Waiting for Host to reset...</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default SummaryScreen;
