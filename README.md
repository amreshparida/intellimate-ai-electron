# Intellimate AI - Desktop Application

An Electron-based desktop application that provides AI-powered assistance through voice transcription and screen analysis.

## Features

- 🎤 **Real-time Voice Transcription** using AssemblyAI
- 📱 **Screen Analysis** with AI-powered image processing
- 🔐 **User Authentication** with JWT tokens
- 💳 **Credit System** for API usage tracking
- 🎨 **Modern UI** with glassmorphism design
- 🔄 **Cross-platform** support (Windows, macOS, Linux)

## Development

### Prerequisites

- Node.js > 20.0.0
- npm or yarn

### Installation

```bash
npm install
```

### Development Scripts

```bash
# Start development server with hot reload
npm run dev
# or
npm run electron-dev

# Test FFmpeg integration
npm run test-ffmpeg

# Build for production
npm run build

# Package the application
npm run build-app
```

### Development Workflow

1. **Start Development**: `npm run dev`
   - Starts React development server on port 3001
   - Launches Electron app with hot reload
   - Automatically waits for React server to be ready

2. **Test Audio Capture**: The app includes FFmpeg for cross-platform audio capture
   - Windows: Uses WASAPI for system audio
   - macOS: Uses AudioTee (with FFmpeg fallback)
   - Linux: Uses PulseAudio with FFmpeg

3. **Build & Package**: `npm run build-app`
   - Builds React app for production
   - Packages Electron app with all dependencies
   - Creates platform-specific installers

## Technical Stack

- **Frontend**: React 18, Bootstrap 5
- **Desktop**: Electron 27
- **Audio**: AssemblyAI, FFmpeg, AudioTee
- **Communication**: Socket.IO
- **Authentication**: JWT tokens

## Platform Support

- **Windows**: NSIS installer with FFmpeg WASAPI
- **macOS**: DMG with AudioTee/FFmpeg AVFoundation
- **Linux**: AppImage with FFmpeg PulseAudio

## Configuration

The app uses a central configuration system via `src/config.js`:

```javascript
window.APP_CONFIG = {
  APP_NAME: 'Intellimate AI',
  BASE_URL: 'http://localhost:3000',
  AUTH_ENDPOINTS: {
    LOGIN: '/user/app',
    DASHBOARD: '/user/dashboard',
    LOGOUT: '/api/auth/logout'
  }
};
```

## Audio Capture

The application supports cross-platform audio capture:

- **Primary**: Platform-specific native libraries (AudioTee on macOS)
- **Fallback**: FFmpeg with platform-specific audio APIs
- **Format**: 16kHz, mono, 16-bit PCM for AssemblyAI compatibility

## Building

The app is configured to build for all platforms with proper FFmpeg bundling:

```bash
# Build for current platform
npm run build-app

# The build will include:
# - React app bundle
# - Electron main process
# - FFmpeg binaries for all platforms
# - Audio capture libraries
```

## Troubleshooting

### Audio Capture Issues

1. **Windows**: Ensure microphone permissions are granted
2. **macOS**: Grant screen recording permissions
3. **Linux**: Install PulseAudio development libraries

### Development Issues

- If `npm run dev` fails, try running `npm start` and `npm run electron` separately
- Ensure port 3001 is available for the React development server
- Check that all dependencies are installed with `npm install`
