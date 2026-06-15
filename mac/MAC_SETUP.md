# Knockturn Agent - macOS Setup Guide

## Overview

This guide covers setting up and building the Knockturn Employee Agent for macOS. The macOS version supports both Intel (x86_64) and Apple Silicon (arm64) processors through universal app builds.

## Prerequisites

### Required
- **macOS 10.13 or later**
- **Node.js 16 or later** — [Download](https://nodejs.org/)
- **Xcode Command Line Tools** — Install with:
  ```bash
  xcode-select --install
  ```

### Optional
- **Apple Developer ID** — Required for code signing and distribution
- **Notarization credentials** — Required to distribute outside Mac App Store

## Quick Start

### 1. Run Setup Script

```bash
cd mac/scripts
chmod +x setup-mac.sh
./setup-mac.sh
```

The setup script will:
- Verify system requirements
- Install Node.js dependencies
- Build the project for macOS

### 2. Configure Environment

Create or update `.env.local` in the project root:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_API_URL=http://localhost:3000

DATABASE_URL=postgresql://user:password@localhost:5432/database
DATABASE_USER=your_user
DATABASE_PASSWORD=your_password

SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password

ADMIN_EMAIL=admin@company.com
```

### 3. Accessibility Permissions

The app requires Accessibility permissions to monitor active windows. You'll be prompted during setup.

**Manual setup:**
1. Open **System Preferences → Security & Privacy → Accessibility**
2. Unlock with your password
3. Add "Knockturn Agent" to the list
4. Grant all permissions

Without this, the app cannot track active applications.

## Development

### Start Development Server

```bash
npm run dev        # Run React frontend dev server
npm run dev:mac    # Run Electron app pointing to dev server
```

Open a second terminal:
```bash
npm run dev:mac
```

The app will open with React DevTools available.

### File Structure

```
mac/
├── electron/
│   ├── activityMonitor.mac.ts    # macOS activity monitoring
│   ├── main.mac.ts               # macOS main process
│   ├── tsconfig.mac.json         # macOS TypeScript config
│   └── ...                       # Other Electron files
├── scripts/
│   └── setup-mac.sh              # Setup script
├── package.json                  # macOS-specific dependencies
├── electron-builder.mac.json     # Build configuration
├── entitlements.mac.plist        # macOS app entitlements
└── launch-agent-template.plist   # Auto-start LaunchAgent
```

## Building

### Build for Development

```bash
npm run build
npm run build:mac:dmg
```

This creates an unsigned DMG file in `release/mac/`.

### Build Universal App (Intel + Apple Silicon)

```bash
npm run build
npm run build:mac:universal
```

Creates a universal binary that runs natively on both architectures.

### Code Signing and Notarization

For distribution, you need to sign and notarize the app:

1. **Obtain Developer Certificate**
   - Register as Apple Developer
   - Create a Developer ID certificate in Xcode
   - Export as `.p12` file

2. **Set Signing Credentials**
   ```bash
   export APPLE_ID=your-email@example.com
   export APPLE_ID_PASSWORD=your-app-password
   export APPLE_TEAM_ID=XXXXXXXXXX
   export CERTIFICATE_FILE=/path/to/certificate.p12
   ```

3. **Build with Code Signing**
   ```bash
   npm run build:mac:dmg
   ```

## Key Features

### Activity Monitoring
- Uses AppleScript and IOKit for window detection
- Captures active application and window title
- Tracks idle time with system sensors
- CPU and memory usage monitoring

### Auto-Start
- Configured via LaunchAgent (`~/Library/LaunchAgents/com.knockturn.agent.plist`)
- Set from Settings → Auto-start on Login
- Runs in background by default

### Screenshots
- Captured using `screenshot-desktop` package
- Works on both Intel and Apple Silicon
- Auto-saved to database

### Email Integration
- Daily summary emails
- NodeMailer for SMTP
- Supports Gmail, Office 365, and custom SMTP

## Troubleshooting

### "Cannot find module" Errors

```bash
npm install
npm run build:mac:electron
```

### Accessibility Permission Error

```
[Monitor macOS] AppleScript error
```

**Solution:**
1. System Preferences → Security & Privacy → Accessibility
2. Add and grant permissions to the app
3. Restart the app

### Build Failures

```bash
# Clean and rebuild
npm run clean
npm run build
npm run build:mac:dmg
```

### LaunchAgent Not Working

Check logs:
```bash
cat ~/Library/Logs/knockturn-agent.log
cat ~/Library/Logs/knockturn-agent-error.log
```

Reload LaunchAgent:
```bash
launchctl unload ~/Library/LaunchAgents/com.knockturn.agent.plist
launchctl load ~/Library/LaunchAgents/com.knockturn.agent.plist
```

### Performance Issues

- Check Activity Monitor for CPU usage
- Monitor memory with `log show --predicate 'process == "Knockturn Agent"'`
- Reduce screenshot frequency in settings

## Testing

### Manual Testing Checklist

- [ ] Active window detection works
- [ ] Idle detection triggers after 10 minutes
- [ ] Screenshots are captured
- [ ] Daily emails are sent
- [ ] Auto-start works after restart
- [ ] App runs in background when closed
- [ ] Tray icon works
- [ ] Dashboard shows correct activity

### Integration Testing

```bash
# Test database connection
npm run test-db

# Test email sending
npm run test-email

# Test activity logging
npm run test-activity
```

## Distribution

### DMG Installation

Users can:
1. Download the DMG file
2. Double-click to mount
3. Drag "Knockturn Agent" to Applications folder
4. Launch from Applications

### Notarization

For distribution outside Mac App Store:

```bash
xcrun notarytool submit release/mac/knockturn-agent-*.dmg \
  --apple-id $APPLE_ID \
  --password $APPLE_ID_PASSWORD \
  --team-id $APPLE_TEAM_ID \
  --wait
```

Wait for approval, then staple the ticket:

```bash
xcrun stapler staple release/mac/knockturn-agent-*.dmg
```

## Performance Optimization

### Activity Monitoring
- Updates every 1 second (configurable)
- System metrics updated every 10 seconds
- Uses cached values between updates

### Memory Usage
- Stores last 200 activity logs
- Activity logs auto-saved to disk
- Session state cached in JSON

### CPU Usage
- AppleScript calls limited to 1 per second
- IOKit queries use native binary interface
- Screenshot service runs on schedule

## Advanced Configuration

### Custom Classifications

Edit app classifications in Settings or via IPC:

```javascript
ipcMain.handle('update-app-classifications', (_, classifications) => {
  // Map app names to: 'productive' | 'non_productive' | 'neutral'
  updateAppClassifications(classifications);
  return true;
});
```

### Idle Timeout

Adjust idle detection timeout:

```javascript
ipcMain.handle('set-idle-timeout', (_, minutes) => {
  updateIdleTimeout(minutes); // Default: 10 minutes
  return true;
});
```

## Support

For issues or questions:
1. Check troubleshooting section above
2. Review application logs in `~/Library/Logs/`
3. Enable debug mode by uncommenting console logs
4. Contact support team with logs and reproduction steps

## Version History

### 1.0.0 (Initial Release)
- Support for macOS 10.13+
- Universal app (Intel + Apple Silicon)
- Activity monitoring via AppleScript
- Auto-start via LaunchAgent
- Email integration
- Screenshot capture

## License

Proprietary - Knockturn Employee Agent
