const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const path = require('path');

// CRITICAL: Add these command line switches BEFORE app is ready
app.commandLine.appendSwitch('disable-features', 'VizDisplayCompositor');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-software-rasterizer');

// Check if running in development mode
let isDev;
try {
  isDev = require('electron-is-dev');
} catch (e) {
  isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
}

let mainWindow;
let loginWindow;

// Store STT API key
let STT_API_KEY = null;
let sttState = {
  ws: null,            // AssemblyAI websocket
  audioSource: null,   // platform-specific audio capture instance/stream
  isStreaming: false,
  isReady: false,      // websocket open and ready to accept audio
  audioHandlerSet: false  // Track if audio handler is already set
};

function createWindow() {
  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 800,
    height: 210,
    frame: false,            // Frameless to hide title bar & menu
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: true,
    resizable: false,
    show: false,
    hasShadow: false,
    opacity: 0.99,
    autoHideMenuBar: true,   // works only if frame: true, but harmless here
    title: '',
    fullscreenable: false,
    maximizable: false,
    minimizable: false,
    closable: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false
    }
  });

  // Handle runtime resize toggles from renderer
  ipcMain.on('set-resizable', (event, payload) => {
    try {
      const { resizable, minHeight } = payload || {};
      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.setResizable(!!resizable);
      const [curW] = mainWindow.getSize();
      if (resizable) {
        // Allow resize with a minimum height (default 300)
        const minH = Number(minHeight) || 300;
        mainWindow.setMinimumSize(curW, minH);
      } else {
        // Lock back to compact height
        mainWindow.setMinimumSize(curW, 210);
        // Optionally snap back to compact height if larger
        const [w, h] = mainWindow.getSize();
        if (h > 210) mainWindow.setSize(w, 210);
      }
    } catch (e) {
      // no-op
    }
  });

  // Smooth height resize animation
  ipcMain.on('animate-resize', (event, payload) => {
    try {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      const { targetHeight = 600, durationMs = 220 } = payload || {};
      const [startW, startH] = mainWindow.getSize();
      const steps = 20;
      const interval = Math.max(8, Math.floor(durationMs / steps));
      const deltaH = (targetHeight - startH) / steps;

      let i = 0;
      const timer = setInterval(() => {
        if (!mainWindow || mainWindow.isDestroyed()) {
          clearInterval(timer);
          return;
        }
        i += 1;
        const nextH = Math.round(startH + deltaH * i);
        mainWindow.setSize(startW, nextH, true);
        if (i >= steps) {
          clearInterval(timer);
          mainWindow.setSize(startW, targetHeight, true);
        }
      }, interval);
    } catch (e) {
      // no-op
    }
  });

  // Ensure no menu bar exists
  mainWindow.setMenu(null);
  mainWindow.setMenuBarVisibility(false);

  // Load URL
  const startUrl = isDev
    ? 'http://localhost:3001'
    : `file://${path.join(__dirname, '../build/index.html')}`;
  mainWindow.loadURL(startUrl);

  mainWindow.once('ready-to-show', () => {
    // Position window at top center
    const { screen } = require('electron');
    const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize;
    const windowWidth = 800;
    const x = Math.round((screenWidth - windowWidth) / 2);
    const y = 20; // 20px from top
    mainWindow.setPosition(x, y);

    // macOS-specific behavior
    if (process.platform === 'darwin') {
      app.dock.hide();
      app.setActivationPolicy('accessory');
      mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      mainWindow.setAlwaysOnTop(true, 'screen-saver');
    }

    // Windows/Linux-specific behavior
    mainWindow.setSkipTaskbar(true);
    mainWindow.setAlwaysOnTop(true, 'floating');

    // Content protection
    mainWindow.setContentProtection(true);

    mainWindow.show();
  });

  // Ensure menu bar stays hidden
  const hideMenuInterval = setInterval(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setMenu(null);
      mainWindow.setMenuBarVisibility(false);
    } else {
      clearInterval(hideMenuInterval);
    }
  }, 100);

  // Override show to reapply protections
  const originalShow = mainWindow.show;
  mainWindow.show = function () {
    originalShow.call(this);
    setTimeout(() => {
      if (this && !this.isDestroyed()) {
        this.setContentProtection(true);
        this.setSkipTaskbar(true);
        this.setMenu(null);
        this.setMenuBarVisibility(false);
      }
    }, 100);
  };

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Handle IPC messages
ipcMain.on('close-window', () => {
  if (mainWindow) mainWindow.close();
  app.quit();
});

ipcMain.on('move-window', (event, data) => {
  if (mainWindow) {
    const { deltaX, deltaY } = data;
    const [currentX, currentY] = mainWindow.getPosition();
    mainWindow.setPosition(currentX + deltaX, currentY + deltaY);
  }
});

// === STT: Start Audio Capture / Start Transcription / Stop Transcription / Stop Audio Capture ===
ipcMain.on('stt-start-audio', async () => {
  // Start system audio capture when entering analysis/answer screen
  if (sttState.audioSource) return; // Already capturing

  try {
    const { platform } = process;
    if (platform === 'darwin') {
      // macOS: capture system audio using audiotee (ES module)
      try {
        const { AudioTee } = await import('audiotee');
        sttState.audioSource = new AudioTee({
          sampleRate: 16000,
          chunkDurationMs: 50
        });
        
        sttState.audioSource.on('error', (e) => {
          if (mainWindow) mainWindow.webContents.send('stt-error', String(e && e.message || e));
        });
        
        sttState.audioSource.on('start', () => {
          console.log('AudioTee: Audio capture started');
        });
        
        sttState.audioSource.on('stop', () => {
          console.log('AudioTee: Audio capture stopped');
        });

        sttState.audioSource.on('log', (level, message) => {
          // Log different levels with appropriate formatting
          if (level === 'debug') {
            console.debug(`AudioTee [DEBUG]: ${message.message}`)
          } else if (level === 'info') {
            console.info(`AudioTee [INFO]: ${message.message}`)
          }
        })
        
        // Start audio capture
        await sttState.audioSource.start();
      } catch (error) {
        if (mainWindow) mainWindow.webContents.send('stt-error', `Failed to load audiotee: ${error.message}`);
        return;
      }
    } else if (platform === 'win32') {
      // Windows: capture loopback via ffmpeg WASAPI to stdout
      const { spawn } = require('child_process');
      const ffmpegArgs = ['-f','wasapi','-i','default','-ar','16000','-ac','1','-f','s16le','-'];
      const ff = spawn('ffmpeg', ffmpegArgs, { stdio: ['ignore','pipe','pipe'] });
      
      // Create a wrapper to match AudioTee data format
      const audioWrapper = {
        on: (event, handler) => {
          if (event === 'data') {
            ff.stdout.on('data', (chunk) => {
              // Wrap raw PCM data to match AudioTee format
              handler({ data: chunk });
            });
          } else if (event === 'error') {
            ff.on('error', handler);
          } else if (event === 'start') {
            handler(); // FFmpeg starts immediately
          } else if (event === 'stop') {
            ff.on('close', handler);
          }
        },
        stop: async () => {
          ff.kill();
        },
        kill: () => {
          ff.kill();
        }
      };
      
      sttState.audioSource = audioWrapper;
      ff.stderr.on('data', (d) => {});
      ff.on('error', (e) => { if (mainWindow) mainWindow.webContents.send('stt-error', String(e && e.message || e)); });
      ff.on('close', () => {});
    } else {
      if (mainWindow) mainWindow.webContents.send('stt-error', 'STT not supported on this platform yet');
      return;
    }
    console.log('🎤 System audio capture started');
  } catch (e) {
    console.error('Failed to start audio capture:', e);
    if (mainWindow) mainWindow.webContents.send('stt-error', 'Failed to start audio capture');
  }
});

ipcMain.on('stt-start-transcription', async () => {
  if (!STT_API_KEY) {
    if (mainWindow) mainWindow.webContents.send('stt-error', 'STT API key missing');
    return;
  }
  if (sttState.isStreaming) return;
  if (!sttState.audioSource) {
    if (mainWindow) mainWindow.webContents.send('stt-error', 'Audio capture not started');
    return;
  }

  try {
    // Connect to AssemblyAI using their SDK (ES module)
    const { AssemblyAI } = await import('assemblyai');
    
    const client = new AssemblyAI({
      apiKey: STT_API_KEY,
    });

    // Reset session flags before creating a new transcriber
    sttState.isReady = false;
    sttState.ws = null;

    const transcriber = client.streaming.transcriber({
      sampleRate: 16000,
      formatTurns: true,
      encoding: 'pcm_s16le',
    });

    transcriber.on('open', ({ id }) => {
      sttState.isStreaming = true;
      sttState.isReady = true;
      sttState.ws = transcriber; // Store reference for cleanup
      console.log(`🎙️ AssemblyAI session opened with ID: ${id}`);
      console.log('🎙️ Transcription is now active - listening for audio...');
      if (mainWindow) mainWindow.webContents.send('stt-status', { running: true });
    });

    transcriber.on('turn', (turn) => {
      if (!turn.transcript || turn.transcript.trim() === '') {
        return;
      }
      
      // Log transcript details
      console.log('📝 Transcript received:');
      console.log(`   Text: "${turn.transcript}"`);
      console.log(`   End of turn: ${turn.end_of_turn}`);
      console.log(`   Formatted: ${turn.turn_is_formatted}`);
      
      // Send transcript to renderer
      if (mainWindow) {
        mainWindow.webContents.send('stt-transcript', turn.transcript);
        console.log('📤 Transcript sent to renderer');
      }
    });

    transcriber.on('error', (error) => {
      console.error('❌ AssemblyAI Error:', error);
      console.error('❌ Error details:', JSON.stringify(error, null, 2));
      sttState.isReady = false;
      sttState.isStreaming = false;
      if (mainWindow) mainWindow.webContents.send('stt-error', String(error.message || error));
    });

    transcriber.on('close', (code, reason) => {
      console.log(`🔴 AssemblyAI session closed: ${code} - ${reason}`);
      console.log('🔴 Transcription stopped');
      sttState.isStreaming = false;
      sttState.isReady = false;
      sttState.ws = null;
      if (mainWindow) mainWindow.webContents.send('stt-status', { running: false });
    });

    // Connect the transcriber
    await transcriber.connect();

    // Set up audio data handler (only once)
    if (sttState.audioSource && typeof sttState.audioSource.on === 'function' && !sttState.audioHandlerSet) {
      sttState.audioSource.on('data', (chunk) => {
        const currentWs = sttState.ws;
        if (!currentWs) return;
        if (!sttState.isStreaming || !sttState.isReady) return;
        try {
          console.log(`🎵 Sending audio chunk: ${chunk.data.length} bytes`);
          currentWs.sendAudio(chunk.data);
        } catch (err) {
          // Socket likely not open; stop streaming to avoid crash loop
          console.warn('⚠️ sendAudio failed, halting streaming:', err && err.message ? err.message : err);
          sttState.isReady = false;
          sttState.isStreaming = false;
          try { currentWs.close && currentWs.close(); } catch (_) {}
          if (mainWindow) mainWindow.webContents.send('stt-error', 'Streaming connection not open; transcription stopped.');
        }
      });
      sttState.audioHandlerSet = true;
      console.log('🔗 Audio data handler connected to transcriber');
    }
    console.log('🎙️ Transcription setup completed');
  } catch (e) {
    console.error('❌ Failed to start transcription:', e);
    console.error('❌ Error stack:', e.stack);
    if (mainWindow) mainWindow.webContents.send('stt-error', 'Failed to start transcription');
  }
});

ipcMain.on('stt-stop-transcription', async () => {
  try {
    sttState.isStreaming = false;
    sttState.isReady = false;
    if (sttState.ws) {
      try { 
        await sttState.ws.close();
      } catch (_) {}
      sttState.ws = null;
    }
    if (mainWindow) mainWindow.webContents.send('stt-status', { running: false });
    console.log('🎙️ Transcription stopped');
  } catch (_) {}
});

ipcMain.on('stt-stop-audio', async () => {
  try {
    // Stop transcription first
    sttState.isStreaming = false;
    sttState.isReady = false;
    if (sttState.ws) {
      try { 
        await sttState.ws.close();
      } catch (_) {}
      sttState.ws = null;
    }
    
    // Stop audio capture
    if (sttState.audioSource) {
      try { 
        if (typeof sttState.audioSource.stop === 'function') {
          await sttState.audioSource.stop();
        } else if (typeof sttState.audioSource.kill === 'function') {
          sttState.audioSource.kill();
        }
      } catch (_) {}
      sttState.audioSource = null;
      sttState.audioHandlerSet = false; // Reset handler flag
    }
    if (mainWindow) mainWindow.webContents.send('stt-status', { running: false });
    console.log('🎤 Audio capture stopped');
  } catch (_) {}
});

// Handle STT config storage
ipcMain.on('store-stt-config', (event, sttConfig) => {
  try {
    if (sttConfig && sttConfig.sttEngine && sttConfig.sttEngine.apiKey) {
      STT_API_KEY = sttConfig.sttEngine.apiKey;
      console.log('🔑 STT API Key stored successfully');
      console.log('📝 STT Engine:', sttConfig.sttEngine.name);
      console.log('🔍 API Key length:', STT_API_KEY.length);
    } else {
      console.warn('⚠️ Invalid STT config received:', sttConfig);
    }
  } catch (error) {
    console.error('❌ Error storing STT config:', error);
  }
});

// Handle login window creation
ipcMain.on('open-login', (event, loginUrl) => {
  if (loginWindow) {
    loginWindow.focus();
    return;
  }

  // Ensure we have a valid URL
  const url = loginUrl || 'http://localhost:3000/user/app';
  console.log('Opening login window with URL:', url);

  loginWindow = new BrowserWindow({
    width: 800,
    height: 600,
    frame: true,
    show: false,
    parent: mainWindow,
    modal: false, // Changed to false to allow dragging
    resizable: true,
    movable: true,
    minimizable: true,
    maximizable: true,
    closable: true,
    alwaysOnTop: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
    }
  });

  // Load the login URL
  loginWindow.loadURL(url);

  loginWindow.once('ready-to-show', () => {
    // Center the login window on screen
    const { screen } = require('electron');
    const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
    const windowWidth = 800;
    const windowHeight = 600;
    const x = Math.round((screenWidth - windowWidth) / 2);
    const y = Math.round((screenHeight - windowHeight) / 2);
    
    loginWindow.setPosition(x, y);
    loginWindow.show();
  });

  loginWindow.on('closed', () => {
    loginWindow = null;
  });

  // Poll for token every 500ms
  const tokenCheckInterval = setInterval(() => {
    if (loginWindow && !loginWindow.isDestroyed()) {
      loginWindow.webContents.executeJavaScript('window.authToken')
        .then(token => {
          if (token) {
            console.log('🎉 TOKEN RECEIVED SUCCESSFULLY!');
            console.log('📝 Token:', token);
            console.log('🔍 Token length:', token.length);
            console.log('⏰ Received at:', new Date().toISOString());
            clearInterval(tokenCheckInterval);
            
            // Close login window
            loginWindow.close();
            loginWindow = null;
            
            // Send token to main window
            if (mainWindow) {
              console.log('📤 Sending token to main window...');
              mainWindow.webContents.send('auth-token-received', token);
            }
          }
        })
        .catch(err => {
          // Window might be closed, clear interval
          clearInterval(tokenCheckInterval);
        });
    } else {
      clearInterval(tokenCheckInterval);
    }
  }, 500);

  // Listen for messages from the login window
  loginWindow.webContents.on('did-finish-load', () => {
    // Inject a simple script to listen for token messages
    const script = `
      window.authToken = null;
      console.log('🔧 Token listener script injected successfully');
      window.addEventListener('message', function(event) {
        if (event.data && event.data.type === 'AUTH_TOKEN') {
          window.authToken = event.data.token;
          console.log('🎯 TOKEN CAPTURED IN LOGIN WINDOW!');
          console.log('📝 Token:', event.data.token);
          console.log('🔍 Token length:', event.data.token.length);
        }
      });
    `;
    
    loginWindow.webContents.executeJavaScript(script).catch(err => {
      console.error('Error injecting script:', err);
    });
  });
});



// Webview security
app.on('web-contents-created', (event, contents) => {
  contents.on('will-attach-webview', (event, webPreferences) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
  });
});

// App ready
app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  if (process.platform === 'darwin') {
    app.dock.hide();
    app.setActivationPolicy('accessory');
  }
  createWindow();
});

// Quit app when all windows are closed
app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
