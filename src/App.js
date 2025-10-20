import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { io } from 'socket.io-client';
import 'bootstrap/dist/css/bootstrap.min.css';
import './App.css';
import logo from './assets/images/logo.jpg';
import dragIcon from './assets/images/drag-icon.png';

import './config.js';
import { authUtils } from './utils/auth.js';

// Utility to clean LLM Markdown string
export const formatLLMMarkdown = (llmResponse) => {
  if (!llmResponse) return '';

  // 1. Remove leading/trailing quotes or backticks
  let cleaned = llmResponse.trim();

  // Remove markdown code block wrappers
  cleaned = cleaned.replace(/^```markdown\s*/, '').replace(/\s*```$/, '');
  cleaned = cleaned.replace(/^```\s*/, '').replace(/\s*```$/, '');

  // 2. Replace escaped newlines with actual newlines
  cleaned = cleaned.replace(/\\n/g, '\n');

  // 3. Replace escaped single quotes if needed
  cleaned = cleaned.replace(/\\'/g, "'");

  // 4. Handle JavaScript string concatenation format
  cleaned = cleaned.replace(/\s*\+\s*'?/g, '');
  cleaned = cleaned.replace(/'?\s*\+/g, '');

  // 5. Clean up any remaining escaped characters
  cleaned = cleaned.replace(/\\"/g, '"');
  cleaned = cleaned.replace(/\\\\/g, '\\');

  return cleaned;
};

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [sessionId, setSessionId] = useState('');
  const [sessionStarted, setSessionStarted] = useState(false);
  const [transcript, setTranscript] = useState([]);
  const [showActionPanel, setShowActionPanel] = useState(false);
  const [panelContentType, setPanelContentType] = useState(null); // 'answer' | 'analyze'
  const [availableCredits, setAvailableCredits] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const socketRef = useRef(null);
  const [actionMessages, setActionMessages] = useState([]);
  const [loadingAction, setLoadingAction] = useState(null); // 'answer' | 'analyze' | null
  const [isListening, setIsListening] = useState(false);
  const [sttConfigFetched, setSttConfigFetched] = useState(false);
  const [markdownTextColor, setMarkdownTextColor] = useState('white'); // 'white' or 'black'

  useEffect(() => {
    authUtils.initializeAuth();
    setIsAuthenticated(authUtils.isAuthenticated());
    setIsLoading(false);

    if (window.require) {
      const { ipcRenderer } = window.require('electron');
      const handleTokenReceived = (event, token) => {
        if (authUtils.storeToken(token)) {
          setIsAuthenticated(true);
        }
      };
      const handleSttTranscript = (event, text) => {
        if (!text) return;
        setTranscript(prev => [...prev, String(text)]);
      };
      const handleSttError = (event, message) => {
        setErrorMessage(String(message || 'STT error'));
      };
      ipcRenderer.on('stt-transcript', handleSttTranscript);
      ipcRenderer.on('stt-error', handleSttError);
      ipcRenderer.on('auth-token-received', handleTokenReceived);
      return () => {
        ipcRenderer.removeListener('auth-token-received', handleTokenReceived);
        ipcRenderer.removeListener('stt-transcript', handleSttTranscript);
        ipcRenderer.removeListener('stt-error', handleSttError);
      };
    }
  }, []);

  // Poll /me every minute when authenticated to refresh credits
  useEffect(() => {
    let intervalId;
    const getAuthToken = () => {
      try {
        if (authUtils && typeof authUtils.getToken === 'function') {
          return authUtils.getToken();
        }
      } catch (_) { }
      try { return localStorage.getItem('auth_token'); } catch (_) { return null; }
    };

    const fetchMe = async () => {
      try {
        const token = getAuthToken();
        const resp = await fetch(`${window.APP_CONFIG.BASE_URL}/api/me`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {})
          }
        });
        if (!resp.ok) return;
        const data = await resp.json();
        
        // Check if user is logged out (user: null, role: null)
        if (data && data.user === null && data.role === null) {
          console.log('🔓 User session expired, logging out...');
          handleLogout();
          return;
        }
        
        if (data && data.user) {
          const credits = data.user.credits ?? data.user.balance ?? data.user.credit ?? null;
          setAvailableCredits(credits);
        }
      } catch (_) {
        // ignore transient errors
      }
    };

    if (isAuthenticated) {
      fetchMe();
      intervalId = setInterval(fetchMe, 60 * 3000);
    } else {
      setAvailableCredits(null);
    }

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [isAuthenticated]);

  // Fetch STT config after authentication
  const fetchSttConfig = async () => {
    try {
      const token = authUtils.getToken();
      if (!token) return;

      const response = await fetch(`${window.APP_CONFIG.BASE_URL}/api/user/stt-config`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const sttConfig = await response.json();
        console.log('🔧 STT Config received:', sttConfig);

        // Send to Electron process
        if (window.require) {
          const { ipcRenderer } = window.require('electron');
          ipcRenderer.send('store-stt-config', sttConfig);
        }

        setSttConfigFetched(true);
      } else {
        console.error('Failed to fetch STT config:', response.status);
      }
    } catch (error) {
      console.error('Error fetching STT config:', error);
    }
  };

  // Fetch STT config when authenticated
  useEffect(() => {
    if (isAuthenticated && !sttConfigFetched) {
      fetchSttConfig();
    }
  }, [isAuthenticated, sttConfigFetched]);

  const handleClose = () => {
    if (window.require) {
      const { ipcRenderer } = window.require('electron');
      ipcRenderer.send('close-window');
    }
  };

  const handleLogin = () => {
    if (window.require) {
      const { ipcRenderer } = window.require('electron');
      const loginUrl = `${window.APP_CONFIG.BASE_URL}${window.APP_CONFIG.AUTH_ENDPOINTS.LOGIN}`;
      ipcRenderer.send('open-login', loginUrl);
    }
  };

  const handleDashboard = () => {
    const dashboardUrl = `${window.APP_CONFIG.BASE_URL}${window.APP_CONFIG.AUTH_ENDPOINTS.DASHBOARD}`;
    if (window.require) {
      const { shell } = window.require('electron');
      shell.openExternal(dashboardUrl);
    } else {
      window.open(dashboardUrl, '_blank');
    }
  };

  const handleLogout = async () => {
    try {
      await fetch(`${window.APP_CONFIG.BASE_URL}${window.APP_CONFIG.AUTH_ENDPOINTS.LOGOUT}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      authUtils.clearAuth();
      setIsAuthenticated(false);
    }
    if (window.require) {
      const { ipcRenderer } = window.require('electron');
      ipcRenderer.send('set-resizable', { resizable: false });
      // Stop audio capture when logging out
      ipcRenderer.send('stt-stop-audio');
    }
    try {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    } catch (_) { }
  };

  const handleToggleListening = () => {
    setIsListening(prev => !prev);
    if (window.require) {
      const { ipcRenderer } = window.require('electron');
      if (!isListening) {
        // Clear all previous transcripts when starting to listen
        setTranscript([]);
        ipcRenderer.send('stt-start-transcription');
      } else {
        ipcRenderer.send('stt-stop-transcription');
      }
    }
  };

  const handleSessionIdChange = (e) => setSessionId(e.target.value);
  const handleContinue = () => {
    const cleaned = sessionId.trim();
    if (!cleaned) return;
    setIsConnecting(true);
    setErrorMessage(null);

    let token = null;
    try {
      if (authUtils && typeof authUtils.getToken === 'function') token = authUtils.getToken();
    } catch (_) { }
    if (!token) {
      try { token = localStorage.getItem('auth_token'); } catch (_) { }
    }

    const baseURL = window.APP_CONFIG.BASE_URL || 'http://localhost:3000';
    try {
      const socket = io(baseURL, {
        path: '/api/socket_io',
        transports: ['websocket', 'polling'],
        auth: { token: token || '', sessionId: cleaned }
      });
      socketRef.current = socket;

      socket.on('connect', () => {
        setIsConnecting(false);
        setSessionStarted(true);
        setErrorMessage(null);
        if (window.require) {
          const { ipcRenderer } = window.require('electron');
          ipcRenderer.send('set-resizable', { resizable: false });
          // Start system audio capture when entering analysis/answer screen
          ipcRenderer.send('stt-start-audio');
        }

        // Listen for recharge completion to clear error and update credits
        socket.on('recharge_done', (data) => {
          try {
            // Clear any insufficient credit error
            setErrorMessage(null);
            // Update credits if provided
            const credits = data && (data.credits ?? data.user?.credits ?? null);
            if (credits != null) setAvailableCredits(credits);
            console.log('💳 Recharge done, credits updated:', credits);
          } catch (_) { }
        });
      });
      socket.on('disconnect', (reason) => {
        console.log('socket disconnected:', reason);
        setLoadingAction(null);
      });
      socket.on('connect_error', (err) => {
        const msg = 'Connection Lost';
        setIsConnecting(false);
        setErrorMessage(msg);
        setLoadingAction(null);
        setShowActionPanel(false);
        try { socket.disconnect(); } catch (_) { }
        socketRef.current = null;
      });
      socket.on('insufficient_credits', (data) => {
        setErrorMessage(data.error || 'Insufficient credits');
        setLoadingAction(null);
        setShowActionPanel(false);
        console.warn('insufficient_credits:', data);
      });
      socket.on('answer', (data) => {
        try {
          const ans = (data && (data.answer ?? data)) ?? '';
          const isEmpty = (val) => {
            if (val == null) return true;
            if (typeof val === 'string') return val.trim() === '';
            if (typeof val === 'object') return Object.keys(val).length === 0;
            return false;
          };
          if (isEmpty(ans)) return;
          if (window.require) {
            const { ipcRenderer } = window.require('electron');
            ipcRenderer.send('set-resizable', { resizable: true, minHeight: 300 });
            ipcRenderer.send('animate-resize', { targetHeight: 600, durationMs: 240 });
          }
          setShowActionPanel(true);
          setActionMessages(prev => [ans, ...prev]);
          setLoadingAction(null);
        } catch (_) { }
      });
    } catch (e) {
      setIsConnecting(false);
      setErrorMessage('Connection init failed');
      setLoadingAction(null);
    }
  };

  const handleAnswerQuestion = () => {
    setPanelContentType('answer');
    setShowActionPanel(false); // open only when a valid answer arrives
    setLoadingAction('answer');

    // Stop transcription when clicking Answer Question
    if (window.require && isListening) {
      const { ipcRenderer } = window.require('electron');
      ipcRenderer.send('stt-stop-transcription');
      setIsListening(false);
    }

    // Combine all transcripts into a single prompt
    const transcription = transcript.join(' ').trim();

    if (!transcription) {
      setErrorMessage('No transcript available. Please start listening first.');
      setLoadingAction(null);
      return;
    }

    if (!socketRef.current || !socketRef.current.connected) {
      setErrorMessage('Not connected. Please start session first.');
      setLoadingAction(null);
      return;
    }

    try {
      // Send transcript to backend via Socket.IO
      socketRef.current.emit('question_input', { data: { prompt: transcription } });
      console.log('📤 Sent transcript to backend:', transcription);
    } catch (error) {
      console.error('Error sending transcript:', error);
      setErrorMessage('Failed to send question');
      setLoadingAction(null);
    }

    // Don't expand window yet - wait for AI response
  };
  const handleAnalyzeScreen = () => {
    setPanelContentType('analyze');
    setShowActionPanel(false); // do NOT open until we have a valid message
    setActionMessages([]);
    setLoadingAction('analyze');
    // Stop transcription when clicking Analyze Screen
    if (window.require && isListening) {
      const { ipcRenderer } = window.require('electron');
      ipcRenderer.send('stt-stop-transcription');
      setIsListening(false);
    }
    (async () => {

      try {
        let base64 = '';
        if (window.require) {
          try {
            const screenshot = window.require('screenshot-desktop');
            const { nativeImage } = window.require('electron');
            const buf = await screenshot({ format: 'jpg' });
            if (buf && buf.buffer) {
              // Downscale and compress to mitigate large payload disconnects
              const img = nativeImage.createFromBuffer(Buffer.from(buf));
              const size = img.getSize();
              const maxW = 1280;
              const scale = size.width > maxW ? maxW / size.width : 1;
              const resized = img.resize({ width: Math.round(size.width * scale) });
              const jpeg = resized.toJPEG(80);
              base64 = Buffer.from(jpeg).toString('base64');
            }
          } catch (_) { }
        }

        if (!base64) {
          setErrorMessage('Screen capture not supported in this environment. Please enable Screen Recording for the app.');
          setShowActionPanel(false);
          setLoadingAction(null);
          return;
        }


        if (socketRef.current && socketRef.current.connected) {
          try {
            socketRef.current.emit('question_input', { data: { imageBase64: base64 } });
          } catch (e) {
            console.error(e);
            setErrorMessage('Screen capture failed' + e.message);
            setShowActionPanel(false);
            setLoadingAction(null);
          }
        } else {
          setErrorMessage('Not connected. Please start session first.');
          setShowActionPanel(false);
          setLoadingAction(null);
        }
      } catch (e) {
        console.error(e);
        setErrorMessage('Screen capture failed' + e.message);
        setShowActionPanel(false);
        setLoadingAction(null);
      }


    })();
  };

  const handleCloseActionPanel = () => {
    setShowActionPanel(false);
    if (window.require) {
      const { ipcRenderer } = window.require('electron');
      ipcRenderer.send('set-resizable', { resizable: false });
    }
  };


  const handleOpenSessions = (e) => {
    if (e && e.preventDefault) e.preventDefault();
    const url = `${window.APP_CONFIG.BASE_URL}/user/sessions`;
    if (window.require) {
      const { shell } = window.require('electron');
      shell.openExternal(url);
    } else {
      window.open(url, '_blank');
    }
  };

  const handleDragStart = (e) => {
    if (!e.target.closest('button[title="Drag to move window"]')) return;
    if (window.require) {
      const { ipcRenderer } = window.require('electron');
      const startX = e.clientX;
      const startY = e.clientY;
      const handleMouseMove = (moveEvent) => {
        ipcRenderer.send('move-window', {
          deltaX: moveEvent.clientX - startX,
          deltaY: moveEvent.clientY - startY,
        });
      };
      const handleMouseUp = () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }
  };

  const formattedCredits =
    availableCredits !== null && !isNaN(Number(availableCredits))
      ? Number(availableCredits).toFixed(2)
      : '—';

  if (isLoading) {
    return (
      <div className="vh-100 d-flex flex-column app-container">
        <div className="app-header" onMouseDown={handleDragStart}>
          <div className="d-flex align-items-center">
            <img src={logo} alt="Logo" className="app-logo me-2" draggable={false} />
            <span className="text-white fw-bold me-2">{window.APP_CONFIG.APP_NAME}</span>
            <button className="drag-btn" title="Drag to move window">
              <img src={dragIcon} width={16} height={16} alt="Drag Icon" className="drag-icon" draggable={false} />
            </button>
            {isAuthenticated && sessionStarted && (
              <span className="badge rounded-pill bg-info ms-2 text-dark">
                <b>Sesion ID:</b>
                {' '}
                <a href="#" onClick={handleOpenSessions} className="text-dark text-decoration-underline">
                  <i>{sessionId || '—'}</i>
                </a>
              </span>
            )}
            {isAuthenticated && (
              <span className="badge rounded-pill bg-light ms-2 text-dark">
                <b>Available Credits:</b>
                {' '}
                <i>{formattedCredits}</i>
              </span>
            )}
          </div>
          <button className="btn btn-outline-danger btn-sm" onClick={handleClose}>×</button>
        </div>
        <div className="flex-grow-1 d-flex justify-content-center align-items-center">
          <div className="spinner-border text-light me-2" role="status">
            <span className="visually-hidden">Loading...</span>
          </div>
          <span className="text-light">Loading...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="main-container">
      <div className="d-flex flex-column app-container">
        <div className="app-header" onMouseDown={handleDragStart}>
          <div className="d-flex align-items-center">
            <img src={logo} alt="Logo" className="app-logo me-2" draggable={false} />
            <span className="text-white fw-bold me-2">{window.APP_CONFIG.APP_NAME}</span>
            <button className="drag-btn" title="Drag to move window">
              <img src={dragIcon} width={16} height={16} alt="Drag Icon" className="drag-icon" draggable={false} />
            </button>
            {isAuthenticated && sessionStarted && (
              <span className="badge rounded-pill bg-info ms-2 text-dark">
                <b>Sesion ID:</b>
                {' '}
                <a href="#" onClick={handleOpenSessions} className="text-dark text-decoration-underline">
                  <i>{sessionId || '—'}</i>
                </a>
              </span>
            )}
            {isAuthenticated && (
              <span className="badge rounded-pill bg-light ms-2 text-dark">
                <b>Available Credits:</b>
                {' '}
                <i>{formattedCredits}</i>
              </span>
            )}
          </div>
          <div className="d-flex align-items-center gap-2">
            {isAuthenticated && (
              <>
                <button className="btn btn-outline-primary btn-sm" onClick={handleDashboard}>Dashboard</button>
                <button className="btn btn-outline-warning btn-sm" onClick={handleLogout}>Logout</button>
              </>
            )}
            <button className="btn btn-outline-danger btn-sm" onClick={handleClose}>×</button>
          </div>
        </div>


        <div className="app-content">
          {isAuthenticated ? (
            sessionStarted ? (
              <div className="app-inner-content container mt-1">
                <div className="row">
                  <div className="col-10">
                    <div className="transcript-container mt-3">
                      <div className="transcript-dialogues">
                        {transcript.length === 0 ? (
                          <div className="text-muted text-center" style={{ 
                            padding: '10px', 
                            fontStyle: 'italic',
                            opacity: 0.6
                          }}>
                            Transcript will appear here when you start listening...
                          </div>
                        ) : (
                          transcript.map((line, idx) => (
                            <div key={idx}>{line}</div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="col-2">
                    <div className="clear-section mt-4 pt-1">
                      <button
                        className="btn btn-light btn-sm"
                        onClick={() => setTranscript([])}
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                </div>

                {/* ✅ Buttons directly below transcript row */}
                <div className="text-center mt-3">
                  <div className="d-flex justify-content-center gap-3">
                    <button className="btn btn-light btn-sm" onClick={handleToggleListening} disabled={!!loadingAction}>
                      {isListening ? (
                        <>
                          <span
                            style={{
                              display: 'inline-block',
                              width: 8,
                              height: 8,
                              borderRadius: '50%',
                              background: '#ff4d4f',
                              boxShadow: '0 0 6px 2px rgba(255,77,79,0.7)',
                              marginRight: 6
                            }}
                          />
                          Stop Listening
                        </>
                      ) : 'Start Listening'}
                    </button>
                    <button className="btn btn-success btn-sm" onClick={handleAnswerQuestion} disabled={!!loadingAction}>
                      {loadingAction === 'answer' ? (
                        <>
                          <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                          Answering...
                        </>
                      ) : 'Answer Question'}
                    </button>
                    <button className="btn btn-info btn-sm" onClick={handleAnalyzeScreen} disabled={!!loadingAction}>
                      {loadingAction === 'analyze' ? (
                        <>
                          <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                          Analyzing...
                        </>
                      ) : 'Analyze Screen'}
                    </button>
                  </div>
                </div>

                <div className="text-center mt-1">
                  <div className="d-flex justify-content-center gap-3">
                    {errorMessage ? (
                      <span className="text-danger">{errorMessage}</span>
                    ) : null}
                  </div>
                </div>

              </div>
            ) : (
              <div className="text-center d-flex flex-column justify-content-center align-items-center mt-3">
                <p className="text-light my-1">
                  Create a session in the dashboard, then enter the session ID<br />
                  in the field below to continue.
                </p>
                <div className="d-flex gap-2 justify-content-center my-2">
                  <input
                    type="text"
                    placeholder="Enter Session ID"
                    value={sessionId}
                    onChange={handleSessionIdChange}
                    className="form-control app-input session-input"
                    autoFocus
                  />
                  <button className="btn btn-success btn-sm" onClick={handleContinue} disabled={isConnecting}>
                    Continue
                  </button>
                </div>
                {errorMessage && (
                  <div className="text-center mt-1">
                    <div className="d-flex justify-content-center gap-3">
                      <span className="text-danger">{errorMessage}</span>
                    </div>
                  </div>
                )}
              </div>
            )
          ) : (

            <div className="text-center d-flex flex-column justify-content-center align-items-center mt-3">
              <p className="text-light my-1">
                <b>Login to your account to continue</b>
              </p>
              <div className="d-flex gap-2 justify-content-center my-2">
                <button className="btn btn-primary btn-lg" onClick={handleLogin}>
                  Login
                </button>
              </div>
            </div>
          )}
        </div>

      </div>

      <div className="action-container">
        {showActionPanel && (
          <div className="action-panel">

            <div className="d-flex justify-content-between align-items-center position-relative">
              <span className="action-panel-title">
                {panelContentType === 'answer' ? 'Answers:' : 'Analysis:'}
              </span>

              <div
                className="d-flex align-items-center gap-2 position-absolute"
                style={{ right: '8px', top: '6px' }}
              >
                {/* Toggle button */}
                <button
                  className="btn"
                  onClick={() =>
                    setMarkdownTextColor(prev => (prev === 'white' ? 'black' : 'white'))
                  }
                  title="Toggle text color"
                  style={{
                    background:
                      markdownTextColor === 'white'
                        ? 'rgba(255,255,255,0.2)'
                        : 'rgba(0,0,0,0.2)',
                    border: '1px solid rgba(255,255,255,0.3)',
                    borderRadius: '4px',
                    color: markdownTextColor === 'white' ? '#000' : '#fff', // text color conditional
                    padding: '0 12px',
                    fontSize: '14px',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    height: '28px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {markdownTextColor === 'white' ? 'Text Light' : 'Text Dark'}
                </button>

                {/* Close button */}
                <button
                  className="btn btn-danger"
                  onClick={handleCloseActionPanel}
                  style={{
                    lineHeight: 1,
                    fontSize: '18px',
                    padding: '0 6px',
                    height: '28px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  ×
                </button>
              </div>
            </div>




            <div className="action-panel-content">
              <div className="action-items-row">

                {actionMessages.length === 0 ? (
                  <span className="text-light">No messages yet.</span>
                ) : (
                  <div className="d-flex flex-column align-items-start w-100">
                    {actionMessages.map((m, idx) => (
                       <div key={idx} className="text-start w-100" style={{
                         background: markdownTextColor === 'white' 
                           ? 'rgba(255,255,255,0.08)' 
                           : 'rgba(0,0,0,0.08)',
                         border: markdownTextColor === 'white' 
                           ? '1px solid rgba(255,255,255,0.15)' 
                           : '1px solid rgba(0,0,0,0.15)',
                         borderRadius: 8,
                         padding: '8px 10px',
                         marginBottom: 6,
                         color: markdownTextColor
                       }}>
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            h1: ({ children }) => <h1 style={{ color: markdownTextColor, fontSize: '1.5rem', marginBottom: '0.5rem' }}>{children}</h1>,
                            h2: ({ children }) => <h2 style={{ color: markdownTextColor, fontSize: '1.3rem', marginBottom: '0.4rem' }}>{children}</h2>,
                            h3: ({ children }) => <h3 style={{ color: markdownTextColor, fontSize: '1.1rem', marginBottom: '0.3rem' }}>{children}</h3>,
                            p: ({ children }) => <p style={{ color: markdownTextColor, marginBottom: '0.5rem' }}>{children}</p>,
                            ul: ({ children }) => <ul style={{ color: markdownTextColor, marginLeft: '1rem' }}>{children}</ul>,
                            ol: ({ children }) => <ol style={{ color: markdownTextColor, marginLeft: '1rem' }}>{children}</ol>,
                            li: ({ children }) => <li style={{ color: markdownTextColor, marginBottom: '0.2rem' }}>{children}</li>,
                            strong: ({ children }) => <strong style={{ color: markdownTextColor, fontWeight: 'bold' }}>{children}</strong>,
                            em: ({ children }) => <em style={{ color: markdownTextColor, fontStyle: 'italic' }}>{children}</em>,
                            code: ({ children }) => <code style={{ color: markdownTextColor, backgroundColor: markdownTextColor === 'white' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)', padding: '2px 4px', borderRadius: '3px' }}>{children}</code>,
                            pre: ({ children }) => <pre style={{ color: markdownTextColor, backgroundColor: markdownTextColor === 'white' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)', padding: '8px', borderRadius: '4px', overflow: 'auto' }}>{children}</pre>,
                          }}
                        >
                          {formatLLMMarkdown(String(m))}
                        </ReactMarkdown>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

        )}
      </div>
    </div>
  );
}

export default App;
