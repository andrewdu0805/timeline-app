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
    const videoUrl = state.videoId ? `https://youtu.be/${state.videoId}` : "";

    summary.forEach(user => {
      const topClicks = user.history.filter(h => h.val > 0);
      const bottomClicks = user.history.filter(h => h.val < 0);
      const maxRows = Math.max(topClicks.length, bottomClicks.length, 1);
      
      const sheetData = [];
      // Rows 0-2: Video metadata & separator
      sheetData.push(["影片連結", videoUrl || "未設定"]);
      sheetData.push(["影片名稱", state.videoTitle || "未設定"]);
      sheetData.push([]); // Blank row separator

      // Row 3: Headers
      sheetData.push(["名字", "多單總數 (+1)", "空單總數 (-1)", "平衡 (淨值)", "是否空手", "多單紀錄", "空單紀錄"]);
      
      // Rows 4 to maxRows + 3
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
      
      // Make the video URL cell in B1 a true clickable hyperlink
      if (videoUrl && ws['B1']) {
        ws['B1'].l = { Target: videoUrl, Tooltip: "點擊開啟 YouTube 影片" };
      }
      
      // Auto-size columns roughly
      ws['!cols'] = [
        { wch: 15 }, // Name / Label
        { wch: 35 }, // Plus / Video URL
        { wch: 15 }, // Minus
        { wch: 12 }, // Sum
        { wch: 12 }, // Balanced
        { wch: 20 }, // Top History
        { wch: 20 }  // Bottom History
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
        <h1 className="title gradient-text">時間線已結束</h1>
        
        {state.videoId && (
          <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
            <a 
              href={`https://youtu.be/${state.videoId}`} 
              target="_blank" 
              rel="noopener noreferrer" 
              className="guest-video-link"
              style={{ fontSize: '0.85rem', padding: '0.3rem 0.8rem' }}
              title={state.videoTitle ? `${state.videoTitle}\nhttps://youtu.be/${state.videoId}` : `https://youtu.be/${state.videoId}`}
            >
              <span>📺</span>
              <span>影片連結: youtu.be/{state.videoId}</span>
              <span style={{ fontSize: '0.75rem', opacity: 0.8 }}>↗</span>
            </a>
          </div>
        )}
        
        {summary.length === 0 ? (
          <p className="no-data">本次活動沒有任何點擊紀錄。</p>
        ) : (
          <div className="table-responsive">
            <table className="summary-table">
              <thead>
                <tr>
                  <th>名字</th>
                  <th>做多 (+1)</th>
                  <th>做空 (-1)</th>
                  <th>淨值</th>
                  <th>是否空手?</th>
                  <th>歷史紀錄 (時間)</th>
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
                        <span className="badge success">是</span>
                      ) : (
                        <span className="badge danger">否</span>
                      )}
                    </td>
                    <td className="history-cell">
                      <div className="history-list">
                        {user.history.map((h, i) => (
                          <span key={i} className={`history-item ${h.val > 0 ? 'plus' : 'minus'}`}>
                            {h.val > 0 ? '做多' : '做空'} @ {formatTime(h.exactMs)}
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
                重置時間線（開始新場次）
              </button>
            </>
          ) : (
            <>
              <button className="btn btn-secondary" onClick={handleDownloadExcel} disabled={summary.length === 0}>
                下載 Excel (.xlsx)
              </button>
              <p className="waiting-text" style={{ alignSelf: 'center', margin: 0 }}>等待主機 (Host) 重置...</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default SummaryScreen;
