import React, { useMemo } from 'react';

const SummaryScreen = ({ state, onReset, role }) => {
  // Aggregate clicks by user, ensuring all active guests are included
  const summary = useMemo(() => {
    const userStats = {};
    
    // First, initialize stats for all currently connected guests
    if (state.guests) {
      state.guests.forEach(guest => {
        userStats[guest.name] = { plus: 0, minus: 0, sum: 0, history: [] };
      });
    }
    
    // Then, add data from clicks (this also includes past guests who disconnected but clicked)
    state.clicks.forEach(click => {
      if (!userStats[click.name]) {
        userStats[click.name] = { plus: 0, minus: 0, sum: 0, history: [] };
      }
      
      const stats = userStats[click.name];
      if (click.val > 0) stats.plus += click.val;
      if (click.val < 0) stats.minus += Math.abs(click.val);
      stats.sum += click.val;
      
      stats.history.push(click);
    });
    
    return Object.entries(userStats).map(([name, stats]) => ({
      name,
      ...stats
    })).sort((a, b) => b.sum - a.sum); // Sort by sum descending
  }, [state.clicks, state.guests]);

  const formatTime = (ms) => {
    const totalSeconds = Math.floor(ms / 1000);
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const handleDownloadCSV = () => {
    // Find the maximum number of history events any user has to generate dynamic columns
    const maxHistory = Math.max(0, ...summary.map(u => u.history.length));
    
    // Generate CSV Header
    let headerStr = "Guest Name,Top Clicks (+1),Bottom Clicks (-1),Sum,Balanced";
    for (let i = 1; i <= maxHistory; i++) {
      headerStr += `,Event ${i}`;
    }
    
    // Add BOM (\uFEFF) for Excel UTF-8 support to fix Chinese encoding
    let csvContent = "\uFEFF" + headerStr + "\n";
    
    // Add Rows
    summary.forEach(user => {
      const balanced = user.sum === 0 ? "Yes" : "No";
      
      // Escape name just in case it contains commas
      let row = `"${user.name.replace(/"/g, '""')}",${user.plus},${user.minus},${user.sum},${balanced}`;
      
      // Add each history event to its own column
      for (let i = 0; i < maxHistory; i++) {
        if (i < user.history.length) {
          const h = user.history[i];
          row += `,"${h.val > 0 ? '+1' : h.val} @ ${formatTime(h.exactMs)}"`;
        } else {
          row += `,""`;
        }
      }
      
      csvContent += row + "\n";
    });

    // Create Blob and trigger download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `timeline_summary_${new Date().getTime()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="screen-container summary-screen">
      <div className="glass-panel summary-panel">
        <h1 className="title gradient-text">Timeline Completed</h1>
        
        {summary.length === 0 ? (
          <p className="no-data">No users or clicks recorded during this session.</p>
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
                          <span key={i} className={`history-item ${h.val > 0 ? 'plus' : 'minus'}`}>
                            {h.val > 0 ? 'Top' : 'Btm'} @ {formatTime(h.exactMs)}
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

        <div className="summary-actions" style={{ gap: '1rem' }}>
          {role === 'host' ? (
            <>
              <button className="btn btn-secondary" onClick={handleDownloadCSV} disabled={summary.length === 0}>
                Download CSV
              </button>
              <button className="btn btn-primary" onClick={onReset}>
                Reset Timeline for New Session
              </button>
            </>
          ) : (
            <>
              <button className="btn btn-secondary" onClick={handleDownloadCSV} disabled={summary.length === 0}>
                Download CSV
              </button>
              <p className="waiting-text" style={{ alignSelf: 'center', margin: 0 }}>Waiting for Host to reset...</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default SummaryScreen;
