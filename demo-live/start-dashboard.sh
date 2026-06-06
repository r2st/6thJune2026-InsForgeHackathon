#!/bin/bash

# Hush Live Pipeline Dashboard Launcher
# Opens the pipeline dashboard in your default browser

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DASHBOARD="$SCRIPT_DIR/pipeline-dashboard.html"

echo "🔧 Opening Hush Live Pipeline Dashboard..."
echo "📁 Location: $DASHBOARD"

# Detect OS and open accordingly
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    open "$DASHBOARD"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    # Linux
    if command -v xdg-open > /dev/null; then
        xdg-open "$DASHBOARD"
    else
        echo "❌ xdg-open not found. Please open manually: $DASHBOARD"
        exit 1
    fi
elif [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]]; then
    # Windows
    start "$DASHBOARD"
else
    echo "❌ Unsupported OS. Please open manually: $DASHBOARD"
    exit 1
fi

echo "✅ Dashboard opened in browser"
echo ""
echo "🎯 Quick Start:"
echo "   1. Click '▶ Start Demo' to run the automated sequence"
echo "   2. Watch data flow through the pipeline stages"
echo "   3. Click stages to see detailed JSON payloads"
echo ""
echo "💡 Use alongside slide-based demo: demo/slides/index.html"