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

function loadModulesRollup(code, callback) {
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

    return espruinoRollup.bundle({
        modules,
        input: entryFilename,
        output: {
            format: 'cjs'
        },
        espruino: {
            job: Espruino.Config,

            board: board.BOARD,
            mergeModules: Espruino.Config.MODULE_MERGE,
            minify: !!Espruino.Config.MINIFICATION_LEVEL,
            minifyModules: !!Espruino.Config.MODULE_MINIFICATION_LEVEL

            // TODO: handle opts MINIFICATION_Xyz
        }
    })
}

function minifyCodeTerser(code, callback) {
    return espruinoRollup.minify(code, {
        // TODO: handle opts MINIFICATION_Xyz
    })
}

exports.loadModulesRollup = loadModulesRollup
exports.minifyCodeTerser = minifyCodeTerser;

}));
