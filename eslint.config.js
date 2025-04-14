// eslint.config.js
const { defineConfig } = require("eslint/config");
const js = require('@eslint/js')
const globals = require("globals")

module.exports = defineConfig([
  {
    files: ["**/*.js"],
    plugins: { js },
    extends: ["js/recommended"],
    languageOptions: {
      globals: {
        ...globals.browser,       // Permit default browser global variables, eg. 'document', 'window', etc.
        ...globals.node,          // Permit NodeJS default variables, eg. 'Buffer'
        ...globals.webextensions, // Permit browser extenstions eg. 'chrome' and 'browser'
        Espruino: 'writable'      // Of course, we permit 'Espruino' also
      }
    },
    rules: {
      "no-undef": "warn",
      "no-redeclare": "warn",
      "no-var": "warn",
      "no-unused-vars": "warn",
      "no-control-regex": "off"
    },
  },
]);
