// open-next.config.ts is required by @opennextjs/cloudflare's `build` command
// (see node_modules/@opennextjs/cloudflare/dist/cli/commands/utils/utils.js) --
// there is no way to run `opennextjs-cloudflare build` without one.
//
// No cache override is configured here: R2 bucket provisioning is out of
// scope for this task (see wrangler.jsonc and prd/v4_cloudflare_deployment.md
// for the deploy-time migration steps). Leaving this unset defaults every
// cache/queue/tag-cache override to "dummy", which the adapter accepts.
import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig();
