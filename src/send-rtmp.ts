import * as fs from 'fs';
import * as _ from 'lodash';
import * as childProcess from 'child_process';

import { config } from '../config';

import { logger } from './logger';

import { Writable } from 'stream';

export function sendRtmp(): Writable {
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
        }
    );

    // const outputVideo = fs.createWriteStream('output.flv');
    // ffmpegProcess.stdout.pipe(outputVideo);
    //
    // return {
    //     stdin: outputVideo
    // };

    if (publishLink === '-') {
        const mpcProcess = childProcess.spawn(config.mpcPath, ['playpath', '-'], { stdio: 'pipe' });

        ffmpegProcess.stdout.pipe(mpcProcess.stdin);

        mpcProcess.on('exit', () => {
            throw new Error('Player closed.');
        });
    }

    ffmpegProcess.stderr.setEncoding('utf8');

    ffmpegProcess.stderr.on('data', (data) => {
        logger(['send-rtmp', data]);
    });

    ffmpegProcess.stdin.on('close', () => {
        logger(['stdin close'], true);
    });

    ffmpegProcess.stdin.on('error', (err: Error) => {
        logger(['stdin error', err], true);

        process.exit(1);
    });

    ffmpegProcess.stdin.on('finish', () => {
        logger(['stdin finish'], true);
    });

    ffmpegProcess.stdin.on('drain', () => {
        //console.log('stdin drain');
    });

    return ffmpegProcess.stdin;
}
