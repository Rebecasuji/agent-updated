# Knockturn Agent - macOS Version

Complete macOS implementation of the Knockturn Employee Agent with support for both Intel and Apple Silicon processors.

## Quick Start

```bash
chmod +x scripts/setup-mac.sh
./scripts/setup-mac.sh
```

This will set up your development environment and build the project.

## Directory Structure

```
mac/
├── electron/
│   ├── activityMonitor.mac.ts    # Activity monitoring (AppleScript + IOKit)
│   ├── main.mac.ts               # Main Electron process for macOS
│   └── tsconfig.mac.json         # TypeScript configuration
├── scripts/
│   ├── setup-mac.sh              # Initial setup script
│   ├── test-monitor.sh           # Test activity monitoring
│   └── notarize.js               # Apple notarization helper
├── MAC_SETUP.md                  # Comprehensive setup guide
├── package.json                  # macOS-specific dependencies
├── vite.config.mac.ts            # Vite configuration
├── tsconfig.mac.json             # TypeScript config
├── electron-builder.mac.json     # Build configuration for DMG/ZIP
├── entitlements.mac.plist        # macOS app entitlements
└── launch-agent-template.plist   # LaunchAgent for auto-start
```

## Development

### Start Development Server

Terminal 1 - React frontend:
```bash
npm run dev
```

Terminal 2 - Electron app:
```bash
npm run dev:mac
```

### Build for macOS

Development build:
```bash
npm run build:mac:dmg
```

Universal build (Intel + Apple Silicon):
```bash
npm run build:mac:universal
```

## Key Features

✅ **Activity Monitoring** — Tracks active windows and applications  
✅ **Idle Detection** — Configurable idle timeout (default 10 minutes)  
✅ **Screenshots** — Periodic screenshot capture and storage  
✅ **Auto-Start** — LaunchAgent setup for login-time launch  
✅ **Background Monitoring** — Runs in background with tray icon  
✅ **Email Integration** — Daily summary emails  
✅ **Universal App** — Works on Intel and Apple Silicon  

## System Requirements

- **macOS 10.13** or later
- **Node.js 16** or later
- **Xcode Command Line Tools**
- **Accessibility Permissions** (for window tracking)

## Permissions

The app requires the following macOS permissions:

1. **Accessibility** — To detect active windows
   - System Preferences → Security & Privacy → Accessibility
   
2. **Screen Recording** — To capture screenshots (optional)
   - System Preferences → Security & Privacy → Screen Recording

3. **Network** — For API communication and email

## Important Notes

### Accessibility Permissions

Without Accessibility permissions, the app cannot:
- Detect the active application
- Get window titles
- Track user activity

The app will prompt you to grant these permissions during setup or first launch.

### Code Signing

For development/testing, code signing is not required. For distribution, you must:

1. Obtain an Apple Developer ID certificate
2. Code sign the app
3. Notarize with Apple (required for distribution outside App Store)

See **MAC_SETUP.md** for detailed code signing instructions.

### LaunchAgent

Auto-start is configured through LaunchAgent at:
```
~/Library/LaunchAgents/com.knockturn.agent.plist
```

This is created automatically when you enable "Auto-start on Login" in the app settings.

## Troubleshooting

### "AppleScript error" when running

**Solution:** Grant Accessibility permissions
1. System Preferences → Security & Privacy → Accessibility
2. Unlock and add the Knockturn Agent
3. Restart the app

### Build errors

```bash
npm run clean
npm install
npm run build
```

### LaunchAgent not loading

Check logs:
```bash
cat ~/Library/Logs/knockturn-agent.log
cat ~/Library/Logs/knockturn-agent-error.log
```

Manually reload:
```bash
launchctl unload ~/Library/LaunchAgents/com.knockturn.agent.plist
launchctl load ~/Library/LaunchAgents/com.knockturn.agent.plist
```

## Testing

Run monitoring tests:
```bash
chmod +x scripts/test-monitor.sh
./scripts/test-monitor.sh
```

This verifies:
- AppleScript access
- IOKit interface
- System metrics collection

## Performance

- Activity monitoring: 1 update/second
- System metrics: Updated every 10 seconds
- Memory usage: ~50-100MB
- CPU usage: <1% idle, <2% active

## Documentation

- **MAC_SETUP.md** — Detailed setup and configuration guide
- **../AGENT_SETUP.md** — General agent setup
- **../EMAIL_SETUP.md** — Email configuration
- **../MONITORING_GUIDE.md** — Monitoring features

## Related Files

The macOS version uses shared components from:
- `../electron/idlePromptWindow.ts`
- `../electron/floatingTimer.ts`
- `../electron/dailyScheduler.ts`
- `../electron/emailService.ts`
- `../src/components/*` (React UI)

These are imported by `main.mac.ts` and `activityMonitor.mac.ts`.

## License

Proprietary - Knockturn Employee Agent

## Support

For issues or questions, refer to:
1. **MAC_SETUP.md** — Troubleshooting section
2. Application logs in `~/Library/Logs/`
3. Contact support with logs and details
