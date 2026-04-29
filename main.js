const { app, BrowserWindow, safeStorage } = require('electron');
const path = require('path');
const startServer = require('./server/server');
const sn = require('./server/servicenow');
const db = require('./server/db/database');

let mainWindow;
let serverInstance;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'Help Desk Simulator',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'app', 'index.html'));

  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('Renderer gone:', details.reason, details.exitCode);
  });
}

app.whenReady().then(() => {
  const userData = app.getPath('userData');
  sn.setUserDataDir(userData);
  db.setUserDataDir(userData);
  // Provide OS-backed encryption for credentials at rest (Windows DPAPI / mac Keychain).
  if (safeStorage && safeStorage.isEncryptionAvailable()) {
    sn.setCrypto({
      encrypt: (s) => safeStorage.encryptString(String(s)).toString('base64'),
      decrypt: (b64) => safeStorage.decryptString(Buffer.from(String(b64), 'base64'))
    });
  }
  serverInstance = startServer(3017);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (serverInstance && serverInstance.close) serverInstance.close();
  if (process.platform !== 'darwin') app.quit();
});
