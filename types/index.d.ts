/**
 * init Espruino global vars
 * @param {() => void} callback
 */
export function init(callback: () => void): void;
/**
 * Send a file to an Espruino on the given port, call the callback when done
 * @param {string} port
 * @param {string} filename
 * @param {() => void} callback
 */
export function sendFile(port: string, filename: string, callback: () => void): void;
/**
 * Send code to Espruino
 * @param {string} port
 * @param {string} code
 * @param {() => void} callback
*/
export function sendCode(port: string, code: string, callback: () => void): void;
/**
 * Execute an expression on Espruino, call the callback with the result
 * @param {string} port
 * @param {string} expr
 * @param {(result: string) => void} callback
 */
export function expr(port: string, expr: string, callback: (result: string) => void): void;
/**
 * Execute a statement on Espruino, call the callback with what is printed to the console
 * @param {string} port
 * @param {string} expr
 * @param {(result: string) => void} callback
 */
export function statement(port: string, expr: string, callback: (result: string) => void): void;
/**
 * Flash the given firmware file to an Espruino board.
 * @param {string} port
 * @param {string} filename
 * @param {number} flashOffset
 * @param {() => void} callback
 */
export function flash(port: string, filename: string, flashOffset: number, callback: () => void): void;
//# sourceMappingURL=index.d.ts.map