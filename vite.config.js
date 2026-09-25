import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const publicUrl = loadEnv(mode, process.cwd(), 'VITE_').VITE_SITE_URL?.trim();
  let siteUrl = null;

  if (publicUrl) {
    const url = new URL(publicUrl);
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error('VITE_SITE_URL must start with http:// or https://');
    }
    url.search = '';
    url.hash = '';
    siteUrl = url.href.endsWith('/') ? url.href : `${url.href}/`;
  }

  return {
    base: './',
    plugins: [{
      name: 'social-preview-urls',
      transformIndexHtml(html) {
        const imageUrl = siteUrl
          ? new URL('social-preview.png', siteUrl).href
          : './social-preview.png';

        return html
          .replaceAll('./social-preview.png', imageUrl)
          .replace(
            '<!-- SITE_CANONICAL -->',
            siteUrl
              ? `<link rel="canonical" href="${siteUrl}" />\n    <meta property="og:url" content="${siteUrl}" />`
              : '',
          );
      },
    }],
  };
});
