const Subtitles = require('subtitle');
const fs = require('fs');
const _ = require('lodash');

const config = require('./config.json');

const subtitlesFile = fs.readFileSync(config.subtitlesFile, {
    encoding: 'utf-8'
});

const subtitles = Subtitles.parse(subtitlesFile);

function getSubtitle(timestamp) {
    const videoStart = config.videoStart.split(':');

    timestamp =+ timestamp + (parseInt(videoStart[0]) * 60 * 60 * 1000) + (parseInt(videoStart[1]) * 60 * 1000) + (parseInt(videoStart[2]) * 1000);

    const subtitle = _.find(subtitles, (subtitle) => {
        return subtitle.start <= timestamp && subtitle.end >= timestamp;
    });

    if (!subtitle) {
        return null;
    }

    return subtitle.text;
}

module.exports = getSubtitle;
