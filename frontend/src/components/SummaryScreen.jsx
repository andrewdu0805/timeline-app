import React, { useMemo, useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { computeUserFifoLedger } from '../utils/priceDataParser';

const SummaryScreen = ({ state, onReset, role, onLogout }) => {
  const hasPriceData = Boolean(state.priceDataInfo) || state.clicks.some(c => typeof c.price === 'number');
  const [isMerging, setIsMerging] = useState(hasPriceData);

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
    const sortedClicks = [...(state.clicks || [])].sort((a, b) => a.exactMs - b.exactMs);
    sortedClicks.forEach(click => {
      if (!userStats[click.name]) {
        userStats[click.name] = { plus: 0, minus: 0, sum: 0, history: [] };
      }
      
      const stats = userStats[click.name];
      if (click.val > 0) stats.plus += click.val;
      if (click.val < 0) stats.minus += Math.abs(click.val);
      stats.sum += click.val;
      
      stats.history.push(click);
    });
    
    return Object.entries(userStats).map(([name, stats]) => {
      const fifo = computeUserFifoLedger(stats.history);
      return {
        name,
        ...stats,
        ...fifo
      };
    }).sort((a, b) => (hasPriceData ? b.totalPnl - a.totalPnl : b.sum - a.sum));
  }, [state.clicks, state.guests, hasPriceData]);

  // Pre-build Excel workbook automatically when merging historical data, then reveal the Download button
  useEffect(() => {
    if (!hasPriceData) {
      setIsMerging(false);
      return;
    }
    setIsMerging(true);
    const timer = setTimeout(() => {
      setIsMerging(false);
    }, 450);
    return () => clearTimeout(timer);
  }, [hasPriceData, state.clicks]);

  const formatTime = (ms) => {
    const totalSeconds = Math.floor(ms / 1000);
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const handleDownloadExcel = () => {
    const wb = XLSX.utils.book_new();
    const videoUrl = state.videoId ? `https://youtu.be/${state.videoId}` : "";
    const pInfo = state.priceDataInfo;

    summary.forEach(user => {
      const sheetData = [];

      if (hasPriceData) {
        // Enhanced P&L sheet with historical closing prices & FIFO ledger
        sheetData.push(["影片連結", videoUrl || "未設定"]);
        sheetData.push(["影片名稱", state.videoTitle || "未設定"]);
        if (pInfo) {
          const intervalLabel = pInfo.intervalSec < 60 ? `${pInfo.intervalSec}秒K` : `${Math.round(pInfo.intervalSec / 60)}分K`;
          sheetData.push([
            "歷史報價資料",
            `${pInfo.sourceLabel} ${intervalLabel} (共 ${pInfo.count} 筆 · ${pInfo.firstTimeStr} ~ ${pInfo.lastTimeStr})`
          ]);
          sheetData.push([
            "時間對齊基準",
            `影片 ${formatTime(pInfo.anchorVideoMs || 0)} = 盤面 ${pInfo.anchorMarketTime || pInfo.firstTimeStr}`
          ]);
        }
        sheetData.push([]);

        // Summary KPI Table
        sheetData.push(["名字", "多單總口數", "空單總口數", "淨部位", "是否空手", "已實現總損益 (點)", "平倉勝率"]);
        sheetData.push([
          user.name,
          user.plus,
          user.minus,
          user.sum,
          user.sum === 0 ? "是" : "否",
          user.totalPnl,
          user.winRate !== null ? `${user.winRate}% (${user.winTrades}/${user.closedTrades})` : "-"
        ]);
        sheetData.push([]);

        // Detailed FIFO Trade Ledger
        sheetData.push(["#", "動作", "口數", "影片時間", "盤面時間", "收盤價", "單筆損益 (點)", "累計損益 (點)", "交易後部位", "備註"]);
        if (user.ledger.length === 0) {
          sheetData.push(["-", "無點擊紀錄", "", "", "", "", "", "", "", ""]);
        } else {
          user.ledger.forEach(row => {
            sheetData.push([
              row.index,
              row.action,
              row.val,
              formatTime(row.exactMs),
              row.marketTime || "-",
              row.price !== null ? row.price : "-",
              row.tradePnl !== null ? row.tradePnl : "-",
              row.cumPnl !== null ? row.cumPnl : "-",
              row.posAfter,
              row.note
            ]);
          });
        }
      } else {
        // Original format when no historical price CSV was uploaded
        const topClicks = user.history.filter(h => h.val > 0);
        const bottomClicks = user.history.filter(h => h.val < 0);
        const maxRows = Math.max(topClicks.length, bottomClicks.length, 1);

        sheetData.push(["影片連結", videoUrl || "未設定"]);
        sheetData.push(["影片名稱", state.videoTitle || "未設定"]);
        sheetData.push([]);
        sheetData.push(["名字", "多單總數 (+1)", "空單總數 (-1)", "平衡 (淨值)", "是否空手", "多單紀錄", "空單紀錄"]);

        for (let i = 0; i < maxRows; i++) {
          const topStr = i < topClicks.length ? `+${topClicks[i].val}${topClicks[i].isClose ? '(平倉)' : ''} @ ${formatTime(topClicks[i].exactMs)}` : "";
          const btmStr = i < bottomClicks.length ? `${bottomClicks[i].val}${bottomClicks[i].isClose ? '(平倉)' : ''} @ ${formatTime(bottomClicks[i].exactMs)}` : "";

          if (i === 0) {
            const isBalanced = user.sum === 0 ? "是" : "否";
            sheetData.push([user.name, user.plus, user.minus, user.sum, isBalanced, topStr, btmStr]);
          } else {
            sheetData.push(["", "", "", "", "", topStr, btmStr]);
          }
        }
      }

      const ws = XLSX.utils.aoa_to_sheet(sheetData);

      // Make the video URL cell in B1 a true clickable hyperlink
      if (videoUrl && ws['B1']) {
        ws['B1'].l = { Target: videoUrl, Tooltip: "點擊開啟 YouTube 影片" };
      }

      ws['!cols'] = hasPriceData
        ? [
            { wch: 14 }, // # / Label
            { wch: 36 }, // Action / Video URL
            { wch: 12 }, // Qty
            { wch: 12 }, // Video Time
            { wch: 12 }, // Market Time
            { wch: 14 }, // Close Price
            { wch: 16 }, // Trade PnL
            { wch: 16 }, // Cum PnL
            { wch: 12 }, // Pos After
            { wch: 16 }  // Note
          ]
        : [
            { wch: 15 },
            { wch: 35 },
            { wch: 15 },
            { wch: 12 },
            { wch: 12 },
            { wch: 20 },
            { wch: 20 }
          ];

      // Sanitize sheet name (Excel limits to 31 chars and no []\/?*:)
      let sheetName = user.name.replace(/[\[\]\\/?*:|]/g, '').substring(0, 31);
      if (!sheetName) sheetName = "User";

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
      filename = `${safeTitle}${hasPriceData ? '_含損益' : ''}.xlsx`;
    }

    XLSX.writeFile(wb, filename);
  };

  return (
    <div className="screen-container summary-screen">
      <div className="glass-panel summary-panel">
        <h1 className="title gradient-text">時間線已結束</h1>
        
        {state.videoId && (
          <div style={{ textAlign: 'center', marginBottom: '0.8rem' }}>
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

        {state.priceDataInfo && (
          <div style={{
            textAlign: 'center',
            marginBottom: '1rem',
            fontSize: '0.82rem',
            color: '#a7f3d0',
            background: 'rgba(16, 185, 129, 0.12)',
            border: '1px solid rgba(16, 185, 129, 0.35)',
            borderRadius: '8px',
            padding: '0.4rem 0.8rem',
            display: 'inline-block',
            marginLeft: '50%',
            transform: 'translateX(-50%)'
          }}>
            📊 已合併歷史報價：{state.priceDataInfo.sourceLabel}{' '}
            {state.priceDataInfo.intervalSec < 60 ? `${state.priceDataInfo.intervalSec}秒K` : `${Math.round(state.priceDataInfo.intervalSec / 60)}分K`}
            （影片 {formatTime(state.priceDataInfo.anchorVideoMs || 0)} = 盤面 {state.priceDataInfo.anchorMarketTime || state.priceDataInfo.firstTimeStr}）
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
                  {hasPriceData && <th>已實現損益 (點)</th>}
                  {hasPriceData && <th>勝率</th>}
                  <th>歷史紀錄 (時間{hasPriceData ? ' · 收盤價' : ''})</th>
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
                    {hasPriceData && (
                      <td style={{ fontWeight: 'bold' }}>
                        <span style={{ color: user.totalPnl > 0 ? 'var(--color-plus)' : user.totalPnl < 0 ? 'var(--color-minus)' : 'var(--text-primary)' }}>
                          {user.totalPnl > 0 ? `+${user.totalPnl}` : user.totalPnl} 點
                        </span>
                      </td>
                    )}
                    {hasPriceData && (
                      <td>
                        {user.winRate !== null ? `${user.winRate}% (${user.winTrades}/${user.closedTrades})` : '-'}
                      </td>
                    )}
                    <td className="history-cell">
                      <div className="history-list">
                        {user.history.map((h, i) => (
                          <span key={i} className={`history-item ${h.val > 0 ? 'plus' : 'minus'}`}>
                            {h.val > 0
                              ? `做多${Math.abs(h.val) > 1 ? `(+${h.val})` : ''}${h.isClose ? '[平倉]' : ''}`
                              : `做空${Math.abs(h.val) > 1 ? `(${h.val})` : ''}${h.isClose ? '[平倉]' : ''}`
                            } @ {formatTime(h.exactMs)}
                            {hasPriceData && h.price != null ? ` (${h.marketTime} · ${h.price})` : ''}
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

        <div className="summary-actions" style={{ gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
          {isMerging ? (
            <div style={{
              padding: '0.6rem 1.2rem',
              borderRadius: '8px',
              background: 'rgba(59, 130, 246, 0.2)',
              border: '1px solid rgba(59, 130, 246, 0.45)',
              color: '#93c5fd',
              fontWeight: 'bold',
              fontSize: '0.9rem'
            }}>
              ⏳ 正在合併歷史報價並計算損益...
            </div>
          ) : (
            <button className="btn btn-secondary" onClick={handleDownloadExcel} disabled={summary.length === 0}>
              {hasPriceData ? '下載含損益 Excel (.xlsx)' : '下載 Excel (.xlsx)'}
            </button>
          )}

          {role === 'host' ? (
            <>
              <button className="btn btn-primary" onClick={onReset}>
                重置時間線（開始新場次）
              </button>
              {onLogout && (
                <button className="btn btn-secondary" onClick={onLogout} style={{ opacity: 0.8 }}>
                  退出
                </button>
              )}
            </>
          ) : (
            <>
              <p className="waiting-text" style={{ alignSelf: 'center', margin: 0 }}>等待主機 (Host) 重置...</p>
              {onLogout && (
                <button className="btn btn-secondary" onClick={onLogout} style={{ opacity: 0.8 }}>
                  退出
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default SummaryScreen;
