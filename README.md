# Intellimate AI - Electron Desktop Application

A powerful AI-powered desktop application built with Electron and React that provides intelligent assistance through voice transcription, screen analysis, and automated typing capabilities.

## 🚀 Features

### Core Functionality
- **🎤 Real-time Voice Transcription** - Convert speech to text using AssemblyAI
- **📺 Screen Analysis** - AI-powered screenshot analysis and insights
- **⚡ Auto-Typing** - Automated text input with customizable delays
- **🤖 AI Chat Interface** - Interactive AI assistant for questions and answers
- **📋 Session Management** - Persistent session handling with history
- **🔐 Secure Authentication** - Token-based authentication system

### Advanced Features
- **🎯 Smart Window Detection** - Automatically detects and tracks active windows
- **⌨️ Global Keyboard Shortcuts** - System-wide hotkeys for quick access
- **🔊 System Audio Capture** - Captures system audio for transcription
- **📱 Cross-Platform Support** - Works on macOS, Windows, and Linux
- **🛡️ Permission Management** - Automatic macOS permission handling
- **💾 Persistent Storage** - Saves user preferences and session data

### User Interface
- **🎨 Modern UI** - Clean, responsive interface with Bootstrap styling
- **📱 Responsive Design** - Adapts to different screen sizes
- **🌙 Dark Theme** - Professional dark interface
- **📊 Real-time Status** - Live indicators for transcription and processing
- **🔄 Session History** - Access to previous interactions and sessions

## 🛠️ Technology Stack

- **Frontend**: React 18, Bootstrap 5, Socket.IO Client
- **Backend**: Electron 27, Node.js
- **AI Services**: AssemblyAI for speech-to-text
- **Audio Processing**: audiotee (macOS), naudiodon (Windows/Linux)
- **Automation**: @nut-tree-fork/nut-js for keyboard/mouse control
- **Build Tools**: electron-builder, react-scripts

## 📋 Prerequisites

- **Node.js** >= 20.0.0
- **npm** or **yarn**
- **macOS**: Xcode Command Line Tools (for native modules)
- **Windows**: Visual Studio Build Tools
- **Linux**: build-essential package

## 🚀 Quick Start

### 1. Clone the Repository
```bash
git clone https://github.com/your-username/intellimate-ai-electron.git
cd intellimate-ai-electron
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Environment Setup
Create a `.env` file in the root directory:
```env
# API Configuration
REACT_APP_BASE_URL=https://intellimate.gradelify.com
REACT_APP_API_KEY=your_api_key_here

# Development Settings
NODE_ENV=development
```

### 4. Run Development Server
```bash
npm run dev
```

## 🔧 Development

### Available Scripts

```bash
# Start React development server
npm start

# Run Electron in development mode
npm run electron-dev

# Run both React and Electron concurrently
npm run dev

# Build React app
npm run build

# Run Electron with built React app
npm run electron

# Run tests
npm test
```

### Development Workflow

1. **Start Development Environment**:
   ```bash
   npm run dev
   ```
   This runs both React (port 3001) and Electron concurrently.

2. **Hot Reload**: 
   - React changes auto-reload the renderer process
   - Electron main process requires restart for changes

3. **Debugging**:
   - **Renderer Process**: Use Chrome DevTools (F12)
   - **Main Process**: Use VS Code debugger or `console.log`

### Project Structure

```
intellimate-ai-electron/
├── public/
│   ├── electron.js          # Main Electron process
│   └── index.html           # HTML template
├── src/
│   ├── App.js               # Main React component
│   ├── App.css              # Application styles
│   ├── index.js             # React entry point
│   ├── config.js            # App configuration
│   └── utils/
│       └── auth.js          # Authentication utilities
├── build/                   # Built React app
├── dist/                    # Built Electron app
├── package.json             # Dependencies and scripts
└── README.md               # This file
```

## 🏗️ Building for Production

### Build Commands

```bash
# Build React app only
npm run build

# Build Electron app for current platform
npm run electron-pack

# Build for specific platforms
npm run electron-pack-mac-universal  # macOS (Intel + Apple Silicon)
npm run electron-pack-win            # Windows
npm run electron-pack-linux          # Linux

# Build signed apps (requires certificates)
npm run build-signed-mac             # Signed macOS app
npm run build-signed-win             # Signed Windows app
npm run build-signed-all             # All platforms
```

### Build Outputs

- **macOS**: `.dmg` installer in `dist/`
- **Windows**: `.exe` installer in `dist/`
- **Linux**: `.AppImage` in `dist/`

## ⚙️ Configuration

### App Configuration (`src/config.js`)

```javascript
window.APP_CONFIG = {
  APP_NAME: 'Intellimate AI',
  BASE_URL: 'https://intellimate.gradelify.com',
  AUTH_ENDPOINTS: {
    LOGIN: '/user/app',
    DASHBOARD: '/user/dashboard',
    LOGOUT: '/api/auth/logout',
    SESSION_LIST: '/api/user/sessions',
  }
};
```

### Electron Builder Configuration (`package.json`)

```json
{
  "build": {
    "appId": "com.intellimate.ai",
    "productName": "Intellimate AI",
    "directories": {
      "output": "dist"
    },
    "mac": {
      "category": "public.app-category.utilities",
      "target": "dmg",
      "hardenedRuntime": true,
      "entitlements": "build/entitlements.mac.plist"
    },
    "win": {
      "target": "nsis"
    },
    "linux": {
      "target": "AppImage"
    }
  }
}
```

## 🔐 Permissions & Security

### macOS Permissions

The app automatically requests the following permissions:

- **♿ Accessibility** - Required for auto-typing functionality
- **📺 Screen Recording** - Required for screenshot analysis

### Permission Flow

1. **App Startup**: Automatically checks and requests permissions
2. **User Interaction**: Shows permission dialogs if needed
3. **Blocking**: Prevents app usage without required permissions
4. **Cross-Platform**: Non-macOS platforms skip permission checks

### Security Features

- **Token-based Authentication**: Secure API communication
- **Content Protection**: Prevents screenshots of sensitive content
- **Secure Storage**: Encrypted local storage for credentials
- **Network Security**: HTTPS-only API communication

## 🎮 Usage Guide

### Getting Started

1. **Launch Application**: Start the app from your applications folder
2. **Login**: Click "Login" to authenticate with your account
3. **Select Session**: Choose an existing session or create a new one
4. **Grant Permissions**: Allow accessibility and screen recording permissions (macOS)

### Core Workflows

#### Voice Transcription
1. Click **"Start Listening"** or press `Ctrl+Q`
2. Speak naturally - the app captures system audio
3. View real-time transcription in the transcript area
4. Click **"Answer Question"** or press `Ctrl+W` to get AI responses

#### Screen Analysis
1. Click **"Analyze Screen"** or press `Ctrl+S`
2. The app captures the current screen
3. AI analyzes the screenshot and provides insights
4. View results in the expanded panel

#### Auto-Typing
1. Select text in any application
2. Press `Ctrl+Shift+C` to copy for auto-typing
3. Switch to target application
4. Press `Ctrl+Shift+V` to start automated typing

#### AI Chat
1. Type your question in the text area
2. Click **"Ask AI"** or press `Ctrl+E`
3. View AI response in the expanded panel
4. Use **"Copy"** button to copy responses for auto-typing

### Keyboard Shortcuts

| Shortcut | Function |
|----------|----------|
| `Ctrl+M` | Minimize/Maximize Window |
| `Ctrl+Q` | Toggle Listening |
| `Ctrl+W` | Answer Question |
| `Ctrl+S` | Analyze Screen |
| `Ctrl+D` | Clear Transcript |
| `Ctrl+R` | Clear Ask Area |
| `Ctrl+E` | Ask AI |
| `Ctrl+Shift+C` | Copy Text for Auto-Type |
| `Ctrl+Shift+V` | Auto-Type |

## 🔧 Troubleshooting

### Common Issues

#### Permission Denied (macOS)
```
⚠️ Please grant Accessibility and Screen Recording permissions to continue.
```
**Solution**: Go to System Preferences > Security & Privacy > Privacy and enable permissions for Intellimate AI.

#### Audio Capture Issues
```
Failed to start audio capture
```
**Solutions**:
- Check microphone permissions
- Restart the application
- Verify audio device availability

#### Connection Errors
```
Connection error occurred
```
**Solutions**:
- Check internet connection
- Verify API endpoint configuration
- Check authentication token validity

#### Build Failures
```
Module not found: Can't resolve 'module-name'
```
**Solutions**:
- Run `npm install` to install dependencies
- Clear node_modules and reinstall: `rm -rf node_modules && npm install`
- Check Node.js version compatibility

### Debug Mode

Enable debug logging by setting environment variable:
```bash
DEBUG=electron:* npm run dev
```

### Logs Location

- **macOS**: `~/Library/Logs/Intellimate AI/`
- **Windows**: `%USERPROFILE%\AppData\Roaming\Intellimate AI\logs\`
- **Linux**: `~/.config/Intellimate AI/logs/`

## 🤝 Contributing

### Development Setup

1. Fork the repository
2. Create a feature branch: `git checkout -b feature-name`
3. Make your changes
4. Test thoroughly on your platform
5. Submit a pull request

### Code Style

- Use ESLint configuration
- Follow React best practices
- Maintain consistent formatting
- Add comments for complex logic

### Testing

```bash
# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Run E2E tests
npm run test:e2e
```

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

### Getting Help

- **Documentation**: Check this README and inline code comments
- **Issues**: Report bugs via GitHub Issues
- **Discussions**: Use GitHub Discussions for questions
- **Email**: Contact support@intellimate.ai

### System Requirements

- **macOS**: 10.15+ (Intel or Apple Silicon)
- **Windows**: Windows 10+ (x64)
- **Linux**: Ubuntu 18.04+ or equivalent
- **RAM**: 4GB minimum, 8GB recommended
- **Storage**: 500MB free space

## 🔄 Updates

### Auto-Updates

The app supports automatic updates:
- **macOS**: Uses Sparkle framework
- **Windows**: Uses electron-updater
- **Linux**: Manual updates via package manager

### Version History

- **v1.0.0**: Initial release with core features
- **v1.1.0**: Added auto-typing functionality
- **v1.2.0**: Enhanced permission management
- **v1.3.0**: Cross-platform improvements

---

**Built with ❤️ by the Intellimate AI Team**