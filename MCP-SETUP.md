# MCP Server Configuration Guide

## Overview

This project includes 21 MCP (Model Context Protocol) servers to extend AI coding capabilities.

## Quick Start

```bash
# 1. Run setup script
./setup-mcp.sh

# 2. Edit .env file with your API keys
nano .env

# 3. Restart your AI coding assistant
```

## Available MCP Servers

### Documentation
| Server | Description | Required Keys |
|--------|-------------|---------------|
| **context7** | Up-to-date documentation for any library | `CONTEXT7_API_KEY` |

### Version Control
| Server | Description | Required Keys |
|--------|-------------|---------------|
| **github** | GitHub API, PRs, issues, CI/CD | `GITHUB_TOKEN` |
| **gitlab** | GitLab API integration | `GITLAB_TOKEN` |

### Databases
| Server | Description | Required Keys |
|--------|-------------|---------------|
| **postgres** | PostgreSQL access | `DATABASE_URL` |
| **sqlite** | SQLite database | `SQLITE_DB_PATH` |
| **redis** | Redis key-value store | `REDIS_URL` |

### DevOps & Cloud
| Server | Description | Required Keys |
|--------|-------------|---------------|
| **docker** | Container management | None (uses local Docker) |
| **aws** | AWS services | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` |
| **cloudflare** | Edge computing, Workers | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` |
| **vercel** | Frontend deployment | `VERCEL_TOKEN` |
| **netlify** | Static site hosting | `NETLIFY_AUTH_TOKEN` |

### Browser Automation
| Server | Description | Required Keys |
|--------|-------------|---------------|
| **puppeteer** | Browser automation & scraping | None |
| **playwright** | Cross-browser testing | None |

### Project Management
| Server | Description | Required Keys |
|--------|-------------|---------------|
| **notion** | Documentation & knowledge base | `NOTION_API_KEY` |
| **linear** | Issue tracking | `LINEAR_API_KEY` |

### Monitoring & Analytics
| Server | Description | Required Keys |
|--------|-------------|---------------|
| **sentry** | Error monitoring | `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` |
| **posthog** | Product analytics | `POSTHOG_API_KEY` |

### Search & Memory
| Server | Description | Required Keys |
|--------|-------------|---------------|
| **brave-search** | Web search | `BRAVE_API_KEY` |
| **memory** | Persistent knowledge graph | None |
| **sequential-thinking** | Problem-solving sequences | None |

### File System
| Server | Description | Required Keys |
|--------|-------------|---------------|
| **filesystem** | Extended file operations | None (uses `ALLOWED_DIR`) |

## Getting API Keys

### Context7 (Recommended)
1. Visit https://context7.com/dashboard
2. Sign up for free
3. Copy your API key

### GitHub
1. Go to https://github.com/settings/tokens
2. Create new token (classic)
3. Select scopes: `repo`, `workflow`, `admin:org`

### GitLab
1. Go to https://gitlab.com/-/user_settings/personal_access_tokens
2. Create token with `api` scope

### PostgreSQL
Use your existing database connection string:
```
postgresql://username:password@host:5432/database
```

### AWS
1. Go to AWS IAM Console
2. Create access key for your user
3. Ensure permissions for required services

### Cloudflare
1. Go to https://dash.cloudflare.com/profile/api-tokens
2. Create token with appropriate permissions

### Vercel
1. Go to https://vercel.com/account/tokens
2. Create new token

### Netlify
1. Go to https://app.netlify.com/user/applications#personal-access-tokens
2. Create new token

### Notion
1. Go to https://www.notion.so/my-integrations
2. Create integration
3. Share databases with integration

### Linear
1. Go to https://linear.app/settings/api
2. Create API key

### Sentry
1. Go to https://sentry.io/settings/auth-tokens/
2. Create auth token
3. Note your org and project slugs

### PostHog
1. Go to https://app.posthog.com/project/settings
2. Copy project API key

### Brave Search
1. Go to https://api.search.brave.com/
2. Sign up for API access

## Usage Examples

### Context7 Documentation Lookup
```
"Show me how to use Next.js middleware. use context7"
```

### GitHub PR Management
```
"Create a PR for the current branch"
"Show me open issues assigned to me"
```

### Database Queries
```
"Query all users from PostgreSQL"
"Show me the SQLite schema"
```

### Docker Management
```
"List running containers"
"Build the Docker image for this project"
```

### Browser Testing
```
"Take a screenshot of localhost:3000"
"Test the login flow with Puppeteer"
```

## Troubleshooting

### Server won't start
1. Check Node.js version: `node -v` (requires 18+)
2. Verify API keys in `.env`
3. Check network connectivity

### Permission errors
- Ensure API tokens have correct scopes
- Check database user permissions

### Connection issues
- Verify database URLs are correct
- Check firewall rules for cloud services

## Resources

- [MCP Documentation](https://modelcontextprotocol.io)
- [MCP Servers Repository](https://github.com/modelcontextprotocol/servers)
- [Context7 Documentation](https://context7.com/docs)
