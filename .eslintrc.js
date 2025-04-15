module.exports = {
  extends: ["eslint:recommended"],
  env: {
    browser: true,
    node: true,
    es6: true,
  },

  globals: {
    chrome: "readonly", // Chromium specific browser global
    $: "readonly", // Firefox and Chromium helpers
    Espruino: "writable", // Of course, we permit 'Espruino' also
  },

  rules: {
    "no-undef": "warn",
    "no-extra-semi": "warn",
    "no-redeclare": "warn",
    "no-var": "off",
    "no-unused-vars": "warn",
    "no-control-regex": "off",
  },
};
