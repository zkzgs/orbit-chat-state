import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { minify } from 'html-minifier-terser'

export default defineConfig({
  base: './',
  plugins: [
    vue(),
    viteSingleFile(),
    {
      name: 'compress-html',
      enforce: 'post',
      generateBundle: {
        order: 'post',
        async handler(_, bundle) {
          for (const asset of Object.values(bundle)) {
            if (asset.type === 'asset' && asset.fileName.endsWith('.html')) {
              asset.source = await minify(String(asset.source), {
                collapseWhitespace: true,
                removeComments: true,
                removeRedundantAttributes: true,
                minifyCSS: true,
              })
            }
          }
        },
      },
    },
  ],
  define: {
    __VUE_OPTIONS_API__: false,
    __VUE_PROD_DEVTOOLS__: false,
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
  },
  build: {
    target: 'es2022',
    minify: 'terser',
    sourcemap: false,
    modulePreload: false,
    terserOptions: {
      compress: { passes: 2 },
      format: { comments: /@license|@preserve|copyright|MIT-License|^!/i },
    },
  },
})
