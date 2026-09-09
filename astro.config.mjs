import { defineConfig } from 'astro/config';

const isGitHubPages = process.env.GITHUB_ACTIONS === 'true';

export default defineConfig({
  site: isGitHubPages ? 'https://emoji.eplus.dev' : 'http://localhost:4321',
  base: '/',
  trailingSlash: 'never'
});
