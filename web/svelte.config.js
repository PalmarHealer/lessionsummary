import adapter from "@sveltejs/adapter-node";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter(),
    csrf: {
      // /api/v1, /api/worker and /mcp are called cross-origin by machines
      // holding a Bearer token, never by a browser with our cookie. The origin
      // check for cookie-bearing form posts lives in hooks.server.ts instead.
      checkOrigin: false,
    },
  },
};

export default config;
