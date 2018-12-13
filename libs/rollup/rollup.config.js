import json from 'rollup-plugin-json';
import alias from 'rollup-plugin-alias';
import resolve from 'rollup-plugin-node-resolve';
import builtins from 'rollup-plugin-node-builtins';
import globals from 'rollup-plugin-node-globals';
import commonjs from 'rollup-plugin-commonjs';
import { terser } from 'rollup-plugin-terser';

const buildPlugins = opts => [
    json(),
    resolve({
      preferBuiltins: true,
      ...opts.resolve
    }),
    commonjs({
      namedExports: {
        'node_modules/resolve/index.js': [ 'sync' ],
        'node_modules/async/dist/async.js': [ 'eachSeries' ],
        ...opts.commonjs.namedExports
      }
    }),
  ];

const config = {
  input  : 'espruino-rollup.js',
  output : {
    file: 'espruino-rollup.browser.js',
    name: 'espruinoRollup',
    format: 'umd',
  },
  plugins: [
    alias({
      fs: require.resolve('memfs'),
      debug: require.resolve('./debug-shim')
    }),
    ...buildPlugins({
      resolve: {
        browser: true,
      },
      commonjs: {
        namedExports: {
          'node_modules/memfs/lib/index.js': [
            'statSync', 'lstatSync', 'realpathSync',
            'mkdirSync', 'readdirSync',
            'readFileSync',
            'writeFile', 'writeFileSync',
            'watch',
          ]
        }
      }
    }),
    builtins(),
    globals({
        dirname: false
    }),
    terser(),
  ]
};

// console.log( config );
export default config;
