const { writeFileSync, vol } = require('fs');
const rollup = require('rollup');
const espruinoModules = require('rollup-plugin-espruino-modules');

function bundle(options) {
    const opts = { ...options };

    if (typeof vol !== 'undefined') { // only in browser (fs = memfs)
        vol.fromJSON({'/modules': null});

        if (opts.modules) {
            try {
              opts.modules.forEach(([name, code]) => writeFileSync(name, code));
            } catch (err) {
              console.error('Write file failed:', err);
            }
            delete opts.modules;
        }
    }

    const warnings = [];
    opts.onwarn = warning => (warnings.push( warning ), (options.onwarn && options.onwarn(warning)));

    const config = espruinoModules.buildRollupConfig(opts);

    return rollup.rollup(config).then(bundle =>
        bundle.generate(config.output).then(generated => {
            generated.warnings = warnings;
            return generated;
        })
    );
}

function minify(code, options) {
    return new Promise((resolve, reject) => {
        try {
            const minifyOptions = espruinoModules.buildMinifyConfig(options)
            const generated = espruinoModules.minify(code, minifyOptions);
            resolve(generated);
        } catch(e) {
            reject(e);
        }
    });
}

module.exports = {
    bundle,
    minify
}
