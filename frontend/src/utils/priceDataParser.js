import * as XLSX from 'xlsx';

/**
 * Format seconds since midnight (can be >= 86400 for post-midnight night session) as HH:MM:SS
 */
export const formatMarketTime = (totalSec) => {
  if (totalSec == null || isNaN(totalSec)) return '';
  const normalized = ((Math.floor(totalSec) % 86400) + 86400) % 86400;
  const h = Math.floor(normalized / 3600);
  const m = Math.floor((normalized % 3600) / 60);
  const s = normalized % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

/**
 * Parse "HH:MM" or "HH:MM:SS" string into seconds since midnight (0..86399)
 */
export const parseTimeStringToSec = (str) => {
  if (!str) return null;
  const m = String(str).trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const sec = m[3] ? parseInt(m[3], 10) : 0;
  if (h > 23 || min > 59 || sec > 59) return null;
  return h * 3600 + min * 60 + sec;
};

/**
 * Parse "MM:SS" or "HH:MM:SS" video timestamp into milliseconds
 */
export const parseVideoTimeToMs = (str) => {
  if (!str) return 0;
  const parts = String(str).trim().split(':').map(p => parseInt(p, 10));
  if (parts.some(isNaN)) return 0;
  if (parts.length === 2) return (parts[0] * 60 + parts[1]) * 1000;
  if (parts.length === 3) return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
  return 0;
};

/**
 * Convert a TradingView / XQ raw time cell into seconds-of-day (Taiwan UTC+8)
 */
const parseTimeCellToTaiwanSec = (rawVal) => {
  if (rawVal === null || rawVal === undefined || rawVal === '') return null;

  // 1. Excel fractional day number (0 <= n < 1) e.g. 0.3645833 -> 08:45:00
  if (typeof rawVal === 'number') {
    if (rawVal >= 0 && rawVal < 1) {
      return Math.round(rawVal * 86400) % 86400;
    }
    // 2. UNIX timestamp in seconds (TradingView default export: ~1.7e9)
    if (rawVal > 1e9 && rawVal < 1e11) {
      const d = new Date((rawVal + 8 * 3600) * 1000);
      return d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds();
    }
    // 3. UNIX timestamp in milliseconds (~1.7e12)
    if (rawVal >= 1e11) {
      const d = new Date(rawVal + 8 * 3600 * 1000);
      return d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds();
    }
    // 4. Excel serial date+time (> 20000, fractional part is time of day)
    if (rawVal > 20000) {
      const frac = rawVal - Math.floor(rawVal);
      return Math.round(frac * 86400) % 86400;
    }
    return null;
  }

  const s = String(rawVal).trim();
  if (!s) return null;

  // Numeric string (UNIX timestamp)
  if (/^\d{10,13}$/.test(s)) {
    return parseTimeCellToTaiwanSec(Number(s));
  }

  // ISO 8601 string with timezone (e.g. TradingView "2026-11-20T00:45:00Z" or "2026-11-20T08:45:00+08:00")
  if (s.includes('T') && (s.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(s))) {
    const ms = Date.parse(s);
    if (!isNaN(ms)) {
      const d = new Date(ms + 8 * 3600 * 1000);
      return d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds();
    }
  }

  // Pure HH:MM or HH:MM:SS (e.g. XQ column B "08:45:00")
  const pureTime = parseTimeStringToSec(s);
  if (pureTime !== null) return pureTime;

  // Date + time string without TZ (e.g. "2026/11/20 08:45:00" or "2026-11-20 08:45")
  const dtMatch = s.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (dtMatch) {
    const h = parseInt(dtMatch[1], 10);
    const min = parseInt(dtMatch[2], 10);
    const sec = dtMatch[3] ? parseInt(dtMatch[3], 10) : 0;
    if (h <= 23 && min <= 59 && sec <= 59) {
      return h * 3600 + min * 60 + sec;
    }
  }

  return null;
};

/**
 * Parse an uploaded XQ (.xlsx / .xls / .csv) or TradingView (.csv) file
 * into a compact, midnight-safe array of [timeSec, closePrice].
 */
export const parseHistoricalFile = async (file) => {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const fileName = String(file.name || '').toLowerCase();

  // Detect binary Excel (.xlsx starts with PK 0x50 0x4B; legacy .xls starts with 0xD0 0xCF)
  const isBinaryExcel =
    (bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4B) ||
    (bytes.length >= 2 && bytes[0] === 0xD0 && bytes[1] === 0xCF) ||
    fileName.endsWith('.xlsx') ||
    fileName.endsWith('.xls');

  let workbook;
  if (isBinaryExcel) {
    workbook = XLSX.read(bytes, { type: 'array', raw: true });
  } else {
    // Text/CSV: decode UTF-8 first, fallback to Big5 for Traditional Chinese XQ CSV exports
    let text = new TextDecoder('utf-8').decode(bytes);
    const hasExpectedHeader = (t) => /(時間|收盤|time|close)/i.test(t);
    if (text.includes('\uFFFD') || !hasExpectedHeader(text)) {
      try {
        const big5Text = new TextDecoder('big5').decode(bytes);
        if (hasExpectedHeader(big5Text)) {
          text = big5Text;
        }
      } catch (e) {
        // Ignore if runtime lacks big5 decoder
      }
    }
    workbook = XLSX.read(text, { type: 'string', raw: true });
  }
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new Error('檔案中找不到工作表');
  }
  const sheet = workbook.Sheets[firstSheetName];
  const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });

  if (!rawRows || rawRows.length < 2) {
    throw new Error('檔案內容為空或資料列數不足');
  }

  // Locate header row (usually row 0, scan first 5 rows in case of title lines)
  let headerRowIdx = -1;
  let timeColIdx = -1;
  let closeColIdx = -1;
  let sourceLabel = '自訂';

  for (let r = 0; r < Math.min(5, rawRows.length); r++) {
    const row = rawRows[r].map(cell => String(cell || '').trim());
    const lower = row.map(c => c.toLowerCase());

    const tIdx = row.findIndex((c, idx) =>
      c === '時間' || lower[idx] === 'time' || lower[idx] === 'datetime' || c === '日期時間'
    );
    const cIdx = row.findIndex((c, idx) =>
      c === '收盤價' || c === '收盤' || lower[idx] === 'close'
    );

    if (tIdx !== -1 && cIdx !== -1) {
      headerRowIdx = r;
      timeColIdx = tIdx;
      closeColIdx = cIdx;
      if (row[cIdx] === '收盤價' || row[cIdx] === '收盤' || row[tIdx] === '時間') {
        sourceLabel = 'XQ';
      } else if (lower[tIdx] === 'time' && lower[cIdx] === 'close') {
        sourceLabel = 'TradingView';
      }
      break;
    }
  }

  if (headerRowIdx === -1) {
    throw new Error('找不到「時間 / time」或「收盤價 / close」欄位，請確認檔案格式');
  }

  // Parse data rows
  const parsed = [];
  for (let r = headerRowIdx + 1; r < rawRows.length; r++) {
    const row = rawRows[r];
    if (!row || row.length === 0) continue;

    const timeSec = parseTimeCellToTaiwanSec(row[timeColIdx]);
    const rawClose = row[closeColIdx];
    const closePrice = typeof rawClose === 'number'
      ? rawClose
      : parseFloat(String(rawClose || '').replace(/,/g, '').trim());

    if (timeSec !== null && !isNaN(closePrice)) {
      parsed.push([timeSec, closePrice]);
    }
  }

  if (parsed.length === 0) {
    throw new Error('無法解析出有效的時間與收盤價資料');
  }

  // Detect reverse chronological order (some exports list newest first)
  // Check if first row > last row by a small/normal session amount (not midnight wrap)
  let dropCount = 0;
  let riseCount = 0;
  for (let i = 1; i < Math.min(parsed.length, 30); i++) {
    const diff = parsed[i][0] - parsed[i - 1][0];
    if (diff > 0 && diff < 43200) riseCount++;
    else if (diff < 0 && diff > -43200) dropCount++;
  }
  if (dropCount > riseCount) {
    parsed.reverse();
  }

  // Handle cross-midnight night session (e.g. 23:59:00 -> 00:00:00 adds +86400)
  let dayOffset = 0;
  const rows = [];
  let prevSec = -1;
  for (const [sec, close] of parsed) {
    let adjusted = sec + dayOffset;
    if (prevSec !== -1 && adjusted < prevSec - 3600) {
      dayOffset += 86400;
      adjusted = sec + dayOffset;
    }
    // Deduplicate identical timestamps (keep latest close)
    if (rows.length > 0 && rows[rows.length - 1][0] === adjusted) {
      rows[rows.length - 1][1] = close;
    } else {
      rows.push([adjusted, close]);
    }
    prevSec = adjusted;
  }

  // Estimate bar interval (median diff among first 50 rows)
  const diffs = [];
  for (let i = 1; i < Math.min(rows.length, 50); i++) {
    const d = rows[i][0] - rows[i - 1][0];
    if (d > 0) diffs.push(d);
  }
  diffs.sort((a, b) => a - b);
  const intervalSec = diffs.length > 0 ? diffs[Math.floor(diffs.length / 2)] : 60;

  return {
    rows,
    count: rows.length,
    sourceLabel,
    intervalSec,
    firstTimeSec: rows[0][0],
    lastTimeSec: rows[rows.length - 1][0],
    firstTimeStr: formatMarketTime(rows[0][0]),
    lastTimeStr: formatMarketTime(rows[rows.length - 1][0])
  };
};

/**
 * Compute FIFO realized P&L ledger for a single user's click history.
 * Each click may have { name, val, exactMs, isClose, marketTime, price }.
 */
export const computeUserFifoLedger = (history) => {
  const queue = []; // { dir: 1 | -1, price: number }
  let totalPnl = 0;
  let closedTrades = 0;
  let winTrades = 0;
  let currentPos = 0;

  const ledger = history.map((click, idx) => {
    const qty = Math.abs(click.val);
    const dir = click.val > 0 ? 1 : -1;
    const price = typeof click.price === 'number' && !isNaN(click.price) ? click.price : null;
    const prevPos = currentPos;
    currentPos += click.val;

    let tradePnl = null;
    let closedQty = 0;

    if (price !== null) {
      let stepPnl = 0;
      for (let i = 0; i < qty; i++) {
        if (queue.length > 0 && queue[0].dir !== dir) {
          const openLot = queue.shift();
          const unitPnl = (price - openLot.price) * openLot.dir;
          stepPnl += unitPnl;
          closedQty++;
        } else {
          queue.push({ dir, price });
        }
      }
      if (closedQty > 0) {
        tradePnl = Math.round(stepPnl * 100) / 100;
        totalPnl = Math.round((totalPnl + tradePnl) * 100) / 100;
        closedTrades++;
        if (tradePnl > 0) winTrades++;
      }
    }

    let note = '';
    if (click.isClose || (prevPos !== 0 && currentPos === 0)) {
      note = '平倉出場';
    } else if (prevPos === 0) {
      note = dir > 0 ? '做多進場' : '做空進場';
    } else if (Math.sign(prevPos) === dir) {
      note = dir > 0 ? '多單加碼' : '空單加碼';
    } else if (Math.sign(prevPos) !== Math.sign(currentPos) && currentPos !== 0) {
      note = '平倉並反手';
    } else {
      note = '部分減倉';
    }

    return {
      index: idx + 1,
      action: click.isClose ? '平倉' : (dir > 0 ? '做多' : '做空'),
      val: click.val,
      exactMs: click.exactMs,
      marketTime: click.marketTime || '',
      price,
      tradePnl,
      cumPnl: price !== null ? totalPnl : null,
      posAfter: currentPos,
      note
    };
  });

  const winRate = closedTrades > 0 ? Math.round((winTrades / closedTrades) * 100) : null;

  return {
    ledger,
    totalPnl,
    closedTrades,
    winTrades,
    winRate
  };
};
