#!/bin/bash

# Test script for macOS - Activity Monitoring

echo "Testing Activity Monitoring on macOS..."
echo ""

# Test AppleScript access
echo "1. Testing AppleScript (window detection)..."
osascript <<'APPLESCRIPT'
tell application "System Events"
  set appName to name of first application process whose frontmost is true
  tell process appName
    set windowTitle to name of front window
  end tell
end tell
APPLESCRIPT

if [ $? -eq 0 ]; then
    echo "✓ AppleScript working"
else
    echo "✗ AppleScript failed - check Accessibility permissions"
fi

echo ""

# Test IOKit access (idle time)
echo "2. Testing IOKit (idle time detection)..."
ioreg -c IOHIDSystem | grep HIDIdleTime > /dev/null

if [ $? -eq 0 ]; then
    echo "✓ IOKit accessible"
else
    echo "✗ IOKit check failed"
fi

echo ""

# Test system metrics
echo "3. Testing system metrics..."
echo "  CPU Usage:"
ps -A -o %cpu | awk '{s+=$1} END {print "    " s "%"}'

echo "  Memory Usage:"
vm_stat | grep "Pages free"

echo ""
echo "✓ Basic system monitoring tests complete"
