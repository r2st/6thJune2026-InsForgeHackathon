#!/bin/bash

# Hush Real Demo Environment Setup
# This script runs the actual toy app, simulates user rage-clicks, and shows real data flowing through the Hush system

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEMO_APP="$PROJECT_ROOT/apps/demo"
RECEIPT_APP="$PROJECT_ROOT/apps/receipt"

echo "🔧 Setting up Hush Real Demo Environment"
echo "======================================"
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed"
    exit 1
fi

echo "✅ Node.js version: $(node --version)"
echo ""

# Check dependencies in demo app
echo "📦 Checking demo app dependencies..."
cd "$DEMO_APP"
if [ ! -d "node_modules" ]; then
    echo "📥 Installing demo app dependencies..."
    npm install
else
    echo "✅ Demo app dependencies already installed"
fi
echo ""

# Check dependencies in receipt app
echo "📦 Checking receipt app dependencies..."
cd "$RECEIPT_APP"
if [ ! -d "node_modules" ]; then
    echo "📥 Installing receipt app dependencies..."
    npm install
else
    echo "✅ Receipt app dependencies already installed"
fi
echo ""

echo "🚀 Starting Real Demo Environment"
echo "=================================="
echo ""
echo "This will:"
echo "1. Start the toy app on port 3000 (simulated storefront)"
echo "2. Start the receipt page on port 3001 (live status dashboard)"
echo "3. Provide instructions to simulate real user interactions"
echo "4. Show real data flowing through the Hush pipeline"
echo ""
echo "Press Ctrl+C to stop all services"
echo ""

# Create logs directory
mkdir -p "$PROJECT_ROOT/logs"

# Start the demo app in background
echo "📱 Starting toy app on http://localhost:3000..."
cd "$DEMO_APP"
nohup npm run dev > "$PROJECT_ROOT/logs/demo-app.log" 2>&1 &
DEMO_PID=$!
echo "✅ Demo app started (PID: $DEMO_PID)"
sleep 3

# Start the receipt app in background
echo "📊 Starting receipt page on http://localhost:3001..."
cd "$RECEIPT_APP"
nohup npm run dev > "$PROJECT_ROOT/logs/receipt-app.log" 2>&1 &
RECEIPT_PID=$!
echo "✅ Receipt page started (PID: $RECEIPT_PID)"
sleep 3

echo ""
echo "✅ Demo environment is ready!"
echo ""
echo "🌐 Access points:"
echo "   Toy app: http://localhost:3000"
echo "   Receipt page: http://localhost:3001"
echo ""
echo "📋 Demo Script:"
echo "   1. Open http://localhost:3000 in your browser"
echo "   2. Navigate to the orders page"
echo "   3. Observe the bug (empty orders page)"
echo "   4. Rage-click the Reload button 3+ times"
echo "   5. Open http://localhost:3001 to see live status"
echo "   6. Watch as Hush captures the session and analyzes it"
echo ""
echo "🔍 Logs:"
echo "   Demo app: $PROJECT_ROOT/logs/demo-app.log"
echo "   Receipt app: $PROJECT_ROOT/logs/receipt-app.log"
echo ""
echo "Press Ctrl+C to stop all services..."

# Function to cleanup on exit
cleanup() {
    echo ""
    echo "🛑 Stopping demo environment..."
    kill $DEMO_PID 2>/dev/null || true
    kill $RECEIPT_PID 2>/dev/null || true
    echo "✅ Services stopped"
    exit 0
}

# Trap Ctrl+C
trap cleanup SIGINT SIGTERM

# Keep script running
wait