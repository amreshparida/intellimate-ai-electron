import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { io } from 'socket.io-client';
import 'bootstrap/dist/css/bootstrap.min.css';
import './App.css';
import logo from './assets/images/logo.jpg';

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
  const [ttsConfigFetched, setttsConfigFetched] = useState(false);
  const [markdownTextColor, setMarkdownTextColor] = useState('white'); // 'white' or 'black'
  const [interactionHistory, setInteractionHistory] = useState([]); // [{ interactionId, type, question, createdAt }]
  const [selectedInteractionId, setSelectedInteractionId] = useState('');
  const [selectedInteractionLabel, setSelectedInteractionLabel] = useState('');
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const historyDropdownRef = useRef(null);
  const sessionsDropdownRef = useRef(null);
  const [isMinimized, setIsMinimized] = useState(false);
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [textareaContent, setTextareaContent] = useState('');
  const [disableTTS, setDisableTTS] = useState(false);
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [isSessionsLoading, setIsSessionsLoading] = useState(false);
  const [showSessionsDropdown, setShowSessionsDropdown] = useState(false);

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
      const handlettsTranscript = (event, text) => {
        if (!text) return;
        setTranscript(prev => [...prev, String(text)]);
      };
      const handlettsError = (event, message) => {
        setErrorMessage(String(message || 'tts error'));
      };
      ipcRenderer.on('tts-transcript', handlettsTranscript);
      ipcRenderer.on('tts-error', handlettsError);
      ipcRenderer.on('auth-token-received', handleTokenReceived);
      return () => {
        ipcRenderer.removeListener('auth-token-received', handleTokenReceived);
        ipcRenderer.removeListener('tts-transcript', handlettsTranscript);
        ipcRenderer.removeListener('tts-error', handlettsError);
      };
    }
  }, []);

  // Close custom history dropdown on outside click
  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (!isHistoryOpen) return;
      try {
        if (historyDropdownRef.current && !historyDropdownRef.current.contains(e.target)) {
          setIsHistoryOpen(false);
        }
      } catch (_) { }
    };
    document.addEventListener('click', handleOutsideClick, true);
    return () => document.removeEventListener('click', handleOutsideClick, true);
  }, [isHistoryOpen]);

  // Close sessions dropdown on outside click
  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (!showSessionsDropdown) return;
      try {
        if (sessionsDropdownRef.current && !sessionsDropdownRef.current.contains(e.target)) {
          setShowSessionsDropdown(false);
        }
      } catch (_) { }
    };
    document.addEventListener('click', handleOutsideClick, true);
    return () => document.removeEventListener('click', handleOutsideClick, true);
  }, [showSessionsDropdown]);

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

  // Fetch tts config after authentication
  const fetchttsConfig = async () => {
    try {
      const token = authUtils.getToken();
      if (!token) return;

      const response = await fetch(`${window.APP_CONFIG.BASE_URL}/api/user/tts-config`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const ttsConfig = await response.json();
        console.log('🔧 tts Config received:', ttsConfig);

        // Send to Electron process
        if (window.require) {
          const { ipcRenderer } = window.require('electron');
          ipcRenderer.send('store-tts-config', ttsConfig);
        }

        setttsConfigFetched(true);
      } else {
        console.error('Failed to fetch tts config:', response.status);
      }
    } catch (error) {
      console.error('Error fetching tts config:', error);
    }
  };

  // Fetch tts config when authenticated
  useEffect(() => {
    if (isAuthenticated && !ttsConfigFetched) {
      fetchttsConfig();
    }
  }, [isAuthenticated, ttsConfigFetched]);

  // Fetch sessions when authenticated and not in session
  useEffect(() => {
    if (isAuthenticated && !sessionStarted && sessions.length === 0) {
      fetchSessions();
    }
  }, [isAuthenticated, sessionStarted]);

  // Keyboard shortcut for minimize/maximize (Ctrl+m - case sensitive)
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.ctrlKey && event.key.toLowerCase() === 'm') {
        event.preventDefault();
        handleMinimizeMaximize();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isMinimized, showActionPanel]);

  // Keyboard shortcut for analyze screen (Ctrl+s - only when authenticated and session started)
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.ctrlKey && event.key.toLowerCase() === 's' && isAuthenticated && sessionStarted) {
        event.preventDefault();
        handleAnalyzeScreen();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isAuthenticated, sessionStarted]);

  // Keyboard shortcut for toggle listening (Ctrl+q - only when authenticated and session started)
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.ctrlKey && event.key.toLowerCase() === 'q' && isAuthenticated && sessionStarted) {
        event.preventDefault();
        handleToggleListening();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isAuthenticated, sessionStarted, isListening]);

  // Keyboard shortcut for answer question (Ctrl+w - only when authenticated and session started)
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.ctrlKey && event.key.toLowerCase() === 'w' && isAuthenticated && sessionStarted) {
        event.preventDefault();
        handleAnswerQuestion();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isAuthenticated, sessionStarted, transcript]);

  // Keyboard shortcut for clear transcript (Ctrl+d - only when authenticated and session started)
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.ctrlKey && event.key.toLowerCase() === 'd' && isAuthenticated && sessionStarted) {
        event.preventDefault();
        setTranscript([]);
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isAuthenticated, sessionStarted]);

  // Keyboard shortcut for clear ask area (Ctrl+r - only when authenticated and session started)
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.ctrlKey && event.key.toLowerCase() === 'r' && isAuthenticated && sessionStarted) {
        event.preventDefault();
        setTextareaContent('');
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isAuthenticated, sessionStarted]);

  // Prevent default Cmd+R (refresh) behavior
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.metaKey && event.key.toLowerCase() === 'r') {
        event.preventDefault();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // Keyboard shortcut for Ask AI (Ctrl+e - only when authenticated and session started)
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.ctrlKey && event.key.toLowerCase() === 'e' && isAuthenticated && sessionStarted) {
        event.preventDefault();
        handleAskAI();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isAuthenticated, sessionStarted, textareaContent]);


  const handleClose = () => {
    setShowCloseModal(true);
  };

  const handleConfirmClose = () => {
    if (window.require) {
      const { ipcRenderer } = window.require('electron');
      ipcRenderer.send('close-window');
    }
  };

  const handleCancelClose = () => {
    setShowCloseModal(false);
  };

  const handleOpenShortcuts = () => {
    setShowShortcutsModal(true);
  };

  const handleCloseShortcuts = () => {
    setShowShortcutsModal(false);
  };

  const handleOpenLogoutModal = () => {
    setShowLogoutModal(true);
  };

  const handleCloseLogoutModal = () => {
    setShowLogoutModal(false);
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
      ipcRenderer.send('tts-stop-audio');
    }
    try {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    } catch (_) { }
  };

  const handleLogoutSession = () => {
    setSessionStarted(false);
    setSessionId('');
    setTranscript([]);
    setShowLogoutModal(false);
    if (window.require) {
      const { ipcRenderer } = window.require('electron');
      ipcRenderer.send('tts-stop-audio');
    }
    try {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    } catch (_) { }
  };

  const fetchSessions = async () => {
    try {
      setIsSessionsLoading(true);
      const token = authUtils.getToken();
      if (!token) return;

      const response = await fetch(`${window.APP_CONFIG.BASE_URL}${window.APP_CONFIG.AUTH_ENDPOINTS.SESSION_LIST}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const sessionsData = await response.json();
        console.log('📋 Sessions received:', sessionsData);
        setSessions(sessionsData.sessions || sessionsData || []);
      } else {
        console.error('Failed to fetch sessions:', response.status);
        setSessions([]);
      }
    } catch (error) {
      console.error('Error fetching sessions:', error);
      setSessions([]);
    } finally {
      setIsSessionsLoading(false);
    }
  };

  const handleSessionSelect = (sessionId) => {
    setSessionId(sessionId);
    setShowSessionsDropdown(false);
  };

  const handleSessionsDropdownToggle = () => {
    if (!showSessionsDropdown && sessions.length === 0) {
      fetchSessions();
    }
    setShowSessionsDropdown(!showSessionsDropdown);
  };

  const handleMinimizeMaximize = () => {
    if (window.require) {
      const { ipcRenderer } = window.require('electron');
      handleCloseShortcuts();
      handleCloseLogoutModal();
      if (isMinimized) {
        // Restore to default size
        let height = 210;
        if (showActionPanel) height = 600;
        ipcRenderer.send('resize-window', { width: 800, height: height });
        setIsMinimized(false);
      } else {
        // Minimize to 300x100
        ipcRenderer.send('resize-window', { width: 200, height: 50 });
        setIsMinimized(true);
      }
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


  const handleToggleListening = () => {
    if (disableTTS) return;
    setIsListening(prev => !prev);
    if (window.require) {
      const { ipcRenderer } = window.require('electron');
      if (!isListening) {
        // Clear all previous transcripts when starting to listen
        setTranscript([]);
        ipcRenderer.send('tts-start-transcription');
      } else {
        ipcRenderer.send('tts-stop-transcription');
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
          ipcRenderer.send('tts-start-audio');
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

        // On session load, request interaction history once
        try { socket.emit('fetch_interaction_history'); } catch (_) { }

        // Listen for interaction history and populate selector
        socket.on('interaction_history', (payload) => {
          try {
            const items = (payload && Array.isArray(payload.items)) ? payload.items : [];
            // Normalize IDs to strings for stable comparisons
            const normalized = items.map(it => ({
              ...it,
              interactionId: it && it.interactionId != null ? String(it.interactionId) : ''
            }));
            setInteractionHistory(normalized);
            // If we already have a selection, refresh its label from latest data
            try {
              if (selectedInteractionId) {
                const cur = normalized.find(it => String(it.interactionId) === String(selectedInteractionId));
                if (cur) {
                  const raw = cur.question || '';
                  const lbl = (raw && typeof raw === 'string') ? (raw.length > 50 ? (raw.slice(0, 50) + '…') : raw) : '(no question)';
                  setSelectedInteractionLabel(lbl);
                }
              }
            } catch (_) { }
          } catch (_) { }
        });
      });
      socket.on('disconnect', (reason) => {
        console.log('socket disconnected:', reason);
        setLoadingAction(null);
        // Clear interaction history on disconnect
        setInteractionHistory([]);
        setSelectedInteractionId('');
      });
      socket.on('connect_error', (err) => {
        const msg = (err && (err.message || err.error || err)) || 'Connection error occurred';
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
        handleInsufficientCredits();
        console.warn('insufficient_credits:', data);
      });
      socket.on('error', (data) => {
        const errorMsg = (data && (data.message || data.error || data)) || 'Connection error occurred';
        setErrorMessage(String(errorMsg));
        setLoadingAction(null);
        setShowActionPanel(false);
        console.error('Socket error:', data);
      });
      socket.on('answer', (data) => {
        try {
          setErrorMessage(null);
          const ans = (data && (data.answer ?? data)) ?? '';
          // Determine panel type from backend-provided interaction type
          const backendType = (data && data.type) || null; // 'question_answer' | 'analyze_screen'
          if (backendType === 'question_answer') {
            setPanelContentType('question_answer');
          } else if (backendType === 'analyze_screen') {
            setPanelContentType('analyze_screen');
          } else if (backendType === 'ask_ai') {
            setPanelContentType('ask_ai');
          }

          try {
            if (socketRef.current && socketRef.current.connected) {
              socketRef.current.emit('fetch_interaction_history');
            }
          } catch (_) { }

          const isEmpty = (val) => {
            if (val == null) return true;
            if (typeof val === 'string') return val.trim() === '';
            if (typeof val === 'object') return Object.keys(val).length === 0;
            return false;
          };
          if (isEmpty(ans)) {
            setErrorMessage('No result');
            setLoadingAction(null);
            return;
          }
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
    setPanelContentType('question_answer');
    setShowActionPanel(false); // open only when a valid answer arrives
    setLoadingAction('question_answer');
    setErrorMessage(null);
    handleCloseActionPanel();

    // Stop transcription when clicking Answer Question
    if (window.require && isListening) {
      const { ipcRenderer } = window.require('electron');
      ipcRenderer.send('tts-stop-transcription');
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

  const handleInsufficientCredits = () => {
    setDisableTTS(true);
    if (window.require) {
      const { ipcRenderer } = window.require('electron');
      ipcRenderer.send('tts-stop-transcription');
      setIsListening(false);
    }
  };

  const handleAskAI = () => {
    setPanelContentType('ask_ai');
    setShowActionPanel(false); // open only when a valid answer arrives
    setLoadingAction('ask_ai');
    setErrorMessage(null);
    handleCloseActionPanel();

    if (window.require && isListening) {
      const { ipcRenderer } = window.require('electron');
      ipcRenderer.send('tts-stop-transcription');
      setIsListening(false);
    }

    const prompt = textareaContent.trim();

    if (!prompt) {
      setErrorMessage('No question available. Please enter a question.');
      setLoadingAction(null);
      return;
    }

    if (!socketRef.current || !socketRef.current.connected) {
      setErrorMessage('Not connected. Please start session first.');
      setLoadingAction(null);
      return;
    }

    try {
      // Send question to backend via Socket.IO
      socketRef.current.emit('question_input', { data: { prompt: prompt, isAskAI: true } });
      console.log('📤 Sent question to backend:', prompt);
    } catch (error) {
      console.error('Error sending question:', error);
      setErrorMessage('Failed to send question');
      setLoadingAction(null);
    }

  };


  const handlePreviousInteraction = (e) => {
    const raw = (e && e.target) ? e.target.value : '';
    const value = raw != null ? String(raw) : '';
    setSelectedInteractionId(value);
    setErrorMessage(null);
    if (!value) return; // placeholder - do nothing
    try {
      // Ensure a fresh panel for previous interaction content
      setActionMessages([]);
      if (socketRef.current && socketRef.current.connected) {

        socketRef.current.emit('question_input', { interactionId: value });
      }
    } catch (_) { }
  }



  const handleAnalyzeScreen = () => {
    setPanelContentType('analyze_screen');
    setShowActionPanel(false); // do NOT open until we have a valid message
    setActionMessages([]);
    setLoadingAction('analyze_screen');
    setErrorMessage(null);
    handleCloseActionPanel();
    // Stop transcription when clicking Analyze Screen
    if (window.require && isListening) {
      const { ipcRenderer } = window.require('electron');
      ipcRenderer.send('tts-stop-transcription');
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
    // Hide and clear previous messages so next open starts clean
    setShowActionPanel(false);
    setActionMessages([]);
    setSelectedInteractionId('');
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
    if (!e.target.closest('button[class="drag-btn"]')) return;
    if (window.require) {
      const { ipcRenderer } = window.require('electron');
      const startX = e.clientX;
      const startY = e.clientY;
      const handleMouseMove = (moveEvent) => {
        ipcRenderer.send('move-window', {
          deltaX: moveEvent.clientX - startX,
          deltaY: moveEvent.clientY - startY,
          isMinimized: isMinimized ? 1 : 0,
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



  const handleCopyText = () => {
    const selection = window.getSelection().toString();
    if (!selection) {
      return;
    }
    if (window.require) {
      const { ipcRenderer } = window.require('electron');
      ipcRenderer.send('copied-text', selection);
    }
  };




  const formattedCredits =
    availableCredits !== null && !isNaN(Number(availableCredits))
      ? Number(availableCredits).toFixed(2)
      : '—';

  // Keyboard shortcuts data
  const keyboardShortcuts = [
    { function: 'Minimize/Maximize Window', shortcut: 'Ctrl + M' },
    { function: 'Toggle Listening', shortcut: 'Ctrl + Q' },
    { function: 'Answer Question', shortcut: 'Ctrl + W' },
    { function: 'Analyze Screen', shortcut: 'Ctrl + S' },
    { function: 'Clear Transcript', shortcut: 'Ctrl + D' },
    { function: 'Clear Ask Area', shortcut: 'Ctrl + R' },
    { function: 'Ask AI', shortcut: 'Ctrl + E' },
    { function: '⚡ Auto Type', shortcut: 'Ctrl + Shift + V' }
  ];

  if (isLoading) {
    return (
      <div className="vh-100 d-flex flex-column app-container">

        {!isMinimized && (
          <div className="app-header" onMouseDown={handleDragStart}>
            <div className="d-flex align-items-center">
              <img src={logo} alt="Logo" className="app-logo me-2" draggable={false} />
              <span className="text-white fw-bold me-2">{window.APP_CONFIG.APP_NAME}</span>
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
              <button className="drag-btn">𖦏</button>
              <button
                className="min-max-btn"
                onClick={handleMinimizeMaximize}
              >
                {isMinimized ? "+" : "-"}
              </button>
              <button className="close-btn"  onClick={handleClose}>×</button>
            </div>
          </div>
        )}

        {isMinimized && (
          <div className="app-header" onMouseDown={handleDragStart}>
            <div className="d-flex align-items-center">
              <img src={logo} alt="Logo" className="app-logo me-2" draggable={false} />
            </div>
            <div className="d-flex align-items-center gap-2">
              <button className="drag-btn">
                <img src={dragIcon} width={16} height={16} alt="Drag Icon" className="drag-icon" draggable={false} />
              </button>
              <button
                className="min-max-btn"
                onClick={handleMinimizeMaximize}
              >
                {isMinimized ? "+" : "-"}
              </button>
              <button className="close-btn"  onClick={handleClose}>×</button>
            </div>
          </div>
        )}


        {isMinimized && showCloseModal && (
          <div className="app-header" onMouseDown={handleDragStart}>
            <div className="d-flex align-items-center">
              <img src={logo} alt="Logo" className="app-logo me-2" draggable={false} />
            </div>
            <div className="d-flex align-items-center gap-2">

              <button className="btn btn-secondary btn-sm" onClick={handleCancelClose}>Don't Exit</button>
              <button className="btn btn-danger btn-sm" onClick={handleConfirmClose}>Exit</button>


            </div>
          </div>
        )}





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

        {!isMinimized && (
          <div className="app-header" onMouseDown={handleDragStart}>
            <div className="d-flex align-items-center">
              <img src={logo} alt="Logo" className="app-logo me-2" draggable={false} />
              <span className="text-white fw-bold me-2">{window.APP_CONFIG.APP_NAME}</span>

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
              {isAuthenticated && sessionStarted && (
                <>
                  <button className="shortcut-btn" onClick={handleOpenShortcuts}>⌗</button>
                </>
              )}
              {isAuthenticated && (
                <>
                  <button className="dashboard-btn"  onClick={handleDashboard}>⾕</button>
                  <button className="logout-btn"  onClick={handleOpenLogoutModal}>⏻</button>
                </>
              )}
              <button className="drag-btn" >𖦏</button>
              <button
                className="min-max-btn"

                onClick={handleMinimizeMaximize}
              >
                {isMinimized ? "+" : "-"}
              </button>
              <button className="close-btn"  onClick={handleClose}>×</button>
            </div>
          </div>
        )}

        {isMinimized && (
          <div className="app-header" onMouseDown={handleDragStart}>
            <div className="d-flex align-items-center">
              <img src={logo} alt="Logo" className="app-logo me-2" draggable={false} />
            </div>
            <div className="d-flex align-items-center gap-2">
              <button className="drag-btn" >𖦏</button>
              <button
                className="min-max-btn"

                onClick={handleMinimizeMaximize}
              >
                {isMinimized ? "+" : "-"}
              </button>
              <button className="close-btn"  onClick={handleClose}>×</button>
            </div>
          </div>
        )}

        {isMinimized && showCloseModal && (
          <div className="app-header" onMouseDown={handleDragStart}>
            <div className="d-flex align-items-center">
              <img src={logo} alt="Logo" className="app-logo me-2" draggable={false} />
            </div>
            <div className="d-flex align-items-center gap-2">

              <button className="btn btn-secondary btn-sm" onClick={handleCancelClose}>Don't Exit</button>
              <button className="btn btn-danger btn-sm" onClick={handleConfirmClose}>Exit</button>


            </div>
          </div>
        )}

        <div className="app-content">
          {isAuthenticated ? (
            sessionStarted ? (
              <div className="app-inner-content container mt-1">
                {/* New Two-Column Layout */}
                <div className="row mt-3">
                  {/* Left Column - Transcript Container */}
                  <div className="col-6">
                    <div className="transcript-section" style={{ position: 'relative' }}>
                      <div style={{ position: 'relative' }}>
                        <textarea
                          className="form-control"
                          value={transcript.join('\n')}
                          readOnly
                          style={{
                            height: '60px',
                            maxHeight: '60px',
                            resize: 'none',
                            border: '1px solid #6c757d',
                            borderRadius: '8px',
                            fontSize: '12px',
                            padding: '8px',
                            lineHeight: '20px',
                            backgroundColor: 'rgba(0, 0, 0, 0.55)',
                            color: 'white',
                            position: 'relative',
                            zIndex: 1
                          }}
                        />
                        {transcript.length === 0 && (
                          <div style={{
                            position: 'absolute',
                            top: '0',
                            left: '0',
                            right: '0',
                            bottom: '0',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            pointerEvents: 'none',
                            zIndex: 3,
                            fontSize: '12px',
                            color: 'rgba(255, 255, 255, 0.7)',
                            fontStyle: 'italic'
                          }}>
                            Transcript will appear here...
                          </div>
                        )}
                      </div>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => setTranscript([])}
                        style={{
                          position: 'absolute',
                          top: '-8px',
                          right: '5px',
                          fontSize: '10px',
                          padding: '2px 6px',
                          zIndex: 10
                        }}
                      >
                        Clear
                      </button>
                    </div>
                  </div>

                  {/* Right Column - Text Area */}
                  <div className="col-6">
                    <div className="text-area-section" style={{ position: 'relative' }}>
                      <div style={{ position: 'relative' }}>
                        <textarea
                          className="form-control"
                          placeholder=""
                          value={textareaContent}
                          onChange={(e) => setTextareaContent(e.target.value)}
                          style={{
                            height: '60px',
                            maxHeight: '60px',
                            resize: 'none',
                            border: '1px solid #6c757d',
                            borderRadius: '8px',
                            fontSize: '12px',
                            padding: '8px',
                            lineHeight: '20px',
                            backgroundColor: 'rgba(0, 0, 0, 0.55)',
                            color: 'white',
                            position: 'relative',
                            zIndex: 2
                          }}
                        />
                        {!textareaContent && (
                          <div style={{
                            position: 'absolute',
                            top: '0',
                            left: '0',
                            right: '0',
                            bottom: '0',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            pointerEvents: 'none',
                            zIndex: 3,
                            fontSize: '12px',
                            color: 'rgba(255, 255, 255, 0.7)',
                            fontStyle: 'italic'
                          }}>
                            Type your question here...
                          </div>
                        )}
                      </div>
                      <div style={{
                        position: 'absolute',
                        top: '-8px',
                        right: '5px',
                        display: 'flex',
                        gap: '2px',
                        zIndex: 10
                      }}>
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => setTextareaContent('')}
                          style={{
                            fontSize: '10px',
                            padding: '2px 6px'
                          }}
                        >
                          Clear
                        </button>
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={handleAskAI}
                          disabled={!!loadingAction}
                          style={{
                            fontSize: '10px',
                            padding: '2px 6px'
                          }}
                        >
                          Ask AI
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* ✅ Buttons directly below transcript row */}
                <div className="text-center mt-3">
                  <div className="d-flex justify-content-center gap-3">
                    <button  className="btn btn-light btn-sm" onClick={handleToggleListening} disabled={!!loadingAction || disableTTS}>
                      {isListening && !disableTTS ? (
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
                    <button  className="btn btn-success btn-sm" onClick={handleAnswerQuestion} disabled={!!loadingAction}>
                      {loadingAction === 'answer' ? (
                        <>
                          <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                          Answering...
                        </>
                      ) : 'Answer Question'}
                    </button>
                    <button  className="btn btn-info btn-sm" onClick={handleAnalyzeScreen} disabled={!!loadingAction}>
                      {loadingAction === 'analyze' ? (
                        <>
                          <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                          Analyzing...
                        </>
                      ) : 'Analyze Screen'}
                    </button>
                    {interactionHistory.length > 0 && (
                      <div ref={historyDropdownRef} style={{ position: 'relative' }}>
                        <button
                          type="button"
                          className="btn btn-outline-light btn-sm"
                          onClick={() => setIsHistoryOpen(prev => !prev)}
                          aria-expanded={isHistoryOpen}
                          style={{ minWidth: 260, textAlign: 'left' }}
                          disabled={!!loadingAction}
                        >
                          {selectedInteractionId ? (() => {
                            const selectedItem = interactionHistory.find(item => item?.interactionId === selectedInteractionId);
                            if (selectedItem) {
                              const raw = selectedItem?.question || '';
                              const label = (raw && typeof raw === 'string') ? (raw.length > 30 ? (raw.slice(0, 30) + '…') : raw) : '(no question)';
                              return label;
                            }
                            return 'Select Previous Interactions';
                          })() : 'Select Previous Interactions'}
                          <span style={{ float: 'right' }}>▾</span>
                        </button>
                        {isHistoryOpen && (
                          <div
                            className="dropdown-menu show"
                            style={{
                              display: 'block',
                              position: 'absolute',
                              right: 0,
                              top: '',
                              marginTop: -120,
                              zIndex: 1000,
                              maxHeight: 155,
                              overflowY: 'auto',
                              width: 320,
                              padding: 4
                            }}
                          >
                            <button
                              className="dropdown-item"
                              type="button"
                              style={{ padding: '4px 8px', fontSize: 12 }}
                              onClick={() => {
                                setIsHistoryOpen(false);
                                handleCloseActionPanel();
                              }}
                            >
                              Select Previous Interactions
                            </button>
                            <div className="dropdown-divider" style={{ margin: '2px 0' }}></div>
                            {interactionHistory.map((item) => {
                              const id = item?.interactionId || '';
                              const raw = item?.question || '';
                              const label = (raw && typeof raw === 'string') ? (raw.length > 50 ? (raw.slice(0, 50) + '…') : raw) : '(no question)';
                              return (
                                <button
                                  key={id}
                                  className="dropdown-item"
                                  type="button"
                                  style={{ padding: '4px 8px', fontSize: 12 }}
                                  onClick={() => {
                                    setSelectedInteractionId(id);
                                    setSelectedInteractionLabel(label);
                                    setIsHistoryOpen(false);
                                    handlePreviousInteraction({ target: { value: id } });
                                  }}
                                >
                                  {label}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
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
                  Create a session in the dashboard, then select a session<br />
                  from the dropdown below to continue.
                </p>
                <div className="d-flex gap-2 justify-content-center my-2">
                  <button
                    className="btn btn-outline-light btn-sm"
                    onClick={fetchSessions}
                    disabled={isSessionsLoading}
                    style={{ minWidth: '35px' }}
                    title="Refresh Sessions"
                  >
                    {isSessionsLoading ? (
                      <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
                    ) : (
                      '↻'
                    )}
                  </button>
                  <div ref={sessionsDropdownRef} style={{ position: 'relative' }}>
                    <button
                      type="button"
                      className="btn btn-outline-light btn-sm"
                      onClick={handleSessionsDropdownToggle}
                      aria-expanded={showSessionsDropdown}
                      style={{ width: 400, textAlign: 'left' }}
                      disabled={isSessionsLoading}
                    >
                      {isSessionsLoading ? 'Loading sessions...' : 
                       sessions.length === 0 ? 'No sessions available' : 
                       sessionId ? (() => {
                         const selectedSession = sessions.find(s => (s.sessionId || s.id) === sessionId);
                         if (selectedSession) {
                           const companyName = selectedSession.companyName || 'Unknown Company';
                           const resumeFileName = selectedSession.resumeFileName || 'No Resume';
                           const cleanFileName = resumeFileName.replace(/\.pdf$/i, '');
                           const label = `[${sessionId}] - ${companyName} - ${cleanFileName}`;
                           return label.length > 50 ? (label.slice(0, 50) + '…') : label;
                         }
                         return 'Select Session';
                       })() : 'Select Session'}
                      <span style={{ float: 'right' }}>▾</span>
                    </button>
                    {showSessionsDropdown && sessions.length > 0 && (
                      <div
                        className="dropdown-menu show"
                        style={{
                          display: 'block',
                          position: 'absolute',
                          right: 0,
                          top: '',
                          marginTop: -108,
                          zIndex: 1000,
                          maxHeight: 155,
                          overflowY: 'auto',
                          width: 400,
                          padding: 4
                        }}
                      >
                        <button
                          className="dropdown-item"
                          type="button"
                          style={{ padding: '4px 8px', fontSize: 12 }}
                          onClick={() => {
                            setSessionId('');
                            setShowSessionsDropdown(false);
                          }}
                        >
                          Select Session
                        </button>
                        <div className="dropdown-divider" style={{ margin: '2px 0' }}></div>
                        {sessions.map((session) => {
                          const sessionId = session.sessionId || session.id;
                          const companyName = session.companyName || 'Unknown Company';
                          const resumeFileName = session.resumeFileName || 'No Resume';
                          const cleanFileName = resumeFileName.replace(/\.pdf$/i, '');
                          const label = `[${sessionId}] - ${companyName} - ${cleanFileName}`;
                          const displayLabel = label.length > 70 ? (label.slice(0, 70) + '…') : label;
                          
                          return (
                            <button
                              key={sessionId}
                              className="dropdown-item"
                              type="button"
                              style={{ padding: '4px 8px', fontSize: 12 }}
                              onClick={() => handleSessionSelect(sessionId)}
                            >
                              {displayLabel}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <button className="btn btn-success btn-sm" onClick={handleContinue} disabled={isConnecting || !sessionId}>
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
                {panelContentType === 'question_answer' ? 'Answer:' : panelContentType === 'ask_ai' ? 'Ask AI:' : panelContentType === 'analyze_screen' ? 'Analysis:' : ''}
              </span>



              <div
                className="d-flex align-items-center gap-2 position-absolute"
                style={{ right: '8px', top: '6px' }}
              >
                <span className="text-light" style={{ fontSize: '8px' }} >
                  Select the text 🪄, click Copy 📋, and press<br /> Ctrl + Shift + V to ⚡ auto-type at 1 char / 0.2 s
                </span>

                <button className="btn btn-outline-secondary btn-sm"
                  style={{
                    border: '1px solid rgba(255,255,255,0.3)',
                    background: 'rgba(255,255,255,0.2)',
                    height: '28px',
                  }}
                  onClick={handleCopyText}
                >
                  📋
                </button>

                {/* Toggle button */}
                <button
                  className="btn"
                  onClick={() =>
                    setMarkdownTextColor(prev => (prev === 'white' ? 'black' : 'white'))
                  }
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

      {/* Close Confirmation Modal */}
      {showCloseModal && !isMinimized && (
        <div className="modal-overlay" onClick={handleCancelClose}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h5 className="modal-title">Exit Application</h5>
            </div>

            <div className="modal-footer">
              <button
                className="btn btn-secondary"
                onClick={handleCancelClose}
              >
                Don't Exit
              </button>
              <button
                className="btn btn-danger"
                onClick={handleConfirmClose}
              >
                Exit
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Keyboard Shortcuts Modal */}
      {showShortcutsModal && (
        <div className="modal-overlay" onClick={handleCloseShortcuts}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h5 className="modal-title">Keyboard Shortcuts</h5>
              <button className="btn btn-outline-danger btn-sm ms-auto" onClick={handleCloseShortcuts}>X</button>
            </div>

            <div className="modal-footer">
              <div className="w-100" style={{ maxHeight: '100px', overflowY: 'auto', fontSize: '0.85rem' }}>
                <table className="table table-sm table-dark table-striped mb-0">
                  <thead>
                    <tr>
                      <th>Function</th>
                      <th>Shortcut</th>
                    </tr>
                  </thead>
                  <tbody>
                    {keyboardShortcuts.map((item, index) => (
                      <tr key={index}>
                        <td className="">{item.function}</td>
                        <td className="fst-italic">{item.shortcut}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

            </div>

          </div>
        </div>
      )}

      {/* Logout Modal */}
      {showLogoutModal && (
        <div className="modal-overlay" onClick={handleCloseLogoutModal}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h5 className="modal-title">Logout</h5>
            </div>

            <div className="modal-footer">
              <button
                className="btn btn-secondary"
                onClick={handleCloseLogoutModal}
              >
                Cancel
              </button>
              {sessionStarted && (
                <button
                  className="btn btn-outline-warning"
                  onClick={handleLogoutSession}
                >
                  Logout Session Only
                </button>
              )}
              <button
                className="btn btn-danger"
                onClick={handleLogout}
              >
                Logout Completely
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
