const fs = require('fs');
const os = require('os');
const _ = require('lodash');

const LOGS_PATH = 'logs/logs.txt';

if (!fs.existsSync('logs')) {
    fs.mkdirSync('logs');
}

fs.writeFileSync(LOGS_PATH, [new Date().toJSON(), 'log created.'].join(' ') + os.EOL);

function logger(logs, print = false) {
    logs.unshift(new Date().toJSON());

    if (print) console.log(logs.map(log => {
        if (typeof log === 'object') {
            return JSON.stringify(log, null, 2);
        } else {
            return log;
        }
    }).join(' '));

    fs.appendFile(LOGS_PATH, logs.map(log => {
        if (typeof log === 'object') {
            return JSON.stringify(log, null, 2);
        } else {
            return log;
        }
    }).join(' ') + os.EOL, () => {
    });
}

module.exports = logger;
