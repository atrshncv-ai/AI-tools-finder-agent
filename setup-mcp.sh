#!/bin/bash

echo "🚀 MCP Server Setup Script"
echo "=========================="
echo ""

# Check if .env exists
if [ ! -f .env ]; then
    echo "📋 Creating .env file from template..."
    cp .env.example .env
    echo "✅ .env file created. Please fill in your API keys."
    echo ""
fi

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is required. Please install Node.js 18+"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js 18+ is required. Current version: $(node -v)"
    exit 1
fi

echo "✅ Node.js $(node -v) detected"
echo ""

# Install Context7 CLI
echo "📦 Installing Context7 CLI..."
npx -y ctx7 setup --claude 2>/dev/null || echo "⚠️  Context7 CLI setup skipped (run manually if needed)"

echo ""
echo "🔧 Available MCP Servers:"
echo "========================"
echo ""
echo "1. context7     - Up-to-date documentation for LLMs"
echo "2. github       - GitHub API integration"
echo "3. gitlab       - GitLab API integration"
echo "4. postgres     - PostgreSQL database access"
echo "5. sqlite       - SQLite database access"
echo "6. redis        - Redis key-value store"
echo "7. filesystem   - Extended file operations"
echo "8. docker       - Docker container management"
echo "9. puppeteer    - Browser automation"
echo "10. playwright  - Browser testing"
echo "11. aws         - AWS cloud services"
echo "12. cloudflare  - Cloudflare edge computing"
echo "13. vercel      - Vercel deployment"
echo "14. netlify     - Netlify deployment"
echo "15. notion      - Notion documentation"
echo "16. linear      - Linear project management"
echo "17. sentry      - Error monitoring"
echo "18. posthog     - Analytics"
echo "19. brave-search - Web search"
echo "20. memory      - Persistent memory"
echo "21. sequential-thinking - Problem solving"
echo ""
echo "📝 Next Steps:"
echo "1. Edit .env file with your API keys"
echo "2. Restart your AI coding assistant"
echo "3. MCP servers will be available automatically"
echo ""
echo "📚 For more info: https://modelcontextprotocol.io"
