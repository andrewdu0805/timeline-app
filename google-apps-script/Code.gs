/**
 * Timeline App - Google Drive 歷史報價自動抓取橋樑
 *
 * 使用步驟：
 * 1. 前往 https://script.google.com/ 點擊「新專案」
 * 2. 將下方程式碼全部貼上，並把 FOLDER_ID 換成您 Google 雲端硬碟固定資料夾的 ID
 *    （資料夾網址 https://drive.google.com/drive/folders/【這裡這串就是ID】）
 * 3. 點擊右上角「部署」➔「新增部署作業」
 * 4. 類型選「網頁應用程式 (Web App)」
 *    - 執行身分：我 (Me)
 *    - 誰可以存取：所有人 (Anyone)
 * 5. 點擊「部署」並完成授權，複製產生的「網頁應用程式網址 (https://script.google.com/macros/s/.../exec)」
 * 6. 把該網址貼到 Timeline Host 畫面的「☁️ 雲端設定」（或設在 Render 環境變數 GDRIVE_BRIDGE_URL）即可！
 */

const FOLDER_ID = '請將這裡換成您的Google雲端資料夾ID';

function normalizeName(name) {
  return String(name || '')
    .trim()
    .replace(/\.(csv|xlsx|xls)$/i, '')
    .trim()
    .toLowerCase();
}

function doGet(e) {
  try {
    const title = (e && e.parameter && e.parameter.title) ? String(e.parameter.title).trim() : '';
    if (!title) {
      return ContentService
        .createTextOutput(JSON.stringify({ found: false, error: 'Missing title parameter' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const target = normalizeName(title);
    const folder = DriveApp.getFolderById(FOLDER_ID);
    const files = folder.getFiles();

    let matchedFile = null;
    while (files.hasNext()) {
      const file = files.next();
      if (normalizeName(file.getName()) === target) {
        matchedFile = file;
        break;
      }
    }

    if (!matchedFile) {
      return ContentService
        .createTextOutput(JSON.stringify({ found: false, title: title }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    let fileName = matchedFile.getName();
    let bytes;

    // 支援一般 .csv / .xlsx / .xls 檔案，以及 Google 試算表
    if (matchedFile.getMimeType() === MimeType.GOOGLE_SHEETS) {
      const ss = SpreadsheetApp.openById(matchedFile.getId());
      const sheet = ss.getSheets()[0];
      const values = sheet.getDataRange().getDisplayValues();
      const csvLines = values.map(function(row) {
        return row.map(function(cell) {
          const s = String(cell === null || cell === undefined ? '' : cell);
          return (s.indexOf(',') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1)
            ? '"' + s.replace(/"/g, '""') + '"'
            : s;
        }).join(',');
      });
      bytes = Utilities.newBlob(csvLines.join('\n'), 'text/csv', fileName + '.csv').getBytes();
      if (!/\.csv$/i.test(fileName)) fileName = fileName + '.csv';
    } else {
      bytes = matchedFile.getBlob().getBytes();
    }

    const base64 = Utilities.base64Encode(bytes);
    return ContentService
      .createTextOutput(JSON.stringify({
        found: true,
        fileName: fileName,
        base64: base64
      }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ found: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
