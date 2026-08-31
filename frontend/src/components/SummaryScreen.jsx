import React, { useMemo } from 'react';
import * as XLSX from 'xlsx';

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

  const handleDownloadExcel = () => {
    const wb = XLSX.utils.book_new();

    summary.forEach(user => {
      const topClicks = user.history.filter(h => h.val > 0);
      const bottomClicks = user.history.filter(h => h.val < 0);
      const maxRows = Math.max(topClicks.length, bottomClicks.length, 1);
      
      const sheetData = [];
      // Row 0: Headers
      sheetData.push(["名字", "多單總數 (+1)", "空單總數 (-1)", "平衡 (淨值)", "是否空手", "多單紀錄", "空單紀錄"]);
      
      // Rows 1 to maxRows
      for (let i = 0; i < maxRows; i++) {
        const topStr = i < topClicks.length ? `+${topClicks[i].val} @ ${formatTime(topClicks[i].exactMs)}` : "";
        const btmStr = i < bottomClicks.length ? `${bottomClicks[i].val} @ ${formatTime(bottomClicks[i].exactMs)}` : "";
        
        if (i === 0) {
          // First row contains the summary stats
          const isBalanced = user.sum === 0 ? "是" : "否";
          sheetData.push([user.name, user.plus, user.minus, user.sum, isBalanced, topStr, btmStr]);
        } else {
          // Subsequent rows only contain history
          sheetData.push(["", "", "", "", "", topStr, btmStr]);
        }
      }
      
      const ws = XLSX.utils.aoa_to_sheet(sheetData);
      
      // Auto-size columns roughly
      ws['!cols'] = [
        { wch: 15 }, // Name
        { wch: 15 }, // Plus
        { wch: 15 }, // Minus
        { wch: 12 }, // Sum
        { wch: 10 }, // Balanced
        { wch: 18 }, // Top History
        { wch: 18 }  // Bottom History
      ];
      
      // Sanitize sheet name (Excel limits to 31 chars and no []\/?*:)
      let sheetName = user.name.replace(/[\[\]\\/?*:|]/g, '').substring(0, 31);
      if (!sheetName) sheetName = "User";
      
      // Ensure unique sheet names if duplicates exist (rare but possible)
      let finalSheetName = sheetName;
      let counter = 1;
      while (wb.SheetNames.includes(finalSheetName)) {
        finalSheetName = `${sheetName.substring(0, 28)}_${counter}`;
        counter++;
      }
      
      XLSX.utils.book_append_sheet(wb, ws, finalSheetName);
    });

    let filename = `timeline_summary_${new Date().getTime()}.xlsx`;
    if (state.videoTitle) {
      const safeTitle = state.videoTitle.replace(/[\/\\?%*:|"<>]/g, '-');
      filename = `${safeTitle}.xlsx`;
    }

    XLSX.writeFile(wb, filename);
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
              <button className="btn btn-secondary" onClick={handleDownloadExcel} disabled={summary.length === 0}>
                下載 Excel (.xlsx)
              </button>
              <button className="btn btn-primary" onClick={onReset}>
                Reset Timeline for New Session
              </button>
            </>
          ) : (
            <>
              <button className="btn btn-secondary" onClick={handleDownloadExcel} disabled={summary.length === 0}>
                下載 Excel (.xlsx)
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
