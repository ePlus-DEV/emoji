import { defineConfig } from 'astro/config';

const isGitHubPages = process.env.GITHUB_ACTIONS === 'true';

export default defineConfig({
  site: isGitHubPages ? 'https://eplus-dev.github.io' : 'http://localhost:4321',
  base: isGitHubPages ? '/emoji' : '/',
  trailingSlash: 'never'
});
