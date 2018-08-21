const childProcess = require('child_process');
const fs = require('fs');
const _ = require('lodash');
const os = require('os');

const config = require('./config.json');
const ffmpegPath = require('./config.json').ffmpegPath;
const mpcPath = require('./config.json').mpcPath;
const logger = require('./logger');

function send() {
    let publishLink = _.get(config.publishLinks, [config.publishLink], '-');

    const ffmpegProcess = childProcess.spawn(ffmpegPath, [
        //'-re',
        //'-nostats',
        '-i', '-',
        //'-isync',
        '-vcodec', 'copy',
        '-acodec', 'copy',
        '-f', 'flv',
        publishLink
    ], {
        stdio: 'pipe'
    });

    // const outputVideo = fs.createWriteStream('output.flv');
    // ffmpegProcess.stdout.pipe(outputVideo);
    //
    // return {
    //     stdin: outputVideo
    // };

    if (publishLink === '-') {
        const mpcProcess = childProcess.spawn(mpcPath, [
            'playpath', '-'
        ], {
            stdio: 'pipe'
        });

        ffmpegProcess.stdout.pipe(mpcProcess.stdin);
    }

    ffmpegProcess.stderr.setEncoding('utf8');

    ffmpegProcess.stderr.on('data', function (data) {
        logger(['send-rtmp', data]);
    });

    return ffmpegProcess;
}

module.exports = send;
