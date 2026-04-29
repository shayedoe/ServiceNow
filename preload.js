const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('api', {
  baseUrl: 'http://localhost:3017'
});
