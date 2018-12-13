(function (root, factory) {
    'use strict';

    if (typeof define === 'function' && define.amd) {
        define(['exports'], factory);
    } else if (typeof exports !== 'undefined') {
        factory(exports);
    } else {
        factory((root.rollupTools = {}));
    }
}(this, function(exports) {

// =========================================================

function loadModulesRollup(code) {
    var board = Espruino.Core.Env.getBoardData();
    var env = Espruino.Core.Env.getData();
    var modules = [];

    var entryFilename = env.FILE;

    // the env.FILE is only present in the espruino-cli
    if (!entryFilename) {
        // the 'modules' contents is written the filesystem in the espruinoRollup()
        // for in-browser setup with filesystem simulation
        entryFilename = 'main.js';
        modules.push([entryFilename, code]);
    }

    var job = Espruino.Config;
    var minify = job.MINIFICATION_LEVEL === 'TERSER';
    var minifyModules = job.MODULE_MINIFICATION_LEVEL === 'TERSER';

    return espruinoRollup.bundle({
        modules,
        input: entryFilename,
        output: {
            format: 'cjs'
        },
        espruino: {
            job,

            externals: {
                // for proxy and offline support
                getURL: url => new Promise((resolve, reject) => {
                    Espruino.Core.Utils.getURL(url, data => data!==undefined ? resolve(data) : reject(null));
                }),
                // for project sandbox chrome app
                getModule: moduleName => new Promise((resolve, reject) => {
                    Espruino.callProcessor("getModule",
                        { moduleName, moduleCode:undefined, isMinified:false },
                        data => data.moduleCode!==undefined ? resolve(data.moduleCode) : reject(null));
                })
            },

            board: board.BOARD ? board : env,
            mergeModules: job.MODULE_MERGE,
            minify: minify ? buildEspruinoMinifyOptions() : false,
            minifyModules
        }
    });
}

function buildEspruinoMinifyOptions() {
    var job = Espruino.Config;

    var options = {};
    if (job.MINIFICATION_Mangle === false) {
        options.mangle = false;
    }
    if (job.MINIFICATION_Unused === false) {
        options.compress = options.compress || {};
        options.compress.unused = false;
    }
    if (job.MINIFICATION_DeadCode === false) {
        options.compress = options.compress || {};
        options.compress.dead_code = false;
    }
    if (job.MINIFICATION_Unreachable === false) {
        options.compress = options.compress || {};
        options.compress.dead_code = false; // in Terser dead_code ~ unreachable
    }
    if (job.MINIFICATION_Literal === false) {
        options.compress = options.compress || {};
        options.compress.reduce_vars = false;
    }

    return options;
}

function minifyCodeTerser(code) {
    return espruinoRollup.minify(code, buildEspruinoMinifyOptions());
}

exports.loadModulesRollup = loadModulesRollup
exports.minifyCodeTerser = minifyCodeTerser;

}));
