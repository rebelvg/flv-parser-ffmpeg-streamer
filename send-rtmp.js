const childProcess = require('child_process');
const fs = require('fs');
const _ = require('lodash');

const config = require('./config.json');
const ffmpegPath = require('./config.json').ffmpegPath;
const mpcPath = require('./config.json').mpcPath;

function send() {
    const ffmpegProcess = childProcess.spawn(ffmpegPath, [
        '-re',
        '-nostats',
        '-i', '-',
        '-isync',
        '-vcodec', 'copy',
        '-acodec', 'copy',
        '-f', 'flv',
        config.publishLink
    ], {
        stdio: 'pipe'
    });

    if (config.publishLink === '-') {
        const mpcProcess = childProcess.spawn(mpcPath, [
            'playpath', '-'
        ], {
            stdio: 'pipe'
        });

        ffmpegProcess.stdout.pipe(mpcProcess.stdin);
    }

    ffmpegProcess.stderr.setEncoding('utf8');

    ffmpegProcess.stderr.on('data', function (data) {
        //console.log(data);
    });

    return ffmpegProcess;
}

module.exports = send;
