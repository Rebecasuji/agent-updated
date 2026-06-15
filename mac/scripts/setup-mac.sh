#!/bin/bash

# Knockturn Employee Agent - macOS Setup Script
# This script sets up the Knockturn Agent for macOS development

set -e

echo "==================================="
echo "Knockturn Agent - macOS Setup"
echo "==================================="
echo ""

# Check macOS version
OS_VERSION=$(sw_vers -ProductVersion | cut -d. -f1,2)
echo "✓ macOS Version: $OS_VERSION"
echo ""

# Check if Xcode Command Line Tools are installed
echo "Checking Xcode Command Line Tools..."
if ! command -v xcode-select &> /dev/null; then
    echo "❌ Xcode Command Line Tools not found"
    echo "Installing Xcode Command Line Tools..."
    xcode-select --install
    echo "Please complete the installation and run this script again"
    exit 1
fi
echo "✓ Xcode Command Line Tools installed"
echo ""

# Check Node.js
echo "Checking Node.js..."
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found"
    echo "Please install Node.js from https://nodejs.org/"
    exit 1
fi
NODE_VERSION=$(node -v)
echo "✓ Node.js $NODE_VERSION installed"
echo ""

# Check npm
echo "Checking npm..."
NPM_VERSION=$(npm -v)
echo "✓ npm $NPM_VERSION installed"
echo ""

# Install dependencies
echo "Installing npm dependencies..."
npm install
echo "✓ Dependencies installed"
echo ""

# Request accessibility permissions
echo "Requesting Accessibility permissions..."
echo "ℹ The app needs Accessibility permissions to monitor active windows."
echo "ℹ You may be prompted by macOS - please click 'Open System Preferences' and grant access."
echo ""
echo "To manually grant permissions:"
echo "1. Open System Preferences > Security & Privacy > Accessibility"
echo "2. Unlock the padlock with your password"
echo "3. Add the Knockturn Agent to the list"
echo ""
read -p "Press Enter when ready to continue..."
echo ""

# Build for macOS
echo "Building for macOS..."
npm run build:mac
echo "✓ Build complete"
echo ""

echo "==================================="
echo "Setup Complete!"
echo "==================================="
echo ""
echo "Next steps:"
echo "1. Review .env.local and set your configuration"
echo "2. Run 'npm run dev:mac' for development"
echo "3. Or run 'npm run build:mac' to build a DMG installer"
echo ""
echo "For more information, see MAC_SETUP.md"
