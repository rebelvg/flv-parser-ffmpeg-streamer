export const config = {
  ffmpegPath: 'ffmpeg.exe',
  clientPath: 'mpc-hc.exe',
  clientArgs: ['playpath', '-'],
  videoFilePath: 'video.mp4',
  videoStart: '00:00:00',
  pausedImg: 'paused.png',
  copyVideo: false,
  preset: 'veryfast',
  framerate: 23.976,
  cropHeight: 0,
  scaleWidth: -2,
  videoBitrate: 4000,
  publishLink: 'client',
  publishLinks: {
    client: '-',
    rtmp: 'rtmp://localhost/app/channel'
  },
  socketServer: 'http://localhost:3000',
  subtitlesFile: 'video.srt'
};
