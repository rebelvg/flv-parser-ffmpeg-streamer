import * as fs from 'fs';
import * as _ from 'lodash';
import * as childProcess from 'child_process';

import { config } from './config';

const logger = require('./logger');

export function sendRtmp(): childProcess.ChildProcess {
    const publishLink = _.get(config.publishLinks, [config.publishLink], '-');

    const ffmpegProcess = childProcess.spawn(config.ffmpegPath, [
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
        const mpcProcess = childProcess.spawn(config.mpcPath, [
            'playpath', '-'
        ], {
            stdio: 'pipe'
        });

        ffmpegProcess.stdout.pipe(mpcProcess.stdin);
    }

    ffmpegProcess.stderr.setEncoding('utf8');

    ffmpegProcess.stderr.on('data', (data) => {
        logger(['send-rtmp', data]);
    });

    return ffmpegProcess;
}
