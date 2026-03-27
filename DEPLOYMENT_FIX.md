# Deployment Configuration Fix

## Problem

The error "The entry-point file at 'src/index.ts' was not found" occurs when deploying with `wrangler versions upload` because wrangler is not correctly reading the `main` field from `wrangler.toml`.

## Root Cause

This issue can occur when:

1. **Wrong deployment command**: Using `npx wrangler versions upload` instead of `wrangler deploy`
2. **Missing wrangler.toml**: The deployment system can't find or read `wrangler.toml`
3. **Wrong working directory**: The deployment is running from a subdirectory
4. **Cloudflare Pages auto-deployment**: If the project is connected to Cloudflare Pages, it may be using a default build command

## Solution

### Option 1: Use GitHub Actions (Recommended)

The repository includes a GitHub Actions workflow (`.github/workflows/deploy.yml`) that correctly deploys the worker using `wrangler deploy`.

**To use GitHub Actions deployment:**

1. Ensure you have set the required secrets in your GitHub repository:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`

2. Push to the `main` branch (excluding `inbox/**` changes), or manually trigger the workflow.

3. The workflow will:
   - Checkout the code
   - Verify wrangler.toml and worker.js exist
   - Install wrangler@4.76.0
   - Deploy using `wrangler deploy`

### Option 2: Manual Deployment

From the repository root directory:

```bash
# Using npm script (recommended)
npm run deploy

# Or directly with wrangler
wrangler deploy

# Both commands use the wrangler.toml configuration which specifies:
# main = "b24-imbot/worker.js"
```

### Option 3: Fix Cloudflare Pages Auto-Deployment

If you have Cloudflare Pages connected to this repository and it's using the wrong build command:

1. Go to your Cloudflare Pages dashboard
2. Select your project
3. Go to Settings → Builds & deployments
4. Update the **Build command** to:
   ```
   npm run deploy
   ```
   Or:
   ```
   npx wrangler deploy
   ```
5. Set the **Build output directory** to: (leave empty or set to `/`)

**DO NOT use `wrangler versions upload` as a build command in Cloudflare Pages** - use `wrangler deploy` instead.

## Verifying Configuration

To verify your wrangler.toml is correctly configured:

```bash
# Check the configuration
cat wrangler.toml | grep main
# Should output: main = "b24-imbot/worker.js"

# Verify the worker file exists
ls -la b24-imbot/worker.js

# Test deployment (dry run)
wrangler deploy --dry-run
```

## Package.json Scripts

The repository now includes deployment scripts in `package.json`:

```json
{
  "scripts": {
    "deploy": "wrangler deploy",
    "deploy:versions": "wrangler versions upload"
  }
}
```

Use `npm run deploy` for standard deployments.

## Wrangler Configuration

The project uses a **root-level** `wrangler.toml` for production deployments:

```toml
name = "bitrix24bot"
main = "b24-imbot/worker.js"  # ← Entry point is explicitly specified
compatibility_date = "2024-01-01"
```

There is a single `wrangler.toml` at the repository root for all deployments. Production deployments should always run from the repository root.

## Troubleshooting

### Error: "The entry-point file at 'src/index.ts' was not found"

**Cause**: Wrangler is not reading the `main` field from `wrangler.toml`, likely because:
- You're running from the wrong directory
- The wrangler.toml file is missing or corrupted
- You're using an incompatible wrangler command or version

**Solution**:
1. Ensure you're in the repository root directory
2. Verify `wrangler.toml` exists and contains `main = "b24-imbot/worker.js"`
3. Use `wrangler deploy` instead of `wrangler versions upload`
4. Update your CI/CD configuration to use the correct command

### Error: "Worker not found" or 403 errors

**Cause**: Missing or incorrect Cloudflare credentials.

**Solution**:
1. Set environment variables:
   ```bash
   export CLOUDFLARE_API_TOKEN="your-api-token"
   export CLOUDFLARE_ACCOUNT_ID="your-account-id"
   ```
2. Or use `wrangler login` for interactive authentication

### Deployment works locally but fails in CI

**Cause**: Different working directory or missing files.

**Solution**:
1. Add verification steps to your CI workflow (see `.github/workflows/deploy.yml`)
2. Ensure the workflow checks out the code with `actions/checkout@v4`
3. Verify the working directory is the repository root

## Recommended Deployment Flow

For production deployments, follow this flow:

1. **Local testing**:
   ```bash
   npm run deploy -- --dry-run
   ```

2. **Deploy via GitHub Actions** (recommended):
   - Push to `main` branch
   - Or use workflow_dispatch to manually trigger deployment

3. **Manual deployment** (if needed):
   ```bash
   npm run deploy
   ```

## Additional Notes

- The worker code is in `b24-imbot/worker.js` (not `src/index.ts`)
- The repository uses a single-file worker architecture (no build step required)
- GitHub Actions is the recommended deployment method for production
- Cloudflare Pages auto-deployment should be disabled for this project or configured to use `wrangler deploy`
