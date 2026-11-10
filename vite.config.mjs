import { defineConfig } from 'vite';
import { transform } from 'esbuild';
import instrumentation from 'istanbul-lib-instrument';

export default defineConfig({
  plugins: process.env.BOARD_COVERAGE === '1' ? [{
    name: 'syncboard-test-coverage',
    enforce: 'pre',
    async transform(source, id) {
      if (!id.startsWith(process.cwd() + '/src/') || !/\.tsx?$/.test(id)) return;
      const compiled = await transform(source, {
        loader: id.endsWith('.tsx') ? 'tsx' : 'ts',
        jsx: 'automatic',
        sourcemap: true,
        sourcefile: id,
      });
      const instrumenter = instrumentation.createInstrumenter({
        esModules: true, produceSourceMap: true,
        coverageGlobalScope: 'globalThis', coverageGlobalScopeFunc: false,
      });
      return {
        code: instrumenter.instrumentSync(compiled.code, id, JSON.parse(compiled.map)),
        map: instrumenter.lastSourceMap(),
      };
    },
  }] : [],
});
