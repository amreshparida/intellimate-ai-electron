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

// Store tts API key
let tts_API_KEY = null;
let ttsState = {
  ws: null,            // AssemblyAI websocket
  client: null,        // AssemblyAI client (reused)
  audioSource: null,   // platform-specific audio capture instance/stream
  isStreaming: false,
  isReady: false,      // websocket open and ready to accept audio
  audioHandlerSet: false,  // Track if audio handler is already set
  reconnectAttempts: 0,    // Track reconnection attempts
  maxReconnectAttempts: 5, // Maximum reconnection attempts
  reconnectDelay: 1000,    // Delay between reconnection attempts (ms)
  reconnectTimer: null     // Timer for reconnection attempts
};

function createWindow() {
  console.log('Creating Electron window...');

  const windowSize = { width: 800, height: 210, resizableHeight: null };

  // Create the browser window
  mainWindow = new BrowserWindow({
    width: windowSize.width,
    height: windowSize.height,
    frame: false,            // Frameless to hide title bar & menu
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: true,
    resizable: false,
    show: false,
    hasShadow: false,
    autoHideMenuBar: true,   // works only if frame: true, but harmless here
    title: '',
    fullscreenable: false,
    maximizable: false,
    minimizable: false,
    closable: true,
    // Windows-specific transparency settings
    ...(process.platform === 'win32' && {
      backgroundColor: '#222222',
      transparent: false,
    }),
    ...(process.platform === 'darwin' && {
          opacity: 0.99,
    }),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false,
    }
  });



  ipcMain.on('move-window', (event, data) => {
    if (!mainWindow) return;
    const bounds = mainWindow.getBounds();
    mainWindow.setBounds({
      x: bounds.x + data.deltaX,
      y: bounds.y + data.deltaY,
      width: windowSize.width,
      height: windowSize.resizableHeight || windowSize.height
    });
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
        mainWindow.setMinimumSize(curW, windowSize.height);
        // Optionally snap back to compact height if larger
        const [w, h] = mainWindow.getSize();
        if (h > windowSize.height) mainWindow.setSize(w, windowSize.height);
        windowSize.resizableHeight = null;
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
      windowSize.resizableHeight = targetHeight;

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
    console.log('🚀 Electron window ready to show');

    // Position window at top center
    const { screen } = require('electron');
    const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize;
    const windowWidth = 800;
    const x = Math.round((screenWidth - windowWidth) / 2);
    const y = 20; // 20px from top
    console.log(`📍 Positioning window at x:${x}, y:${y}`);
    mainWindow.setPosition(x, y);

    // macOS-specific behavior
    if (process.platform === 'darwin') {
      app.dock.hide();
      app.setActivationPolicy('accessory');
      mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      mainWindow.setAlwaysOnTop(true, 'screen-saver');
    }


    mainWindow.setSkipTaskbar(true);
    mainWindow.setAlwaysOnTop(true, 'floating');


    // Content protection
    mainWindow.setContentProtection(true);

    // Windows-specific workaround
    if (process.platform === 'win32') {
      console.log('🪟 Windows-specific window setup...');
      // Make Windows behave like macOS - minimal interface
      setTimeout(() => {
        mainWindow.setOpacity(0.95); // Slight transparency
        mainWindow.focus();
        // Additional macOS-like behavior for Windows
        mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        console.log('🪟 Windows window should be visible now');
      }, 100);
    }

    console.log('👁️ Showing window...');
    mainWindow.show();
    console.log('✅ Window should now be visible');
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






// === tts: Start Audio Capture / Start Transcription / Stop Transcription / Stop Audio Capture ===
ipcMain.on('tts-start-audio', async () => {
  // Start system audio capture when entering analysis/answer screen
  if (ttsState.audioSource) return; // Already capturing

  try {
    const { platform } = process;
    if (platform === 'darwin') {
      // macOS: capture system audio using audiotee (ES module)
      try {
        const { AudioTee } = await import('audiotee');
        ttsState.audioSource = new AudioTee({
          sampleRate: 16000,
          chunkDurationMs: 50
        });

        ttsState.audioSource.on('error', (e) => {
          if (mainWindow) mainWindow.webContents.send('tts-error', String(e && e.message || e));
        });

        ttsState.audioSource.on('start', () => {
          console.log('AudioTee: Audio capture started');
        });

        ttsState.audioSource.on('stop', () => {
          console.log('AudioTee: Audio capture stopped');
        });

        ttsState.audioSource.on('log', (level, message) => {
          // Log different levels with appropriate formatting
          if (level === 'debug') {
            console.debug(`AudioTee [DEBUG]: ${message.message}`)
          } else if (level === 'info') {
            console.info(`AudioTee [INFO]: ${message.message}`)
          }
        })

        // Start audio capture
        await ttsState.audioSource.start();
      } catch (error) {
        console.warn('AudioTee failed, falling back to FFmpeg:', error.message);
        // Fallback to FFmpeg on macOS if audiotee fails
        try {
          const { spawn } = require('child_process');
          const ffmpegStatic = require('ffmpeg-static');
          const ffmpegArgs = ['-f', 'avfoundation', '-i', ':0', '-ar', '16000', '-ac', '1', '-f', 's16le', '-'];
          const ff = spawn(ffmpegStatic, ffmpegArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

          // Create a wrapper to match AudioTee data format
          const audioWrapper = {
            on: (event, handler) => {
              if (event === 'data') {
                ff.stdout.on('data', (chunk) => {
                  handler({ data: chunk });
                });
              } else if (event === 'error') {
                ff.on('error', handler);
              } else if (event === 'start') {
                handler();
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

          ttsState.audioSource = audioWrapper;
          ff.stderr.on('data', (d) => { });
          ff.on('error', (e) => { if (mainWindow) mainWindow.webContents.send('tts-error', String(e && e.message || e)); });
          ff.on('close', () => { });
        } catch (ffmpegError) {
          if (mainWindow) mainWindow.webContents.send('tts-error', `Failed to load audio capture: ${error.message}`);
          return;
        }
      }
    } else {
    
      try {
        const naudiodon = await import('naudiodon');
        const portAudio = naudiodon.default || naudiodon;
      
        // Get devices
        const devices = portAudio.getDevices();
        const targetDevice = devices.find(d =>
          /stereo mix|loopback|output|realtek/i.test(d.name)
        );
        const deviceId = targetDevice ? targetDevice.id : -1;
      
        console.log(`🎧 Using device: ${targetDevice ? targetDevice.name : 'Default Input'}`);
      
        // Create AudioIO for input
        const ai = new portAudio.AudioIO({
          inOptions: {
            channelCount: 1,
            sampleFormat: portAudio.SampleFormat16Bit,
            sampleRate: 16000,
            deviceId,
            closeOnError: false
          }
        });
      
        const audioWrapper = {
          on: (event, handler) => {
            if (event === 'data') ai.on('data', chunk => handler({ data: chunk }));
            else if (event === 'error') ai.on('error', handler);
            else if (event === 'start') process.nextTick(handler);
            else if (event === 'stop') ai.on('close', handler);
          },
          stop: () => ai.quit(),
          kill: () => ai.quit(),
        };
      
        ai.start();
        ttsState.audioSource = audioWrapper;
        console.log('🎤 System audio capture started on Windows');
      } catch (error) {
        console.error('Failed to start audio capture:', error);
        if (mainWindow) mainWindow.webContents.send('tts-error', 'Failed to start audio capture');
      }
      


    } 
    console.log('🎤 System audio capture started');
  } catch (e) {
    console.error('Failed to start audio capture:', e);
    if (mainWindow) mainWindow.webContents.send('tts-error', 'Failed to start audio capture');
  }
});


ipcMain.on('tts-stop-audio', async () => {
  try {
    // Stop transcription first
    ttsState.isStreaming = false;
    ttsState.isReady = false;
    ttsState.reconnectAttempts = 0; // Reset reconnection attempts
    if (ttsState.reconnectTimer) {
      clearTimeout(ttsState.reconnectTimer);
      ttsState.reconnectTimer = null;
    }
    if (ttsState.ws) {
      try {
        await ttsState.ws.close();
      } catch (_) { }
      ttsState.ws = null;
    }

    // Stop audio capture
    if (ttsState.audioSource) {
      try {
        if (typeof ttsState.audioSource.stop === 'function') {
          await ttsState.audioSource.stop();
        } else if (typeof ttsState.audioSource.kill === 'function') {
          ttsState.audioSource.kill();
        }
      } catch (_) { }
      ttsState.audioSource = null;
      ttsState.audioHandlerSet = false; // Reset handler flag
    }

    // Clear client only when stopping audio completely
    ttsState.client = null;
    if (mainWindow) mainWindow.webContents.send('tts-status', { running: false });
    console.log('🎤 Audio capture stopped (client cleared)');
  } catch (_) { }
});


ipcMain.on('tts-start-transcription', async () => {
  if (!tts_API_KEY) {
    if (mainWindow) mainWindow.webContents.send('tts-error', 'tts API key missing');
    return;
  }
  if (ttsState.isStreaming) return;
  if (!ttsState.audioSource) {
    if (mainWindow) mainWindow.webContents.send('tts-error', 'Audio capture not started');
    return;
  }

  try {
    // Create client only if it doesn't exist
    if (!ttsState.client) {
      const { AssemblyAI } = await import('assemblyai');
      ttsState.client = new AssemblyAI({
        apiKey: tts_API_KEY,
      });
      console.log('🔧 Created new AssemblyAI client');
    }

    // Reset session flags before creating a new transcriber
    ttsState.isReady = false;
    ttsState.ws = null;

    const transcriber = ttsState.client.streaming.transcriber({
      sampleRate: 16000,
      formatTurns: true,
      encoding: 'pcm_s16le',
    });

    transcriber.on('open', ({ id }) => {
      ttsState.isStreaming = true;
      ttsState.isReady = true;
      ttsState.ws = transcriber; // Store reference for cleanup
      ttsState.reconnectAttempts = 0; // Reset reconnection attempts on successful connection
      if (ttsState.reconnectTimer) {
        clearTimeout(ttsState.reconnectTimer);
        ttsState.reconnectTimer = null;
      }
      console.log(`🎙️ AssemblyAI session opened with ID: ${id}`);
      console.log('🎙️ Transcription is now active - listening for audio...');
      if (mainWindow) mainWindow.webContents.send('tts-status', { running: true });
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
        mainWindow.webContents.send('tts-transcript', turn.transcript);
        console.log('📤 Transcript sent to renderer');
      }
    });

    transcriber.on('error', (error) => {
      console.error('❌ AssemblyAI Error:', error);
      console.error('❌ Error details:', JSON.stringify(error, null, 2));
      ttsState.isReady = false;
      ttsState.isStreaming = false;
      if (mainWindow) mainWindow.webContents.send('tts-error', String(error.message || error));
    });

    transcriber.on('close', (code, reason) => {
      console.log(`🔴 AssemblyAI session closed: ${code} - ${reason}`);
      console.log('🔴 Transcription stopped');
      ttsState.isStreaming = false;
      ttsState.isReady = false;
      ttsState.ws = null;

      // Attempt reconnection if we were actively streaming
      if (ttsState.isStreaming && ttsState.reconnectAttempts < ttsState.maxReconnectAttempts) {
        console.log(`🔄 Attempting reconnection (${ttsState.reconnectAttempts + 1}/${ttsState.maxReconnectAttempts})...`);
        ttsState.reconnectAttempts++;
        ttsState.reconnectTimer = setTimeout(() => {
          attemptReconnection();
        }, ttsState.reconnectDelay);
      } else {
        if (mainWindow) mainWindow.webContents.send('tts-status', { running: false });
      }
    });

    // Connect the transcriber
    await transcriber.connect();

    // Set up audio data handler (only once)
    if (ttsState.audioSource && typeof ttsState.audioSource.on === 'function' && !ttsState.audioHandlerSet) {
      ttsState.audioSource.on('data', (chunk) => {
        const currentWs = ttsState.ws;
        if (!currentWs) return;
        if (!ttsState.isStreaming || !ttsState.isReady) return;
        try {
          console.log(`🎵 Sending audio chunk: ${chunk.data.length} bytes`);
          currentWs.sendAudio(chunk.data);
        } catch (err) {
          // Socket likely not open; stop streaming to avoid crash loop
          console.warn('⚠️ sendAudio failed, halting streaming:', err && err.message ? err.message : err);
          ttsState.isReady = false;
          ttsState.isStreaming = false;
          try { currentWs.close && currentWs.close(); } catch (_) { }
          if (mainWindow) mainWindow.webContents.send('tts-error', 'Streaming connection not open; transcription stopped.');
        }
      });
      ttsState.audioHandlerSet = true;
      console.log('🔗 Audio data handler connected to transcriber');
    }
    console.log('🎙️ Transcription setup completed');
  } catch (e) {
    console.error('❌ Failed to start transcription:', e);
    console.error('❌ Error stack:', e.stack);
    if (mainWindow) mainWindow.webContents.send('tts-error', 'Failed to start transcription');
  }
});

ipcMain.on('tts-stop-transcription', async () => {
  try {
    ttsState.isStreaming = false;
    ttsState.isReady = false;
    ttsState.reconnectAttempts = 0; // Reset reconnection attempts
    if (ttsState.reconnectTimer) {
      clearTimeout(ttsState.reconnectTimer);
      ttsState.reconnectTimer = null;
    }
    if (ttsState.ws) {
      try {
        await ttsState.ws.close();
      } catch (_) { }
      ttsState.ws = null;
    }
    // Keep client alive for reuse - don't set to null
    if (mainWindow) mainWindow.webContents.send('tts-status', { running: false });
    console.log('🎙️ Transcription stopped (client kept alive for reuse)');
  } catch (_) { }
});


// Handle tts config storage
ipcMain.on('store-tts-config', (event, ttsConfig) => {
  try {
    if (ttsConfig && ttsConfig.ttsEngine && ttsConfig.ttsEngine.apiKey) {
      tts_API_KEY = ttsConfig.ttsEngine.apiKey;
      console.log('🔑 tts API Key stored successfully');
      console.log('📝 tts Engine:', ttsConfig.ttsEngine.name);
      console.log('🔍 API Key length:', tts_API_KEY.length);
    } else {
      console.warn('⚠️ Invalid tts config received:', ttsConfig);
    }
  } catch (error) {
    console.error('❌ Error storing tts config:', error);
  }
});

// Reconnection function
async function attemptReconnection() {
  if (!tts_API_KEY || !ttsState.audioSource) {
    console.log('❌ Cannot reconnect: Missing API key or audio source');
    if (mainWindow) mainWindow.webContents.send('tts-status', { running: false });
    return;
  }

  try {
    console.log('🔄 Attempting to reconnect to AssemblyAI...');

    // Create new client only if current one is null
    if (!ttsState.client) {
      const { AssemblyAI } = await import('assemblyai');
      ttsState.client = new AssemblyAI({
        apiKey: tts_API_KEY,
      });
      console.log('🔧 Created new AssemblyAI client for reconnection');
    }

    const transcriber = ttsState.client.streaming.transcriber({
      sampleRate: 16000,
      formatTurns: true,
      encoding: 'pcm_s16le',
    });

    transcriber.on('open', ({ id }) => {
      ttsState.isStreaming = true;
      ttsState.isReady = true;
      ttsState.ws = transcriber;
      ttsState.reconnectAttempts = 0;
      if (ttsState.reconnectTimer) {
        clearTimeout(ttsState.reconnectTimer);
        ttsState.reconnectTimer = null;
      }
      console.log(`🔄 Reconnected to AssemblyAI with ID: ${id}`);
      if (mainWindow) mainWindow.webContents.send('tts-status', { running: true });
    });

    transcriber.on('error', (error) => {
      console.error('❌ Reconnection failed:', error);
      ttsState.isReady = false;
      ttsState.isStreaming = false;
      if (mainWindow) mainWindow.webContents.send('tts-error', `Reconnection failed: ${error.message || error}`);
    });

    transcriber.on('close', (code, reason) => {
      console.log(`🔴 Reconnected session closed: ${code} - ${reason}`);
      ttsState.isStreaming = false;
      ttsState.isReady = false;
      ttsState.ws = null;

      // Try reconnection again if we haven't exceeded max attempts
      if (ttsState.reconnectAttempts < ttsState.maxReconnectAttempts) {
        console.log(`🔄 Attempting reconnection (${ttsState.reconnectAttempts + 1}/${ttsState.maxReconnectAttempts})...`);
        ttsState.reconnectAttempts++;
        ttsState.reconnectTimer = setTimeout(() => {
          attemptReconnection();
        }, ttsState.reconnectDelay);
      } else {
        console.log('❌ Max reconnection attempts reached');
        if (mainWindow) mainWindow.webContents.send('tts-status', { running: false });
      }
    });

    await transcriber.connect();
  } catch (error) {
    console.error('❌ Reconnection error:', error);
    ttsState.isStreaming = false;
    ttsState.isReady = false;
    if (mainWindow) mainWindow.webContents.send('tts-error', `Reconnection failed: ${error.message || error}`);
  }
}

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
